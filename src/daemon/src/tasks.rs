use std::sync::Arc;
use std::time::Duration;

use tokio::sync::{broadcast, Mutex, Notify};
use tracing::debug;

use crate::protocol::OutgoingMessage;
use crate::state::StateManager;
use crate::zellij;

pub fn spawn_cleanup(state: Arc<Mutex<StateManager>>, tx: broadcast::Sender<OutgoingMessage>) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(5));
        loop {
            interval.tick().await;

            let render = {
                let mut s = state.lock().await;
                if !s.cleanup_ended() {
                    continue;
                }
                OutgoingMessage::Render { agents: s.get_render_data() }
            };
            let _ = tx.send(render);
        }
    });
}

pub fn spawn_auto_focus(
    state: Arc<Mutex<StateManager>>,
    tx: broadcast::Sender<OutgoingMessage>,
    notify: Arc<Notify>,
) {
    tokio::spawn(async move {
        loop {
            notify.notified().await;

            loop {
                let (should, delay) = {
                    let s = state.lock().await;
                    (s.should_auto_focus(), s.focus_delay_ms())
                };

                if !should {
                    break;
                }

                tokio::select! {
                    _ = tokio::time::sleep(Duration::from_millis(delay)) => {
                        let result = {
                            let mut s = state.lock().await;
                            if s.should_auto_focus() {
                                s.next_awaiting().map(|session| {
                                    let agent_type = s.get_agent_type(&session);
                                    let multiplexer = s.get_multiplexer(&session);
                                    (session, agent_type, multiplexer)
                                })
                            } else {
                                None
                            }
                        };
                        if let Some((session, agent_type, multiplexer)) = result {
                            debug!("Auto-focus: {}", session);
                            if multiplexer.as_deref() == Some("zellij") {
                                zellij::focus_pane(&session);
                            }
                            let _ = tx.send(OutgoingMessage::AutoFocus { session, agent_type, multiplexer });
                        }
                        break;
                    }
                    _ = notify.notified() => continue,
                }
            }
        }
    });
}
