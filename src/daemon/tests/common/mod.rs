use std::sync::Arc;

use tokio::sync::Mutex;

use argus_agenticus::handler::Effects;
use argus_agenticus::protocol::{AgentState, IncomingMessage, OutgoingMessage};
use argus_agenticus::state::{AutoFocusEvent, StateManager};

pub fn to_s(v: &str) -> String {
    v.to_string()
}

#[allow(dead_code)]
pub fn to_arc(v: &str) -> Arc<str> {
    Arc::from(v)
}

pub fn fresh_state() -> Arc<Mutex<StateManager>> {
    Arc::new(Mutex::new(StateManager::new()))
}

pub fn msg_state(session: &str, state: AgentState) -> IncomingMessage {
    IncomingMessage::State {
        session: to_s(session),
        state,
        tool: to_s("bash"),
        agent_type: to_s("claude"),
    }
}

pub fn msg_window_focus(title: &str) -> IncomingMessage {
    IncomingMessage::WindowFocus { title: to_s(title) }
}

pub fn msg_workspace(session: &str, ws: u32) -> IncomingMessage {
    IncomingMessage::SessionWorkspace {
        session: to_s(session),
        workspace: ws,
        monitor: 0,
    }
}

pub fn msg_click(session: &str) -> IncomingMessage {
    IncomingMessage::Click { session: to_s(session) }
}

pub fn msg_focus_next() -> IncomingMessage {
    IncomingMessage::FocusNext
}

pub fn msg_idle(idle: bool) -> IncomingMessage {
    IncomingMessage::IdleStatus { idle }
}

pub fn msg_auto_focus_config(enabled: bool, delay_ms: u64) -> IncomingMessage {
    IncomingMessage::AutoFocusConfig {
        enabled,
        focus_delay_ms: delay_ms,
    }
}

pub fn should_broadcast(fx: &Effects) {
    assert!(fx.broadcast_render, "expected broadcast_render=true");
}

pub fn should_not_broadcast(fx: &Effects) {
    assert!(!fx.broadcast_render, "expected broadcast_render=false");
}

pub fn should_reply_focus(fx: &Effects, session: &str) {
    match &fx.reply {
        Some(OutgoingMessage::Focus { session: s }) => {
            assert_eq!(s, session, "expected Focus for '{session}', got '{s}'");
        }
        other => panic!("expected Focus reply for '{session}', got {other:?}"),
    }
}

pub fn should_have_no_reply(fx: &Effects) {
    assert!(fx.reply.is_none(), "expected no reply, got {:?}", fx.reply);
}

pub fn should_mark_extension(fx: &Effects) {
    assert!(fx.mark_extension, "expected mark_extension=true");
}

pub fn should_not_mark_extension(fx: &Effects) {
    assert!(!fx.mark_extension, "expected mark_extension=false");
}

pub fn should_trigger(fx: &Effects) {
    assert_eq!(
        fx.auto_focus, AutoFocusEvent::Trigger,
        "expected AutoFocusEvent::Trigger, got {:?}",
        fx.auto_focus
    );
}

pub fn should_queue_empty(fx: &Effects) {
    assert_eq!(
        fx.auto_focus, AutoFocusEvent::QueueEmpty,
        "expected AutoFocusEvent::QueueEmpty, got {:?}",
        fx.auto_focus
    );
}

pub fn should_no_auto_focus(fx: &Effects) {
    assert_eq!(
        fx.auto_focus, AutoFocusEvent::None,
        "expected AutoFocusEvent::None, got {:?}",
        fx.auto_focus
    );
}
