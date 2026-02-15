use std::sync::Arc;

use argus_agenticus::protocol::{AgentInfo, AgentState, IncomingMessage, OutgoingMessage};

#[test]
fn deserialize_state() {
    let json = r#"{"type":"state","session":"p#1","state":"started","tool":"bash","agent_type":"claude"}"#;
    let msg: IncomingMessage = serde_json::from_str(json).unwrap();
    match msg {
        IncomingMessage::State { session, state, tool, agent_type } => {
            assert_eq!(session, "p#1");
            assert_eq!(state, AgentState::Started);
            assert_eq!(tool, "bash");
            assert_eq!(agent_type, "claude");
        }
        other => panic!("expected State, got {other:?}"),
    }
}

#[test]
fn deserialize_state_default_agent_type() {
    let json = r#"{"type":"state","session":"p#1","state":"awaiting","tool":"bash"}"#;
    let msg: IncomingMessage = serde_json::from_str(json).unwrap();
    match msg {
        IncomingMessage::State { agent_type, .. } => {
            assert_eq!(agent_type, "claude");
        }
        other => panic!("expected State, got {other:?}"),
    }
}

#[test]
fn deserialize_state_custom_agent_type() {
    let json = r#"{"type":"state","session":"p#1","state":"started","tool":"bash","agent_type":"cursor"}"#;
    let msg: IncomingMessage = serde_json::from_str(json).unwrap();
    match msg {
        IncomingMessage::State { agent_type, .. } => {
            assert_eq!(agent_type, "cursor");
        }
        other => panic!("expected State, got {other:?}"),
    }
}

#[test]
fn deserialize_window_focus() {
    let json = r#"{"type":"window_focus","title":"proj - editor"}"#;
    let msg: IncomingMessage = serde_json::from_str(json).unwrap();
    match msg {
        IncomingMessage::WindowFocus { title, agent_type } => {
            assert_eq!(title, "proj - editor");
            assert_eq!(agent_type, "");
        }
        other => panic!("expected WindowFocus, got {other:?}"),
    }
}

#[test]
fn deserialize_window_focus_with_agent_type() {
    let json = r#"{"type":"window_focus","title":"file.ts - proj - Cursor","agent_type":"cursor"}"#;
    let msg: IncomingMessage = serde_json::from_str(json).unwrap();
    match msg {
        IncomingMessage::WindowFocus { title, agent_type } => {
            assert_eq!(title, "file.ts - proj - Cursor");
            assert_eq!(agent_type, "cursor");
        }
        other => panic!("expected WindowFocus, got {other:?}"),
    }
}

#[test]
fn deserialize_session_workspace() {
    let json = r#"{"type":"session_workspace","session":"proj#1","workspace":3}"#;
    let msg: IncomingMessage = serde_json::from_str(json).unwrap();
    match msg {
        IncomingMessage::SessionWorkspace { session, workspace, monitor } => {
            assert_eq!(session, "proj#1");
            assert_eq!(workspace, 3);
            assert_eq!(monitor, 0);
        }
        other => panic!("expected SessionWorkspace, got {other:?}"),
    }
}

#[test]
fn deserialize_session_workspace_with_monitor() {
    let json = r#"{"type":"session_workspace","session":"proj#1","workspace":3,"monitor":2}"#;
    let msg: IncomingMessage = serde_json::from_str(json).unwrap();
    match msg {
        IncomingMessage::SessionWorkspace { session, workspace, monitor } => {
            assert_eq!(session, "proj#1");
            assert_eq!(workspace, 3);
            assert_eq!(monitor, 2);
        }
        other => panic!("expected SessionWorkspace, got {other:?}"),
    }
}

#[test]
fn deserialize_click() {
    let json = r#"{"type":"click","session":"proj#1"}"#;
    let msg: IncomingMessage = serde_json::from_str(json).unwrap();
    match msg {
        IncomingMessage::Click { session } => {
            assert_eq!(session, "proj#1");
        }
        other => panic!("expected Click, got {other:?}"),
    }
}

#[test]
fn deserialize_focus_next() {
    let json = r#"{"type":"focus_next"}"#;
    let msg: IncomingMessage = serde_json::from_str(json).unwrap();
    assert!(matches!(msg, IncomingMessage::FocusNext));
}

