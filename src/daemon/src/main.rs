mod connection;
mod handler;
mod protocol;
mod socket;
mod state;
mod tasks;

use std::env;
use std::path::PathBuf;

use tracing::info;
use tracing_subscriber::EnvFilter;

use crate::socket::SocketServer;

#[tokio::main]
async fn main() -> std::io::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("info".parse().unwrap()))
        .init();

    let socket_path = get_socket_path();
    info!("argus-agenticus starting...");

    let server = SocketServer::new(socket_path);
    server.run().await
}

fn get_socket_path() -> PathBuf {
    let runtime_dir = env::var("XDG_RUNTIME_DIR").unwrap_or_else(|_| "/tmp".to_string());
    PathBuf::from(runtime_dir)
        .join("agents-monitor")
        .join("daemon.sock")
}
