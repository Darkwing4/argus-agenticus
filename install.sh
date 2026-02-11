#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/darkwing4/argus-agenticus.git"
RELEASES_URL="https://github.com/Darkwing4/argus-agenticus/releases/latest/download"
HOOK_CMD="bash ~/.claude/hooks/events-to-socket.sh"

info()  { printf '\033[1;34m==> %s\033[0m\n' "$*"; }
warn()  { printf '\033[1;33m==> %s\033[0m\n' "$*"; }
err()   { printf '\033[1;31m==> %s\033[0m\n' "$*" >&2; exit 1; }

check_dep() {
    command -v "$1" >/dev/null 2>&1
}

require_dep() {
    check_dep "$1" || err "$1 is required but not found. Please install it first."
}

require_dep jq

if ! check_dep socat && ! check_dep nc; then
    warn "Neither socat nor nc found. Hook script needs one of them to send events to the daemon."
    warn "Install socat: sudo apt install socat  (or your package manager equivalent)"
fi

ARCH=$(uname -m)
case "$ARCH" in
    x86_64)  BINARY_NAME="argus-agenticus-linux-x86_64" ;;
    aarch64) BINARY_NAME="argus-agenticus-linux-aarch64" ;;
    *)       BINARY_NAME="" ;;
esac

REPO_DIR=""
CLONED=false
BUILT_FROM_SOURCE=false

mkdir -p ~/.local/bin

if [ -n "$BINARY_NAME" ] && check_dep curl; then
    info "Downloading pre-built binary ($ARCH)..."
    if curl -fsSL "$RELEASES_URL/$BINARY_NAME" -o ~/.local/bin/argus-agenticus; then
        chmod +x ~/.local/bin/argus-agenticus
        info "Binary installed from GitHub Releases."
    else
        warn "Download failed, falling back to build from source."
        BINARY_NAME=""
    fi
fi

if [ -z "$BINARY_NAME" ] || [ ! -x ~/.local/bin/argus-agenticus ]; then
    require_dep cargo

    if [ -f "src/daemon/Cargo.toml" ]; then
        REPO_DIR="$(pwd)"
    else
        require_dep git
        info "Cloning repository..."
        REPO_DIR="$(mktemp -d)/argus-agenticus"
        git clone --depth 1 "$REPO_URL" "$REPO_DIR"
        CLONED=true
    fi

    info "Building daemon from source..."
    cargo build --release --manifest-path "$REPO_DIR/src/daemon/Cargo.toml"
    cp "$REPO_DIR/src/daemon/target/release/argus-agenticus" ~/.local/bin/
    chmod +x ~/.local/bin/argus-agenticus
    BUILT_FROM_SOURCE=true
fi

if [ -z "$REPO_DIR" ]; then
    if [ -f "src/hooks/events-to-socket.sh" ]; then
        REPO_DIR="$(pwd)"
    else
        require_dep git
        info "Cloning repository for config files..."
        REPO_DIR="$(mktemp -d)/argus-agenticus"
        git clone --depth 1 "$REPO_URL" "$REPO_DIR"
        CLONED=true
    fi
fi

info "Installing hook script..."
mkdir -p ~/.claude/hooks
cp "$REPO_DIR/src/hooks/events-to-socket.sh" ~/.claude/hooks/events-to-socket.sh
chmod +x ~/.claude/hooks/events-to-socket.sh

info "Configuring Claude Code hooks..."
CLAUDE_SETTINGS="$HOME/.claude/settings.json"
if [ ! -f "$CLAUDE_SETTINGS" ]; then
    echo '{}' > "$CLAUDE_SETTINGS"
fi

CLAUDE_EVENTS='["SessionStart","PreToolUse","PostToolUse","PostToolUseFailure","PermissionRequest","UserPromptSubmit","Stop","SessionEnd"]'

TMP_SETTINGS=$(mktemp)
cp "$CLAUDE_SETTINGS" "$TMP_SETTINGS"

