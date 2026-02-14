mod common;

use argus_agenticus::handler;
use argus_agenticus::protocol::{AgentState, IncomingMessage};

use common::*;

#[tokio::test]
async fn state_started_broadcasts() {
    let state = fresh_state();
    let fx = handler::process(msg_state("p#1", AgentState::Started), &state).await;
    should_broadcast(&fx);
    should_have_no_reply(&fx);
    should_not_mark_extension(&fx);
}

#[tokio::test]
async fn state_awaiting_triggers() {
    let state = fresh_state();
    let fx = handler::process(msg_state("p#1", AgentState::Awaiting), &state).await;
    should_trigger(&fx);
    should_broadcast(&fx);
    should_have_no_reply(&fx);
}

#[tokio::test]
async fn state_ended_no_trigger() {
    let state = fresh_state();
    handler::process(msg_state("p#1", AgentState::Started), &state).await;
    let fx = handler::process(msg_state("p#1", AgentState::Ended), &state).await;
    should_no_auto_focus(&fx);
    should_broadcast(&fx);
}

#[tokio::test]
async fn state_ended_queue_empty() {
    let state = fresh_state();
    handler::process(msg_state("p#1", AgentState::Awaiting), &state).await;
    {
        let mut s = state.lock().await;
        s.set_idle(true);
        s.set_auto_focus_config(true, 1000);
        s.next_awaiting();
    }
    let fx = handler::process(msg_state("p#1", AgentState::Ended), &state).await;
    should_queue_empty(&fx);
}

#[tokio::test]
async fn window_focus_marks_extension() {
    let state = fresh_state();
    let fx = handler::process(msg_window_focus("proj - editor"), &state).await;
    should_mark_extension(&fx);
    should_broadcast(&fx);
    should_have_no_reply(&fx);
    should_no_auto_focus(&fx);
}

#[tokio::test]
async fn workspace_broadcasts() {
    let state = fresh_state();
    let fx = handler::process(msg_workspace("proj#1", 2), &state).await;
    should_broadcast(&fx);
    should_have_no_reply(&fx);
    should_not_mark_extension(&fx);
    should_no_auto_focus(&fx);
}

#[tokio::test]
async fn click_replies_focus() {
    let state = fresh_state();
    let fx = handler::process(msg_click("proj#1"), &state).await;
    should_reply_focus(&fx, "proj#1");
}

#[tokio::test]
async fn click_no_broadcast() {
    let state = fresh_state();
    let fx = handler::process(msg_click("proj#1"), &state).await;
    should_not_broadcast(&fx);
    should_not_mark_extension(&fx);
    should_no_auto_focus(&fx);
}

#[tokio::test]
async fn focus_next_with_sessions() {
    let state = fresh_state();
    handler::process(msg_state("p#1", AgentState::Started), &state).await;
    let fx = handler::process(msg_focus_next(), &state).await;
    should_reply_focus(&fx, "p#1");
    should_not_broadcast(&fx);
}

#[tokio::test]
async fn focus_next_empty() {
    let state = fresh_state();
    let fx = handler::process(msg_focus_next(), &state).await;
    should_have_no_reply(&fx);
    should_not_broadcast(&fx);
}

#[tokio::test]
async fn idle_triggers() {
    let state = fresh_state();
    let fx = handler::process(msg_idle(true), &state).await;
    should_trigger(&fx);
    should_mark_extension(&fx);
}

#[tokio::test]
async fn idle_marks_extension() {
    let state = fresh_state();
    let fx = handler::process(msg_idle(false), &state).await;
    should_mark_extension(&fx);
    should_not_broadcast(&fx);
}

#[tokio::test]
async fn auto_focus_config_triggers() {
    let state = fresh_state();
    let fx = handler::process(msg_auto_focus_config(true, 500), &state).await;
    should_trigger(&fx);
    should_mark_extension(&fx);
    should_not_broadcast(&fx);
}

#[tokio::test]
async fn clear_agents_broadcasts() {
    let state = fresh_state();
    handler::process(msg_state("p#1", AgentState::Started), &state).await;
    handler::process(msg_state("p#2", AgentState::Awaiting), &state).await;

    let fx = handler::process(IncomingMessage::ClearAgents, &state).await;
    should_broadcast(&fx);
    should_have_no_reply(&fx);

    let data = state.lock().await.get_render_data();
    assert!(data.is_empty());
}

#[tokio::test]
async fn mark_all_started_broadcasts() {
    let state = fresh_state();
    handler::process(msg_state("p#1", AgentState::Awaiting), &state).await;
    handler::process(msg_state("p#2", AgentState::Awaiting), &state).await;
    handler::process(msg_state("p#3", AgentState::Working), &state).await;

    let fx = handler::process(IncomingMessage::MarkAllStarted, &state).await;
    should_broadcast(&fx);
    should_have_no_reply(&fx);

    let data = state.lock().await.get_render_data();
    for a in &data {
        if a.session == "p#1" || a.session == "p#2" {
            assert_eq!(a.state, AgentState::Started);
        }
        if a.session == "p#3" {
            assert_eq!(a.state, AgentState::Working);
        }
    }
}

#[tokio::test]
async fn window_closed_removes_session() {
    let state = fresh_state();
    handler::process(msg_state("p#1", AgentState::Started), &state).await;
    let fx = handler::process(msg_window_closed("p#1"), &state).await;
    should_broadcast(&fx);
    should_have_no_reply(&fx);
    should_no_auto_focus(&fx);
    should_not_mark_extension(&fx);
    let data = state.lock().await.get_render_data();
    assert!(data.is_empty(), "session should be removed, got {data:?}");
}

#[tokio::test]
async fn window_closed_clears_awaiting() {
    let state = fresh_state();
    handler::process(msg_state("p#1", AgentState::Awaiting), &state).await;
    handler::process(msg_window_closed("p#1"), &state).await;
    let mut s = state.lock().await;
    assert!(s.next_awaiting().is_none(), "awaiting queue should be empty");
}

#[tokio::test]
async fn window_closed_unknown_session() {
    let state = fresh_state();
    let fx = handler::process(msg_window_closed("nonexistent#1"), &state).await;
    should_broadcast(&fx);
    should_have_no_reply(&fx);
}

#[tokio::test]
async fn scenario_full_lifecycle() {
    let state = fresh_state();

    let fx = handler::process(msg_state("p#1", AgentState::Started), &state).await;
    should_no_auto_focus(&fx);
    should_broadcast(&fx);

    let fx = handler::process(msg_state("p#1", AgentState::Awaiting), &state).await;
    should_trigger(&fx);

    let fx = handler::process(msg_click("p#1"), &state).await;
    should_reply_focus(&fx, "p#1");

    let fx = handler::process(msg_state("p#1", AgentState::Ended), &state).await;
    should_broadcast(&fx);

    let data = state.lock().await.get_render_data();
    assert_eq!(data.len(), 1);
    assert_eq!(data[0].state, AgentState::Ended);
}
