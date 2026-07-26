use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use tracing::debug;
use tracing_subscriber::EnvFilter;
use tracing_subscriber::reload;

use crate::protocol::{AgentInfo, AgentState};

pub static LOG_RELOAD_HANDLE: std::sync::OnceLock<reload::Handle<EnvFilter, tracing_subscriber::Registry>> = std::sync::OnceLock::new();

const ENDED_HIDE_DELAY: Duration = Duration::from_secs(10);
const STALE_TIMEOUT: Duration = Duration::from_secs(30);
const FOCUS_PRIORITIES: &[AgentState] = &[
    AgentState::Awaiting,
    AgentState::Completed,
    AgentState::Started,
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AutoFocusEvent {
    Trigger,
    QueueEmpty,
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AutoFocusMode {
    Off,
    Awaiting,
    AwaitingCompleted,
}

impl AutoFocusMode {
    pub fn as_u8(self) -> u8 {
        match self {
            AutoFocusMode::Off => 0,
            AutoFocusMode::Awaiting => 1,
            AutoFocusMode::AwaitingCompleted => 2,
        }
    }

    pub fn cycle(self) -> Self {
        match self {
            AutoFocusMode::Off => AutoFocusMode::Awaiting,
            AutoFocusMode::Awaiting => AutoFocusMode::AwaitingCompleted,
            AutoFocusMode::AwaitingCompleted => AutoFocusMode::Off,
        }
    }
}

#[derive(Debug, Clone)]
pub struct SessionInfo {
    pub state: AgentState,
    pub tool: String,
    pub agent_type: Arc<str>,
    pub ended_at: Option<Instant>,
    pub last_activity: Instant,
    pub awaiting_since: Option<Instant>,
    pub uncommitted_count: Option<u32>,
    pub multiplexer: Option<Arc<str>>,
}

pub struct StateManager {
    sessions: HashMap<String, SessionInfo>,
    workspaces: HashMap<String, (u32, u32)>,
    focused_group: Option<String>,
    last_focus_index: usize,
    awaiting_queue: Vec<String>,
    auto_focus_enabled: bool,
    focus_delay_ms: u64,
    user_idle: bool,
    auto_focus_active: bool,
    per_session_auto_focus: HashMap<String, AutoFocusMode>,
    last_auto_focused: Option<String>,
}

impl StateManager {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
            workspaces: HashMap::new(),
            focused_group: None,
            last_focus_index: 0,
            awaiting_queue: Vec::new(),
            auto_focus_enabled: false,
            focus_delay_ms: 1000,
            user_idle: false,
            auto_focus_active: false,
            per_session_auto_focus: HashMap::new(),
            last_auto_focused: None,
        }
    }

    pub fn update_state(&mut self, session: String, state: AgentState, tool: String, agent_type: Arc<str>, uncommitted_count: Option<u32>, multiplexer: Option<Arc<str>>) -> AutoFocusEvent {
        let prev_state = self.sessions.get(&session).map(|s| s.state);

        let ended_at = if state == AgentState::Ended {
            Some(Instant::now())
        } else {
            None
        };

        let mut actual_state = state;
        if state == AgentState::Completed {
            let group = Self::get_group(&session);
            if self.focused_group.as_deref() == Some(group) {
                actual_state = AgentState::Started;
            }
        }

        let awaiting_since = if actual_state == AgentState::Awaiting {
            if prev_state == Some(AgentState::Awaiting) {
                self.sessions.get(&session).and_then(|s| s.awaiting_since)
            } else {
                Some(Instant::now())
            }
        } else {
            None
        };

        let uncommitted_count = uncommitted_count
            .or_else(|| self.sessions.get(&session).and_then(|s| s.uncommitted_count));

        let multiplexer = multiplexer
            .or_else(|| self.sessions.get(&session).and_then(|s| s.multiplexer.clone()));

        self.sessions.insert(
            session.clone(),
            SessionInfo {
                state: actual_state,
                tool,
                agent_type,
                ended_at,
                last_activity: Instant::now(),
                awaiting_since,
                uncommitted_count,
                multiplexer,
            },
        );

        let became_awaiting = actual_state == AgentState::Awaiting
            && prev_state != Some(AgentState::Awaiting);
        let left_awaiting = actual_state != AgentState::Awaiting
            && prev_state == Some(AgentState::Awaiting);
        let became_completed = actual_state == AgentState::Completed
            && prev_state != Some(AgentState::Completed);
        let left_completed = actual_state != AgentState::Completed
            && prev_state == Some(AgentState::Completed);

        if became_awaiting {
            if !self.awaiting_queue.contains(&session) {
                self.awaiting_queue.push(session);
            }
            return AutoFocusEvent::Trigger;
        }

        let mode = self
            .per_session_auto_focus
            .get(&session)
            .copied()
            .unwrap_or(AutoFocusMode::Off);

        if became_completed && mode == AutoFocusMode::AwaitingCompleted {
            if !self.awaiting_queue.contains(&session) {
                self.awaiting_queue.push(session);
            }
            return AutoFocusEvent::Trigger;
        }

        if left_awaiting || left_completed || actual_state == AgentState::Ended {
            self.awaiting_queue.retain(|s| s != &session);
            if actual_state == AgentState::Ended {
                self.per_session_auto_focus.remove(&session);
            }
            if self.last_auto_focused.as_deref() == Some(&session) {
                self.last_auto_focused = None;
            }
            if !self.has_eligible_in_queue() && self.auto_focus_active {
                self.auto_focus_active = false;
                return AutoFocusEvent::QueueEmpty;
            }
            if left_awaiting || left_completed {
                return AutoFocusEvent::Trigger;
            }
        }

        AutoFocusEvent::None
    }

    pub fn update_window_focus(&mut self, title: &str, agent_type: Option<&str>) -> (bool, AutoFocusEvent) {
        let mut keys: Vec<&String> = self.sessions.keys().collect();
        keys.sort();
        let new_focused = keys
            .iter()
            .find(|s| Self::title_matches_group(title, Self::get_group(s)))
            .map(|s| Self::get_group(s).to_string())
            .or_else(|| {
                let at = agent_type.filter(|a| !a.is_empty())?;
                self.sessions
                    .iter()
                    .find(|(_, info)| &*info.agent_type == at)
                    .map(|(s, _)| Self::get_group(s).to_string())
            });

        let changed = self.focused_group != new_focused;
        self.focused_group = new_focused.clone();

        if let Some(ref group) = self.focused_group {
            for (session, info) in self.sessions.iter_mut() {
                if Self::get_group(session) == group
                    && info.state == AgentState::Completed
                {
                    info.state = AgentState::Started;
                }
            }
        }

        let af_event = self.check_auto_focus_dismissal();

        (changed, af_event)
    }

    fn check_auto_focus_dismissal(&mut self) -> AutoFocusEvent {
        let session = match self.last_auto_focused.take() {
            Some(s) => s,
            None => return AutoFocusEvent::None,
        };

        let session_group = Self::get_group(&session);
        if self.focused_group.as_deref() == Some(session_group) {
            self.last_auto_focused = Some(session);
            return AutoFocusEvent::None;
        }

        self.awaiting_queue.retain(|s| s != &session);

        if !self.has_eligible_in_queue() && self.auto_focus_active {
            self.auto_focus_active = false;
            return AutoFocusEvent::QueueEmpty;
        }

        AutoFocusEvent::None
    }

    pub fn cycle_auto_focus(&mut self, session: &str) -> AutoFocusMode {
        let current = self
            .per_session_auto_focus
            .get(session)
            .copied()
            .unwrap_or(AutoFocusMode::Off);
        let next = current.cycle();
        if next == AutoFocusMode::Off {
            self.per_session_auto_focus.remove(session);
        } else {
            self.per_session_auto_focus.insert(session.to_string(), next);
        }
        next
    }

    pub fn cycle_auto_focus_group(&mut self, group: &str) -> AutoFocusMode {
        let sessions: Vec<String> = self
            .sessions
            .keys()
            .filter(|s| Self::get_group(s) == group)
            .cloned()
            .collect();
        if sessions.is_empty() {
            return AutoFocusMode::Off;
        }
        let min_u8 = sessions
            .iter()
            .map(|s| {
                self.per_session_auto_focus
                    .get(s)
                    .copied()
                    .unwrap_or(AutoFocusMode::Off)
                    .as_u8()
            })
            .min()
            .unwrap_or(0);
        let current = match min_u8 {
            0 => AutoFocusMode::Off,
            1 => AutoFocusMode::Awaiting,
            _ => AutoFocusMode::AwaitingCompleted,
        };
        let next = current.cycle();
        for s in &sessions {
            if next == AutoFocusMode::Off {
                self.per_session_auto_focus.remove(s);
            } else {
                self.per_session_auto_focus.insert(s.clone(), next);
            }
        }
        next
    }

    pub fn remove_session(&mut self, session: &str) -> (bool, AutoFocusEvent) {
        self.awaiting_queue.retain(|s| s != session);
        self.per_session_auto_focus.remove(session);
        if self.last_auto_focused.as_deref() == Some(session) {
            self.last_auto_focused = None;
        }
        let removed = self.sessions.remove(session).is_some();
        let group = Self::get_group(session);
        if removed && !self.sessions.keys().any(|k| Self::get_group(k) == group) {
            self.workspaces.remove(group);
        }
        let af_event = if !self.has_eligible_in_queue() && self.auto_focus_active {
            self.auto_focus_active = false;
            AutoFocusEvent::QueueEmpty
        } else {
            AutoFocusEvent::None
        };
        (removed, af_event)
    }

    pub fn get_agent_type(&self, session: &str) -> String {
        self.sessions
            .get(session)
            .map(|info| info.agent_type.to_string())
            .unwrap_or_default()
    }

    pub fn get_multiplexer(&self, session: &str) -> Option<String> {
        self.sessions
            .get(session)
            .and_then(|info| info.multiplexer.as_ref())
            .map(|m| m.to_string())
    }

    pub fn cleanup_ended(&mut self) -> bool {
        let now = Instant::now();
        let mut changed = false;

        for (session, info) in self.sessions.iter_mut() {
            if info.ended_at.is_none()
                && &*info.agent_type == "cursor"
                && info.state == AgentState::Started
                && now.duration_since(info.last_activity) >= STALE_TIMEOUT
                && self.focused_group.as_deref() != Some(Self::get_group(session))
            {
                info.state = AgentState::Ended;
                info.ended_at = Some(now);
                changed = true;
            }
        }

        let before = self.sessions.len();
        self.sessions.retain(|session, info| {
            if let Some(ended_at) = info.ended_at {
                if now.duration_since(ended_at) >= ENDED_HIDE_DELAY {
                    self.per_session_auto_focus.remove(session);
                    self.awaiting_queue.retain(|s| s != session);
                    if self.last_auto_focused.as_deref() == Some(session) {
                        self.last_auto_focused = None;
                    }
                    return false;
                }
            }
            true
        });

        changed || self.sessions.len() != before
    }

    pub fn update_workspace(&mut self, session: &str, workspace: u32, monitor: u32) {
        let group = Self::get_group(session).to_string();
        self.workspaces.retain(|k, _| Self::get_group(k) != group);
        self.workspaces.insert(group, (workspace, monitor));
    }

    fn get_placement(&self, session: &str) -> (u32, u32) {
        if let Some(&p) = self.workspaces.get(session) {
            return p;
        }
        let group = Self::get_group(session);
        if group != session {
            if let Some(&p) = self.workspaces.get(group) {
                return p;
            }
        }
        (999, 0)
    }

    pub fn set_idle(&mut self, idle: bool) {
        self.user_idle = idle;
    }

    pub fn set_auto_focus_config(&mut self, enabled: bool, focus_delay_ms: u64) {
        self.auto_focus_enabled = enabled;
        self.focus_delay_ms = focus_delay_ms;
    }

    pub fn should_auto_focus(&self) -> bool {
        self.user_idle && self.has_eligible_in_queue()
    }

    fn is_session_eligible(&self, session: &str) -> bool {
        let info = match self.sessions.get(session) {
            Some(i) => i,
            None => return false,
        };
        let mode = self
            .per_session_auto_focus
            .get(session)
            .copied()
            .unwrap_or(AutoFocusMode::Off);
        match info.state {
            AgentState::Awaiting => self.auto_focus_enabled || mode != AutoFocusMode::Off,
            AgentState::Completed => mode == AutoFocusMode::AwaitingCompleted,
            _ => false,
        }
    }

    fn has_eligible_in_queue(&self) -> bool {
        self.awaiting_queue.iter().any(|s| self.is_session_eligible(s))
    }

    pub fn focus_delay_ms(&self) -> u64 {
        self.focus_delay_ms
    }

    pub fn next_awaiting(&mut self) -> Option<String> {
        let session = self.awaiting_queue
            .iter()
            .find(|s| self.is_session_eligible(s))?
            .clone();
        self.auto_focus_active = true;
        self.last_auto_focused = Some(session.clone());
        Some(session)
    }

    pub fn clear_all(&mut self) {
        self.sessions.clear();
        self.workspaces.clear();
        self.awaiting_queue.clear();
        self.per_session_auto_focus.clear();
        self.last_auto_focused = None;
        self.focused_group = None;
        self.last_focus_index = 0;
    }

    pub fn mark_all_started(&mut self) {
        for info in self.sessions.values_mut() {
            if info.state == AgentState::Awaiting {
                info.state = AgentState::Started;
            }
        }
        self.awaiting_queue.clear();
    }

    pub fn get_render_data(&self) -> Vec<AgentInfo> {
        let mut keys: Vec<&String> = self.sessions.keys().collect();
        keys.sort_by(|a, b| {
            let (ws_a, mon_a) = self.get_placement(a);
            let (ws_b, mon_b) = self.get_placement(b);
            mon_a.cmp(&mon_b).then(ws_a.cmp(&ws_b)).then_with(|| a.cmp(b))
        });

        let mut agents = Vec::with_capacity(keys.len());
        let mut group = 0u32;
        let mut prev_group: Option<&str> = None;

        for session in keys {
            let info = &self.sessions[session];
            let g = Self::get_group(session);
            if prev_group != Some(g) {
                if prev_group.is_some() {
                    group += 1;
                }
                prev_group = Some(g);
            }
            let focused = self.focused_group.as_deref() == Some(g);
            let awaiting_since_unix = info.awaiting_since.map(|instant| {
                let elapsed = instant.elapsed();
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .saturating_sub(elapsed)
                    .as_secs()
            });
            agents.push(AgentInfo {
                session: session.clone(),
                state: info.state,
                focused,
                group,
                agent_type: info.agent_type.clone(),
                tool: info.tool.clone(),
                awaiting_since_unix,
                uncommitted_count: info.uncommitted_count,
                auto_focus_mode: self
                    .per_session_auto_focus
                    .get(session)
                    .copied()
                    .unwrap_or(AutoFocusMode::Off)
                    .as_u8(),
            });
        }

        for agent in &agents {
            let (ws, mon) = self.get_placement(&agent.session);
            debug!("[sort] {} g:{} ws:{} mon:{}", agent.session, agent.group, ws, mon);
        }

        agents
    }

    pub fn focus_next(&mut self) -> Option<String> {
        for priority_state in FOCUS_PRIORITIES {
            let mut matching: Vec<&String> = self
                .sessions
                .iter()
                .filter(|(_, info)| info.state == *priority_state)
                .map(|(s, _)| s)
                .collect();

            if matching.is_empty() {
                continue;
            }

            matching.sort_by(|a, b| {
                let (ws_a, mon_a) = self.get_placement(a);
                let (ws_b, mon_b) = self.get_placement(b);
                mon_a.cmp(&mon_b).then(ws_a.cmp(&ws_b)).then_with(|| a.cmp(b))
            });

            self.last_focus_index = (self.last_focus_index + 1) % matching.len();
            return Some(matching[self.last_focus_index].clone());
        }
        None
    }

    fn title_matches_group(title: &str, group: &str) -> bool {
        let mut start = 0;
        while let Some(pos) = title[start..].find(group) {
            let abs_pos = start + pos;
            let before_ok = abs_pos == 0 || {
                let ch = title.as_bytes()[abs_pos - 1];
                !ch.is_ascii_alphanumeric() && ch != b'_' && ch != b'.' && ch != b'-'
            };
            let after_pos = abs_pos + group.len();
            let after_ok = after_pos >= title.len() || {
                let ch = title.as_bytes()[after_pos];
                !ch.is_ascii_alphanumeric() && ch != b'_' && ch != b'.' && ch != b'-'
            };
            if before_ok && after_ok {
                return true;
            }
            start = abs_pos + title[abs_pos..].chars().next().map_or(1, |c| c.len_utf8());
        }
        false
    }

    fn get_group(session: &str) -> &str {
        session.split('#').next().unwrap_or(session)
    }

    #[cfg(feature = "test-helpers")]
    pub fn force_expire_session(&mut self, session: &str) {
        if let Some(info) = self.sessions.get_mut(session) {
            info.ended_at = Some(Instant::now() - Duration::from_secs(60));
        }
    }

    #[cfg(feature = "test-helpers")]
    pub fn force_stale_session(&mut self, session: &str) {
        if let Some(info) = self.sessions.get_mut(session) {
            info.last_activity = Instant::now() - Duration::from_secs(120);
        }
    }
}

impl Default for StateManager {
    fn default() -> Self {
        Self::new()
    }
}
