use std::sync::Arc;

use tokio::sync::Mutex;
use tracing::debug;

use crate::protocol::IncomingMessage;
use crate::protocol::OutgoingMessage;
use crate::state::{AutoFocusEvent, StateManager};

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
        IncomingMessage::State { session, state: agent_state, tool, agent_type } => {
            debug!("State: {} -> {:?} ({}) [{}]", session, agent_state, tool, agent_type);
            let agent_type: Arc<str> = agent_type.into();
            let mut s = state.lock().await;
            let event = s.update_state(session, agent_state, tool, agent_type);
            Effects { reply: None, auto_focus: event, mark_extension: false, broadcast_render: true }
        }

        IncomingMessage::WindowFocus { title } => {
            debug!("Window focus: {}", title);
            let mut s = state.lock().await;
            s.update_window_focus(&title);
            Effects { reply: None, auto_focus: AutoFocusEvent::None, mark_extension: true, broadcast_render: true }
        }

        IncomingMessage::SessionWorkspace { session, workspace, monitor } => {
            debug!("Session workspace: {} -> ws:{} mon:{}", session, workspace, monitor);
            let mut s = state.lock().await;
            s.update_workspace(&session, workspace, monitor);
            Effects { reply: None, auto_focus: AutoFocusEvent::None, mark_extension: false, broadcast_render: true }
        }

        IncomingMessage::Click { session } => {
            debug!("Click: {}", session);
            Effects {
                reply: Some(OutgoingMessage::Focus { session }),
                auto_focus: AutoFocusEvent::None,
                mark_extension: false,
                broadcast_render: false,
            }
        }

        IncomingMessage::FocusNext => {
            debug!("Focus next");
            let mut s = state.lock().await;
            let reply = s.focus_next().map(|session| OutgoingMessage::Focus { session });
            Effects { reply, auto_focus: AutoFocusEvent::None, mark_extension: false, broadcast_render: false }
        }

        IncomingMessage::IdleStatus { idle } => {
            debug!("Idle status: {}", idle);
            let mut s = state.lock().await;
            s.set_idle(idle);
            Effects { reply: None, auto_focus: AutoFocusEvent::Trigger, mark_extension: true, broadcast_render: false }
        }

        IncomingMessage::AutoFocusConfig { enabled, focus_delay_ms } => {
            debug!("Auto-focus config: enabled={}, delay={}ms", enabled, focus_delay_ms);
            let mut s = state.lock().await;
            s.set_auto_focus_config(enabled, focus_delay_ms);
            Effects { reply: None, auto_focus: AutoFocusEvent::Trigger, mark_extension: true, broadcast_render: false }
        }
    }
}
