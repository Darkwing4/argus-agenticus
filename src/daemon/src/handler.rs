use std::sync::Arc;

use tokio::sync::Mutex;
use tracing::{debug, info};
use tracing_subscriber::EnvFilter;

use crate::protocol::IncomingMessage;
use crate::protocol::OutgoingMessage;
use crate::state::{AutoFocusEvent, StateManager, LOG_RELOAD_HANDLE};

pub struct Effects {
    pub reply: Option<OutgoingMessage>,
    pub auto_focus: AutoFocusEvent,
    pub mark_extension: bool,
    pub broadcast_render: bool,
}

pub async fn process(
    msg: IncomingMessage,
    state: &Arc<Mutex<StateManager>>,
) -> Effects {
    match msg {
        IncomingMessage::State { session, state: agent_state, tool, agent_type, uncommitted_count, multiplexer } => {
            debug!("State: {} -> {:?} ({}) [{}]", session, agent_state, tool, agent_type);
            let agent_type: Arc<str> = agent_type.into();
            let multiplexer: Option<Arc<str>> = multiplexer.map(|m| m.into());
            let mut s = state.lock().await;
            let event = s.update_state(session, agent_state, tool, agent_type, uncommitted_count, multiplexer);
            Effects {
                reply: None,
                auto_focus: event,
                mark_extension: false,
                broadcast_render: true,
            }
        }

        IncomingMessage::WindowFocus { title, agent_type } => {
            debug!("Window focus: {} [{}]", title, agent_type);
            let mut s = state.lock().await;
            let at = if agent_type.is_empty() { None } else { Some(agent_type.as_str()) };
            let (_, af_event) = s.update_window_focus(&title, at);
            Effects {
                reply: None,
                auto_focus: af_event,
                mark_extension: true,
                broadcast_render: true,
            }
        }

        IncomingMessage::SessionWorkspace { session, workspace, monitor } => {
            debug!("Session workspace: {} -> ws:{} mon:{}", session, workspace, monitor);
            debug!("[sort] workspace {} ws:{} mon:{}", session, workspace, monitor);
            let mut s = state.lock().await;
            s.update_workspace(&session, workspace, monitor);
            Effects {
                reply: None,
                auto_focus: AutoFocusEvent::None,
                mark_extension: false,
                broadcast_render: true,
            }
        }

        IncomingMessage::Click { session } => {
            debug!("Click: {}", session);
            let s = state.lock().await;
            let agent_type = s.get_agent_type(&session);
            let multiplexer = s.get_multiplexer(&session);
            Effects {
                reply: Some(OutgoingMessage::Focus { session, agent_type, multiplexer }),
                auto_focus: AutoFocusEvent::None,
                mark_extension: false,
                broadcast_render: false,
            }
        }

        IncomingMessage::FocusNext => {
            debug!("Focus next");
            let mut s = state.lock().await;
            let reply = s.focus_next().map(|session| {
                let agent_type = s.get_agent_type(&session);
                let multiplexer = s.get_multiplexer(&session);
                OutgoingMessage::Focus { session, agent_type, multiplexer }
            });
            Effects {
                reply,
                auto_focus: AutoFocusEvent::None,
                mark_extension: false,
                broadcast_render: false,
            }
        }

        IncomingMessage::IdleStatus { idle } => {
            debug!("Idle status: {}", idle);
            let mut s = state.lock().await;
            s.set_idle(idle);
            Effects {
                reply: None,
                auto_focus: AutoFocusEvent::Trigger,
                mark_extension: true,
                broadcast_render: false,
            }
        }

        IncomingMessage::ClearAgents => {
            debug!("Clear agents");
            let mut s = state.lock().await;
            s.clear_all();
            Effects {
                reply: None,
                auto_focus: AutoFocusEvent::None,
                mark_extension: false,
                broadcast_render: true,
            }
        }

        IncomingMessage::MarkAllStarted => {
            debug!("Mark all started");
            let mut s = state.lock().await;
            s.mark_all_started();
            Effects {
                reply: None,
                auto_focus: AutoFocusEvent::None,
                mark_extension: false,
                broadcast_render: true,
            }
        }

        IncomingMessage::AutoFocusConfig { enabled, focus_delay_ms } => {
            debug!("Auto-focus config: enabled={}, delay={}ms", enabled, focus_delay_ms);
            let mut s = state.lock().await;
            s.set_auto_focus_config(enabled, focus_delay_ms);
            Effects {
                reply: None,
                auto_focus: AutoFocusEvent::Trigger,
                mark_extension: true,
                broadcast_render: false,
            }
        }

        IncomingMessage::CycleAutoFocus { session } => {
            debug!("Cycle auto-focus: {}", session);
            let mut s = state.lock().await;
            s.cycle_auto_focus(&session);
            Effects {
                reply: None,
                auto_focus: AutoFocusEvent::Trigger,
                mark_extension: false,
                broadcast_render: true,
            }
        }

        IncomingMessage::CycleAutoFocusGroup { group } => {
            debug!("Cycle auto-focus group: {}", group);
            let mut s = state.lock().await;
            s.cycle_auto_focus_group(&group);
            Effects {
                reply: None,
                auto_focus: AutoFocusEvent::Trigger,
                mark_extension: false,
                broadcast_render: true,
            }
        }

        IncomingMessage::WindowClosed { session } => {
            debug!("Window closed: {}", session);
            let mut s = state.lock().await;
            let (_, af_event) = s.remove_session(&session);
            Effects {
                reply: None,
                auto_focus: af_event,
                mark_extension: false,
                broadcast_render: true,
            }
        }

        IncomingMessage::SetLogLevel { level } => {
            info!("Log level: {}", level);
            if let Some(handle) = LOG_RELOAD_HANDLE.get() {
                let directive = match level.as_str() {
                    "off" => "off",
                    "error" => "error",
                    "warn" => "warn",
                    "info" => "info",
                    "debug" => "debug",
                    _ => "info",
                };
                let filter = EnvFilter::new(directive);
                let _ = handle.reload(filter);
            }
            Effects {
                reply: None,
                auto_focus: AutoFocusEvent::None,
                mark_extension: false,
                broadcast_render: false,
            }
        }
    }
}
