use std::env;

use tokio::process::Command;
use tracing::{debug, warn};

pub fn parse_zellij_target(session: &str) -> Option<(&str, u32)> {
    let (zellij_session, pane_str) = session.split_once('#')?;
    if pane_str.starts_with('s') || pane_str.starts_with("c-") {
        return None;
    }
    let pane_str = pane_str.strip_suffix("-cdx").unwrap_or(pane_str);
    let pane_id = pane_str.parse::<u32>().ok()?;
    Some((zellij_session, pane_id))
}

pub fn focus_pane(session: &str) {
    let Some((zellij_session, pane_id)) = parse_zellij_target(session) else {
        return;
    };

    let plugin_path = env::var("HOME")
        .map(|h| format!("file:{h}/.config/zellij/plugins/zellij-argus-agenticus.wasm"))
        .unwrap_or_else(|_| "file:~/.config/zellij/plugins/zellij-argus-agenticus.wasm".to_string());

    let zs = zellij_session.to_string();
    let pid = pane_id.to_string();

    tokio::spawn(async move {
        debug!("zellij focus: session={}, pane={}", zs, pid);
        let result = Command::new("zellij")
            .args(["--session", &zs, "action", "pipe", "--plugin", &plugin_path, "--name", "argus-agenticus", "--", &pid])
            .output()
            .await;

        match result {
            Ok(output) if !output.status.success() => {
                let stderr = String::from_utf8_lossy(&output.stderr);
                warn!("zellij pipe failed: {}", stderr.trim());
            }
            Err(e) => {
                debug!("zellij not available: {}", e);
            }
            _ => {}
        }
    });
}
