use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::protocol::{AgentInfo, AgentState};

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

#[derive(Debug, Clone)]
pub struct SessionInfo {
    pub state: AgentState,
    #[allow(dead_code)]
    pub tool: String,
    pub agent_type: Arc<str>,
    pub ended_at: Option<Instant>,
    pub last_activity: Instant,
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
        }
    }

    pub fn update_state(&mut self, session: String, state: AgentState, tool: String, agent_type: Arc<str>) -> AutoFocusEvent {
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

        self.sessions.insert(
            session.clone(),
            SessionInfo {
                state: actual_state,
                tool,
                agent_type,
                ended_at,
                last_activity: Instant::now(),
            },
        );

        let became_awaiting = actual_state == AgentState::Awaiting
            && prev_state != Some(AgentState::Awaiting);
        let left_awaiting = actual_state != AgentState::Awaiting
            && prev_state == Some(AgentState::Awaiting);

        if became_awaiting {
            if !self.awaiting_queue.contains(&session) {
                self.awaiting_queue.push(session);
            }
            return AutoFocusEvent::Trigger;
        }

        if left_awaiting || actual_state == AgentState::Ended {
            self.awaiting_queue.retain(|s| s != &session);
            if self.awaiting_queue.is_empty() && self.auto_focus_active {
                self.auto_focus_active = false;
                return AutoFocusEvent::QueueEmpty;
            }
            if left_awaiting {
                return AutoFocusEvent::Trigger;
            }
        }

        AutoFocusEvent::None
    }

    pub fn update_window_focus(&mut self, title: &str, agent_type: Option<&str>) -> bool {
        let new_focused = self
            .sessions
            .keys()
            .find(|s| title.contains(Self::get_group(s)))
            .map(|s| Self::get_group(s).to_string())
            .or_else(|| {
                let at = agent_type.filter(|a| !a.is_empty())?;
                self.sessions
                    .iter()
                    .find(|(_, info)| &*info.agent_type == at)
                    .map(|(s, _)| Self::get_group(s).to_string())
            });

        let changed = self.focused_group != new_focused;
        self.focused_group = new_focused;

        if let Some(ref group) = self.focused_group {
            for (session, info) in self.sessions.iter_mut() {
                if Self::get_group(session) == group
                    && info.state == AgentState::Completed
                {
                    info.state = AgentState::Started;
                }
            }
        }

        changed
    }

    pub fn remove_session(&mut self, session: &str) -> bool {
        self.awaiting_queue.retain(|s| s != session);
        self.workspaces.remove(session);
        self.sessions.remove(session).is_some()
    }

    pub fn get_agent_type(&self, session: &str) -> String {
        self.sessions
            .get(session)
            .map(|info| info.agent_type.to_string())
            .unwrap_or_default()
    }

    pub fn cleanup_ended(&mut self) -> bool {
        let now = Instant::now();
        let mut changed = false;

        for (session, info) in self.sessions.iter_mut() {
            if info.ended_at.is_none()
                && &*info.agent_type != "claude"
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
        self.sessions.retain(|_, info| {
            if let Some(ended_at) = info.ended_at {
                return now.duration_since(ended_at) < ENDED_HIDE_DELAY;
            }
            true
        });

        changed || self.sessions.len() != before
    }

    pub fn update_workspace(&mut self, session: &str, workspace: u32, monitor: u32) {
        let group = Self::get_group(session);
        self.workspaces.insert(group.to_string(), (workspace, monitor));
    }

    fn get_placement(&self, session: &str) -> (u32, u32) {
        self.workspaces.get(session).copied().unwrap_or((999, 0))
    }

    pub fn set_idle(&mut self, idle: bool) {
        self.user_idle = idle;
    }

    pub fn set_auto_focus_config(&mut self, enabled: bool, focus_delay_ms: u64) {
        self.auto_focus_enabled = enabled;
        self.focus_delay_ms = focus_delay_ms;
    }

    pub fn should_auto_focus(&self) -> bool {
        self.auto_focus_enabled && self.user_idle && !self.awaiting_queue.is_empty()
    }

    pub fn focus_delay_ms(&self) -> u64 {
        self.focus_delay_ms
    }

    pub fn next_awaiting(&mut self) -> Option<String> {
        if self.awaiting_queue.is_empty() {
            return None;
        }
        self.auto_focus_active = true;
        Some(self.awaiting_queue[0].clone())
    }

    pub fn clear_all(&mut self) {
        self.sessions.clear();
        self.workspaces.clear();
        self.awaiting_queue.clear();
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
            let (ws_a, mon_a) = self.get_placement(Self::get_group(a));
            let (ws_b, mon_b) = self.get_placement(Self::get_group(b));
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
            agents.push(AgentInfo {
                session: session.clone(),
                state: info.state,
                focused,
                group,
                agent_type: info.agent_type.clone(),
            });
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
                let (ws_a, mon_a) = self.get_placement(Self::get_group(a));
                let (ws_b, mon_b) = self.get_placement(Self::get_group(b));
                mon_a.cmp(&mon_b).then(ws_a.cmp(&ws_b)).then_with(|| a.cmp(b))
            });

            self.last_focus_index = (self.last_focus_index + 1) % matching.len();
            return Some(matching[self.last_focus_index].clone());
        }
        None
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