#[test]
fn deserialize_idle_status() {
    let json = r#"{"type":"idle_status","idle":true}"#;
    let msg: IncomingMessage = serde_json::from_str(json).unwrap();
    match msg {
        IncomingMessage::IdleStatus { idle } => assert!(idle),
        other => panic!("expected IdleStatus, got {other:?}"),
    }
}

#[test]
fn deserialize_auto_focus_config() {
    let json = r#"{"type":"auto_focus_config","enabled":true,"focus_delay_ms":500}"#;
    let msg: IncomingMessage = serde_json::from_str(json).unwrap();
    match msg {
        IncomingMessage::AutoFocusConfig { enabled, focus_delay_ms } => {
            assert!(enabled);
            assert_eq!(focus_delay_ms, 500);
        }
        other => panic!("expected AutoFocusConfig, got {other:?}"),
    }
}

#[test]
fn serialize_render() {
    let msg = OutgoingMessage::Render {
        agents: vec![AgentInfo {
            session: "proj#1".to_string(),
            state: AgentState::Started,
            focused: true,
            group: 0,
            agent_type: Arc::from("claude"),
        }],
    };
    let json = serde_json::to_string(&msg).unwrap();
    let v: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert_eq!(v["type"], "render");
    assert_eq!(v["agents"][0]["session"], "proj#1");
    assert_eq!(v["agents"][0]["state"], "started");
    assert_eq!(v["agents"][0]["focused"], true);
    assert_eq!(v["agents"][0]["group"], 0);
    assert_eq!(v["agents"][0]["agent_type"], "claude");
}

#[test]
fn serialize_focus() {
    let msg = OutgoingMessage::Focus { session: "proj#1".to_string(), agent_type: "claude".to_string() };
    let json = serde_json::to_string(&msg).unwrap();
    let v: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert_eq!(v["type"], "focus");
    assert_eq!(v["session"], "proj#1");
    assert_eq!(v["agent_type"], "claude");
}

#[test]
fn serialize_auto_focus() {
    let msg = OutgoingMessage::AutoFocus { session: "proj#1".to_string(), agent_type: "claude".to_string() };
    let json = serde_json::to_string(&msg).unwrap();
    let v: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert_eq!(v["type"], "auto_focus");
    assert_eq!(v["session"], "proj#1");
    assert_eq!(v["agent_type"], "claude");
}

#[test]
fn serialize_return_workspace() {
    let msg = OutgoingMessage::ReturnWorkspace;
    let json = serde_json::to_string(&msg).unwrap();
    let v: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert_eq!(v["type"], "return_workspace");
}

#[test]
fn all_agent_states() {
    let states = [
        ("started", AgentState::Started),
        ("awaiting", AgentState::Awaiting),
        ("working", AgentState::Working),
        ("processing", AgentState::Processing),
        ("completed", AgentState::Completed),
        ("ended", AgentState::Ended),
    ];
    for (name, expected) in &states {
        let json = format!(
            r#"{{"type":"state","session":"s#1","state":"{}","tool":"t"}}"#,
            name
        );
        let msg: IncomingMessage = serde_json::from_str(&json).unwrap();
        match msg {
            IncomingMessage::State { state, .. } => assert_eq!(state, *expected, "state: {name}"),
            other => panic!("expected State for {name}, got {other:?}"),
        }
    }
}

#[test]
fn deserialize_window_closed() {
    let json = r#"{"type":"window_closed","session":"proj#1"}"#;
    let msg: IncomingMessage = serde_json::from_str(json).unwrap();
    match msg {
        IncomingMessage::WindowClosed { session } => {
            assert_eq!(session, "proj#1");
        }
        other => panic!("expected WindowClosed, got {other:?}"),
    }
}

#[test]
fn invalid_json_error() {
    let result = serde_json::from_str::<IncomingMessage>("not json at all");
    assert!(result.is_err());
}

#[test]
fn unknown_type_error() {
    let json = r#"{"type":"unknown_message"}"#;
    let result = serde_json::from_str::<IncomingMessage>(json);
    assert!(result.is_err());
}

#[test]
fn missing_required_field() {
    let json = r#"{"type":"state"}"#;
    let result = serde_json::from_str::<IncomingMessage>(json);
    assert!(result.is_err());
}
