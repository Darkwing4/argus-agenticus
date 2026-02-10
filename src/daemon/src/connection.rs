use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use bytes::BytesMut;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::unix::{OwnedReadHalf, OwnedWriteHalf};
use tokio::net::UnixStream;
use tokio::sync::{broadcast, mpsc, Mutex, Notify};
use tokio_util::codec::{Decoder, LinesCodec, LinesCodecError};
use tracing::warn;

use crate::handler;
use crate::protocol::{IncomingMessage, OutgoingMessage};
use crate::state::{AutoFocusEvent, StateManager};

const MAX_LINE_LENGTH: usize = 65_536;

pub struct Connection {
    state: Arc<Mutex<StateManager>>,
    broadcast_tx: broadcast::Sender<OutgoingMessage>,
    auto_focus_notify: Arc<Notify>,
}

impl Connection {
    pub fn new(
        state: Arc<Mutex<StateManager>>,
        broadcast_tx: broadcast::Sender<OutgoingMessage>,
        auto_focus_notify: Arc<Notify>,
    ) -> Self {
        Self { state, broadcast_tx, auto_focus_notify }
    }

    pub async fn run(&self, stream: UnixStream) -> std::io::Result<()> {
        let (reader, writer) = stream.into_split();
        let is_extension = AtomicBool::new(false);
        let (reply_tx, reply_rx) = mpsc::channel(16);
        let broadcast_rx = self.broadcast_tx.subscribe();

        tokio::select! {
            r = self.read_loop(reader, &reply_tx, &is_extension) => r?,
            _ = Self::write_loop(writer, reply_rx, broadcast_rx, &is_extension) => {},
        }

        Ok(())
    }

    async fn read_loop(
        &self,
        mut reader: OwnedReadHalf,
        reply_tx: &mpsc::Sender<OutgoingMessage>,
        is_extension: &AtomicBool,
    ) -> std::io::Result<()> {
        let mut codec = LinesCodec::new_with_max_length(MAX_LINE_LENGTH);
        let mut buf = BytesMut::with_capacity(4096);

        loop {
            match codec.decode(&mut buf) {
                Ok(Some(line)) => {
                    let trimmed = line.trim();
                    if !trimmed.is_empty() {
                        match serde_json::from_str::<IncomingMessage>(trimmed) {
                            Ok(msg) => {
                                let effects = handler::process(msg, &self.state).await;
                                self.apply(effects, reply_tx, is_extension).await;
                            }
                            Err(e) => warn!("Invalid JSON: {} - {}", trimmed, e),
                        }
                    }
                    continue;
                }
                Ok(None) => {}
                Err(LinesCodecError::MaxLineLengthExceeded) => {
                    warn!("Line too long, dropping");
                    continue;
                }
                Err(LinesCodecError::Io(e)) => return Err(e),
            }
            if reader.read_buf(&mut buf).await? == 0 {
                break;
            }
        }
        Ok(())
    }

    async fn apply(
        &self,
        effects: handler::Effects,
        reply_tx: &mpsc::Sender<OutgoingMessage>,
        is_extension: &AtomicBool,
    ) {
        if effects.mark_extension {
            is_extension.store(true, Ordering::Release);
        }

        if let Some(reply) = effects.reply {
            let _ = reply_tx.send(reply).await;
        }

        match effects.auto_focus {
            AutoFocusEvent::Trigger => self.auto_focus_notify.notify_one(),
            AutoFocusEvent::QueueEmpty => {
                let _ = self.broadcast_tx.send(OutgoingMessage::ReturnWorkspace);
            }
            AutoFocusEvent::None => {}
        }

        if effects.broadcast_render {
            let render = {
                let s = self.state.lock().await;
                OutgoingMessage::Render { agents: s.get_render_data() }
            };
            let _ = self.broadcast_tx.send(render);
        }
    }

    async fn write_loop(
        mut writer: OwnedWriteHalf,
        mut reply_rx: mpsc::Receiver<OutgoingMessage>,
        mut broadcast_rx: broadcast::Receiver<OutgoingMessage>,
        is_extension: &AtomicBool,
    ) {
        loop {
            let msg = tokio::select! {
                Some(msg) = reply_rx.recv() => msg,
                result = broadcast_rx.recv() => match result {
                    Ok(msg) if is_extension.load(Ordering::Acquire) => msg,
                    Ok(_) => continue,
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => break,
                },
            };

            let json = serde_json::to_string(&msg).expect("serialize OutgoingMessage") + "\n";
            if writer.write_all(json.as_bytes()).await.is_err() {
                break;
            }
        }
    }
}
