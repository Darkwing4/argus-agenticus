#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MODE="headless"
PYTEST_ARGS=()

usage() {
    echo "Usage: $0 [--visible|--interactive] [pytest args...]"
    echo ""
    echo "Modes:"
    echo "  (default)       Headless gnome-shell, run pytest automatically"
    echo "  --visible       Nested gnome-shell window (devkit), run pytest"
    echo "  --interactive   Start infra, drop to shell for manual pytest"
    echo ""
    echo "Examples:"
    echo "  $0                          # run all tests headless"
    echo "  $0 --visible -k test_single # visible, filter tests"
    echo "  $0 --interactive            # start infra, manual control"
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --visible) MODE="visible"; shift ;;
        --interactive) MODE="interactive"; shift ;;
        --help|-h) usage; exit 0 ;;
        *) PYTEST_ARGS+=("$1"); shift ;;
    esac
done

for cmd in foot cargo gnome-shell dbus-daemon gdbus; do
    command -v "$cmd" >/dev/null 2>&1 || { echo "ERROR: $cmd not found"; exit 1; }
done

echo "==> Building daemon..."
cargo build --release --manifest-path "$REPO_ROOT/src/daemon/Cargo.toml" 2>&1 | tail -1
DAEMON_BIN="$REPO_ROOT/src/daemon/target/release/argus-agenticus"

TD=$(mktemp -d /tmp/argus-e2e-XXXX)
mkdir -p "$TD/agents-monitor"

DBUS_PID=""
DAEMON_PID=""
SHELL_PID=""

cleanup() {
    echo "==> Cleaning up..."
    [ -n "$SHELL_PID" ] && kill "$SHELL_PID" 2>/dev/null || true
    [ -n "$DAEMON_PID" ] && kill "$DAEMON_PID" 2>/dev/null || true
    [ -n "$DBUS_PID" ] && kill "$DBUS_PID" 2>/dev/null || true
    sleep 0.3
    [ -n "$SHELL_PID" ] && kill -9 "$SHELL_PID" 2>/dev/null || true
    [ -n "$DAEMON_PID" ] && kill -9 "$DAEMON_PID" 2>/dev/null || true
    [ -n "$DBUS_PID" ] && kill -9 "$DBUS_PID" 2>/dev/null || true
    rm -rf "$TD"
}
trap cleanup EXIT INT TERM

echo "==> Starting dbus-daemon..."
DBUS_ADDR=$(dbus-daemon --session --print-address --fork --address="unix:path=$TD/bus")
DBUS_PID=$(pgrep -n -f "dbus-daemon.*$TD/bus" || true)
export DBUS_SESSION_BUS_ADDRESS="$DBUS_ADDR"
export E2E_DBUS_ADDRESS="$DBUS_ADDR"
export E2E_XDG_RUNTIME_DIR="$TD"

echo "==> Starting daemon..."
XDG_RUNTIME_DIR="$TD" RUST_LOG=info "$DAEMON_BIN" &
DAEMON_PID=$!
for i in $(seq 1 50); do
    [ -S "$TD/agents-monitor/daemon.sock" ] && break
    sleep 0.1
done
if [ ! -S "$TD/agents-monitor/daemon.sock" ]; then
    echo "ERROR: Daemon socket not created"
    exit 1
fi
export E2E_DAEMON_SOCKET="$TD/agents-monitor/daemon.sock"
echo "    socket: $E2E_DAEMON_SOCKET"

echo "==> Starting gnome-shell ($MODE)..."
SHELL_ARGS=(--wayland --no-x11)
SHELL_ENV=(
    "XDG_RUNTIME_DIR=$TD"
    "DBUS_SESSION_BUS_ADDRESS=$DBUS_SESSION_BUS_ADDRESS"
)
if [ "$MODE" = "headless" ]; then
    SHELL_ARGS+=(--headless --virtual-monitor 1280x720 --unsafe-mode)
