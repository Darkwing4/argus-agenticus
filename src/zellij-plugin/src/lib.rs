use std::collections::BTreeMap;

use zellij_tile::prelude::*;

#[no_mangle]
pub fn _start() {}

#[derive(Default)]
struct ArgusFocus;

register_plugin!(ArgusFocus);

impl ZellijPlugin for ArgusFocus {
    fn load(&mut self, _configuration: BTreeMap<String, String>) {
        request_permission(&[
            PermissionType::ChangeApplicationState,
            PermissionType::ReadCliPipes,
        ]);
        subscribe(&[EventType::PermissionRequestResult]);
    }

    fn update(&mut self, event: Event) -> bool {
        if let Event::PermissionRequestResult(_) = event {
            hide_self();
        }
        false
    }

    fn pipe(&mut self, pipe_message: PipeMessage) -> bool {
        if let Some(payload) = pipe_message.payload {
            if let Ok(pane_id) = payload.trim().parse::<u32>() {
                focus_terminal_pane(pane_id, false);
            }
        }
        unblock_cli_pipe_input(&pipe_message.name);
        false
    }
}
