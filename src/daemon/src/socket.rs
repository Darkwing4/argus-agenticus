use std::path::PathBuf;
use std::sync::Arc;

use tokio::net::UnixListener;
use tokio::signal::{self, unix::{signal, SignalKind}};
use tokio::sync::{broadcast, Mutex, Notify};
use tracing::{debug, error, info};

use crate::connection::Connection;
use crate::protocol::OutgoingMessage;
use crate::state::StateManager;
use crate::tasks;

const CHANNEL_CAPACITY: usize = 64;

pub struct SocketServer {
    socket_path: PathBuf,
    state: Arc<Mutex<StateManager>>,
    broadcast_tx: broadcast::Sender<OutgoingMessage>,
    auto_focus_notify: Arc<Notify>,
}

impl SocketServer {
    pub fn new(socket_path: PathBuf) -> Self {
        let (broadcast_tx, _) = broadcast::channel(CHANNEL_CAPACITY);
        Self {
            socket_path,
            state: Arc::new(Mutex::new(StateManager::new())),
            broadcast_tx,
            auto_focus_notify: Arc::new(Notify::new()),
        }
    }

    pub async fn run(&self) -> std::io::Result<()> {
        if let Some(parent) = self.socket_path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }

        let _ = tokio::fs::remove_file(&self.socket_path).await;

        let listener = UnixListener::bind(&self.socket_path)?;
        info!("Listening on {:?}", self.socket_path);

        tasks::spawn_cleanup(Arc::clone(&self.state), self.broadcast_tx.clone());
        tasks::spawn_auto_focus(
            Arc::clone(&self.state),
            self.broadcast_tx.clone(),
            Arc::clone(&self.auto_focus_notify),
        );

        let mut sigterm = signal(SignalKind::terminate())?;

        loop {
            let stream = tokio::select! {
                result = listener.accept() => match result {
                    Ok((stream, _)) => stream,
                    Err(e) => { error!("Accept error: {}", e); continue; }
                },
                _ = signal::ctrl_c() => break,
                _ = sigterm.recv() => break,
            };

            let conn = Connection::new(
                Arc::clone(&self.state),
                self.broadcast_tx.clone(),
                Arc::clone(&self.auto_focus_notify),
            );
            tokio::spawn(async move {
                if let Err(e) = conn.run(stream).await {
                    debug!("Connection error: {}", e);
                }
            });
        }

        info!("Shutting down...");
        let _ = tokio::fs::remove_file(&self.socket_path).await;
        Ok(())
    }
}
