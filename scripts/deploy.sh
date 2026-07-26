#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

EXT_SRC="$SRC_ROOT/src/clients/gnome/argus-agenticus@darkwing4.dev"
HOOK_SRC="$SRC_ROOT/src/hooks/events-to-socket.sh"
DAEMON_CARGO="$SRC_ROOT/src/daemon/Cargo.toml"

CURSOR_HOOKS_SRC="$SRC_ROOT/src/agents/cursor/hooks.json"

EXT_DST="$HOME/.local/share/gnome-shell/extensions/argus-agenticus@darkwing4.dev"
HOOK_DST="$HOME/.claude/hooks/events-to-socket.sh"
CURSOR_HOOKS_DST="$HOME/.cursor/hooks.json"
DAEMON_DST="$HOME/.local/bin/argus-agenticus"

info()  { printf '\033[1;34m==> %s\033[0m\n' "$*"; }
warn()  { printf '\033[1;33m==> %s\033[0m\n' "$*"; }
err()   { printf '\033[1;31m==> %s\033[0m\n' "$*" >&2; exit 1; }

[ -d "$EXT_SRC" ]  || err "Extension not found: $EXT_SRC"
[ -f "$HOOK_SRC" ] || err "Hook not found: $HOOK_SRC"
[ -f "$DAEMON_CARGO" ] || err "Cargo.toml not found: $DAEMON_CARGO"

info "Deploying from: $SRC_ROOT"

info "Extension symlink → $EXT_SRC"
ln -sfn "$EXT_SRC" "$EXT_DST"

info "Hook symlink → $HOOK_SRC"
mkdir -p "$(dirname "$HOOK_DST")"
ln -sfn "$HOOK_SRC" "$HOOK_DST"

if [ -d "$HOME/.cursor" ] && [ -f "$CURSOR_HOOKS_SRC" ]; then
    info "Cursor hooks symlink → $CURSOR_HOOKS_SRC"
    ln -sfn "$CURSOR_HOOKS_SRC" "$CURSOR_HOOKS_DST"
fi

info "Building daemon..."
cargo build --release --manifest-path "$DAEMON_CARGO"

info "Restarting daemon..."
systemctl --user stop argus-agenticus 2>/dev/null || true
cp "$SRC_ROOT/src/daemon/target/release/argus-agenticus" "$DAEMON_DST"
systemctl --user start argus-agenticus

echo ""
info "Done. Deployed from: $SRC_ROOT"
echo "  Extension: $(readlink -f "$EXT_DST")"
echo "  Hook:      $(readlink -f "$HOOK_DST")"
[ -f "$CURSOR_HOOKS_DST" ] && echo "  Cursor:    $(readlink -f "$CURSOR_HOOKS_DST")"
echo "  Daemon:    $DAEMON_DST (restarted)"
echo ""
warn "GNOME extension requires re-login to pick up changes (Wayland)."