else
    HOST_XDG="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
    HOST_WL="${WAYLAND_DISPLAY:-wayland-0}"
    if [[ "$HOST_WL" == /* ]]; then
        SHELL_ENV+=("WAYLAND_DISPLAY=$HOST_WL")
    else
        SHELL_ENV+=("WAYLAND_DISPLAY=$HOST_XDG/$HOST_WL")
    fi
    SHELL_ARGS+=(--devkit)
fi

env "${SHELL_ENV[@]}" gnome-shell "${SHELL_ARGS[@]}" &>/dev/null &
SHELL_PID=$!

echo "==> Waiting for wayland socket..."
WL=""
for i in $(seq 1 100); do
    for f in "$TD"/wayland-*; do
        [ -e "$f" ] && [[ "$f" != *.lock ]] && { WL="$f"; break 2; }
    done
    sleep 0.1
done
if [ -z "$WL" ]; then
    echo "ERROR: No wayland socket found in $TD"
    exit 1
fi
export E2E_WAYLAND_DISPLAY="$(basename "$WL")"
echo "    wayland: $E2E_WAYLAND_DISPLAY"

echo "==> Waiting for gnome-shell readiness..."
READY=0
for i in $(seq 1 60); do
    if DBUS_SESSION_BUS_ADDRESS="$E2E_DBUS_ADDRESS" \
       gdbus call --session -d org.gnome.Shell -o /org/gnome/Shell \
       -m org.gnome.Shell.Eval "1+1" &>/dev/null; then
        READY=1
        break
    fi
    sleep 0.5
done
if [ "$READY" -ne 1 ]; then
    echo "ERROR: gnome-shell not responding to Shell.Eval"
    exit 1
fi

echo "==> Waiting for extension connection to daemon..."
EXT_CONNECTED=0
EVAL_JS='(async()=>{var M=await import("resource:///org/gnome/shell/ui/main.js");var e=M.extensionManager.lookup("argus-agenticus@darkwing4.dev");return e?.stateObj?._view?._daemon?._connection!==null})()'
for i in $(seq 1 40); do
    RESULT=$(DBUS_SESSION_BUS_ADDRESS="$E2E_DBUS_ADDRESS" \
        gdbus call --session -d org.gnome.Shell -o /org/gnome/Shell \
        -m org.gnome.Shell.Eval "$EVAL_JS" 2>/dev/null) || true
    if echo "$RESULT" | grep -q "true"; then
        EXT_CONNECTED=1
        break
    fi
    sleep 0.5
done
if [ "$EXT_CONNECTED" -ne 1 ]; then
    echo "WARNING: Extension may not be connected to daemon (continuing anyway)"
fi

echo ""
echo "==> Infrastructure ready!"
echo "    DBUS:     $E2E_DBUS_ADDRESS"
echo "    RUNTIME:  $E2E_XDG_RUNTIME_DIR"
echo "    WAYLAND:  $E2E_WAYLAND_DISPLAY"
echo "    SOCKET:   $E2E_DAEMON_SOCKET"
echo ""

if [ "$MODE" = "interactive" ]; then
    echo "Interactive mode. Run tests manually:"
    echo "  cd $REPO_ROOT"
    echo "  .venv/bin/pytest worktree/e2e-real-terminal-test/tests/e2e/ -v"
    echo "  .venv/bin/pytest worktree/e2e-real-terminal-test/tests/e2e/test_e2e_single.py -v -s"
    echo ""
    echo "Press Ctrl+C to stop."
    export PS1="(e2e) \w \$ "
    cd "$REPO_ROOT"
    exec bash --norc --noprofile -i
else
    VENV=""
    for candidate in "$REPO_ROOT/.venv/bin/pytest" "$REPO_ROOT/../../.venv/bin/pytest"; do
        [ -x "$candidate" ] && { VENV="$candidate"; break; }
    done
    if [ -z "$VENV" ]; then
        echo "ERROR: .venv not found. Create at project root: python3 -m venv .venv && .venv/bin/pip install pytest pytest-asyncio"
        exit 1
    fi
    cd "$REPO_ROOT"
    "$VENV" "$SCRIPT_DIR" -v "${PYTEST_ARGS[@]}"
fi
