use std::sync::Arc;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentState {
    Started,
    Awaiting,
    Working,
    Processing,
    Completed,
    Ended,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum IncomingMessage {
    State {
        session: String,
        state: AgentState,
        tool: String,
        #[serde(default = "default_agent_type")]
        agent_type: String,
        #[serde(default)]
        session_name: Option<String>,
        #[serde(default)]
        uncommitted_count: Option<u32>,
        #[serde(default)]
        multiplexer: Option<String>,
    },
    WindowFocus {
        title: String,
        #[serde(default)]
        agent_type: String,
    },
    SessionWorkspace {
        session: String,
        workspace: u32,
        #[serde(default)]
        monitor: u32,
    },
    Click {
        session: String,
    },
    FocusNext,
    IdleStatus {
        idle: bool,
    },
    AutoFocusConfig {
        enabled: bool,
        focus_delay_ms: u64,
    },
    ClearAgents,
    MarkAllStarted,
    WindowClosed {
        session: String,
    },
    CycleAutoFocus {
        session: String,
    },
    CycleAutoFocusGroup {
        group: String,
    },
    SetLogLevel {
        level: String,
    },
}

fn default_agent_type() -> String {
    "claude".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentInfo {
    pub session: String,
    pub state: AgentState,
    pub focused: bool,
    pub group: u32,
    pub agent_type: Arc<str>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_name: Option<String>,
    #[serde(default)]
    pub tool: String,
    pub awaiting_since_unix: Option<u64>,
    pub uncommitted_count: Option<u32>,
    #[serde(default)]
    pub auto_focus_mode: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum OutgoingMessage {
    Render { agents: Vec<AgentInfo> },
    Focus {
        session: String,
        agent_type: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        multiplexer: Option<String>,
    },
    AutoFocus {
        session: String,
        agent_type: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        multiplexer: Option<String>,
    },
    ReturnWorkspace,
}
