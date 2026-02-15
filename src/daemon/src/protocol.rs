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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum OutgoingMessage {
    Render { agents: Vec<AgentInfo> },
    Focus { session: String, agent_type: String },
    AutoFocus { session: String, agent_type: String },
    ReturnWorkspace,
}