for EVENT in $(echo "$CLAUDE_EVENTS" | jq -r '.[]'); do
    ALREADY=$(jq -r --arg e "$EVENT" --arg cmd "$HOOK_CMD" \
        '.hooks[$e] // [] | map(select(.hooks[]?.command == $cmd)) | length' \
        "$TMP_SETTINGS" 2>/dev/null || echo "0")

    if [ "$ALREADY" = "0" ]; then
        jq --arg e "$EVENT" --arg cmd "$HOOK_CMD" \
            '.hooks[$e] = (.hooks[$e] // []) + [{"hooks": [{"type": "command", "command": $cmd}]}]' \
            "$TMP_SETTINGS" > "${TMP_SETTINGS}.new" && mv "${TMP_SETTINGS}.new" "$TMP_SETTINGS"
    fi
done

mv "$TMP_SETTINGS" "$CLAUDE_SETTINGS"

if [ -d "$HOME/.cursor" ]; then
    info "Configuring Cursor hooks..."
    CURSOR_HOOKS="$HOME/.cursor/hooks.json"
    if [ ! -f "$CURSOR_HOOKS" ]; then
        echo '{"version": 1, "hooks": {}}' > "$CURSOR_HOOKS"
    fi

    CURSOR_EVENTS='["sessionStart","beforeSubmitPrompt","preToolUse","beforeShellExecution","beforeMCPExecution","afterShellExecution","afterMCPExecution","postToolUse","postToolUseFailure","stop","sessionEnd"]'

    TMP_CURSOR=$(mktemp)
    cp "$CURSOR_HOOKS" "$TMP_CURSOR"

    for EVENT in $(echo "$CURSOR_EVENTS" | jq -r '.[]'); do
        ALREADY=$(jq -r --arg e "$EVENT" --arg cmd "$HOOK_CMD" \
            '.hooks[$e] // [] | map(select(.command == $cmd)) | length' \
            "$TMP_CURSOR" 2>/dev/null || echo "0")

        if [ "$ALREADY" = "0" ]; then
            jq --arg e "$EVENT" --arg cmd "$HOOK_CMD" \
                '.hooks[$e] = (.hooks[$e] // []) + [{"command": $cmd}]' \
                "$TMP_CURSOR" > "${TMP_CURSOR}.new" && mv "${TMP_CURSOR}.new" "$TMP_CURSOR"
        fi
    done

    mv "$TMP_CURSOR" "$CURSOR_HOOKS"
fi

info "Installing systemd service..."
mkdir -p ~/.config/systemd/user
cp "$REPO_DIR/src/service/argus-agenticus.service" ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now argus-agenticus

GNOME_INSTALLED=false
if echo "${XDG_CURRENT_DESKTOP:-}" | grep -qi gnome || check_dep gnome-shell; then
    info "Installing GNOME extension..."
    EXT_DIR="$HOME/.local/share/gnome-shell/extensions/argus-agenticus@darkwing4.dev"
    EXT_SRC="$REPO_DIR/src/clients/gnome/argus-agenticus@darkwing4.dev"

    if [ "$CLONED" = true ]; then
        rm -rf "$EXT_DIR"
        mkdir -p "$(dirname "$EXT_DIR")"
        cp -r "$EXT_SRC" "$EXT_DIR"
    else
        if [ -L "$EXT_DIR" ] || [ -e "$EXT_DIR" ]; then
            rm -rf "$EXT_DIR"
        fi
        mkdir -p "$(dirname "$EXT_DIR")"
        ln -s "$(realpath "$EXT_SRC")" "$EXT_DIR"
    fi

    gnome-extensions enable argus-agenticus@darkwing4.dev 2>/dev/null || true
    GNOME_INSTALLED=true
fi

echo ""
info "Installation complete!"
echo ""
echo "  Daemon:          ~/.local/bin/argus-agenticus"
echo "  Hook script:     ~/.claude/hooks/events-to-socket.sh"
echo "  Claude hooks:    ~/.claude/settings.json"
[ -d "$HOME/.cursor" ] && echo "  Cursor hooks:    ~/.cursor/hooks.json"
echo "  Systemd service: ~/.config/systemd/user/argus-agenticus.service"
if [ "$GNOME_INSTALLED" = true ]; then
    echo "  GNOME extension: installed"
    echo ""
    warn "GNOME: Log out and log back in to activate the extension."
fi
echo ""
systemctl --user status argus-agenticus --no-pager || true

if [ "$CLONED" = true ]; then
    rm -rf "$(dirname "$REPO_DIR")"
fi
