use std::sync::Arc;
use std::time::Duration;

use tokio::sync::{broadcast, Mutex, Notify};
use tracing::debug;

use crate::protocol::OutgoingMessage;
use crate::state::StateManager;

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
                        let session = {
                            let mut s = state.lock().await;
                            if s.should_auto_focus() { s.next_awaiting() } else { None }
                        };
                        if let Some(session) = session {
                            debug!("Auto-focus: {}", session);
                            let _ = tx.send(OutgoingMessage::AutoFocus { session });
                        }
                        break;
                    }
                    _ = notify.notified() => continue,
                }
            }
        }
    });
}
