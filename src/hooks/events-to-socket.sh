#!/bin/bash
ARGUS_HOOK_LOG="${XDG_RUNTIME_DIR:-/tmp}/argus-agenticus/hook-stderr.log"
mkdir -p "$(dirname "$ARGUS_HOOK_LOG")" 2>/dev/null
exec >/dev/null 2>>"$ARGUS_HOOK_LOG"
trap 'exit 0' EXIT
command -v jq >/dev/null 2>&1 || exit 0
INPUT=$(timeout 1 cat 2>/dev/null || echo '{}')
read -r EVENT TOOL IS_INTERRUPT <<< $(echo "$INPUT" | jq -r '[.hook_event_name // "unknown", .tool_name // "", .is_interrupt // false] | @tsv')
CWD=$(echo "$INPUT" | jq -r '.cwd // ""')

LOG="${XDG_RUNTIME_DIR:-/tmp}/argus-agenticus/hook.log"

AGENT_TYPE="${ARGUS_AGENT_TYPE:-}"
if [ -z "$AGENT_TYPE" ]; then
    if echo "$INPUT" | jq -e '.cursor_version' > /dev/null 2>&1; then
        AGENT_TYPE="cursor"
    else
        AGENT_TYPE="claude"
    fi
fi

case "$AGENT_TYPE" in
  cursor)
    CONV_ID=$(echo "$INPUT" | jq -r '.conversation_id // "unknown"')
    WORKSPACE=$(echo "$INPUT" | jq -r '.workspace_roots[0] // empty')
    if [ -n "$ZELLIJ_SESSION_NAME" ]; then
        SESSION="${ZELLIJ_SESSION_NAME}#c-${CONV_ID:0:8}"
    elif [ -n "$WORKSPACE" ]; then
        NAME=$(basename "$WORKSPACE")
        SESSION="${NAME}#c-${CONV_ID:0:8}"
    else
        SESSION="cursor#${CONV_ID:0:8}"
    fi
    ;;
  codex)
    SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // "unknown"')
    if [ -n "$ZELLIJ_SESSION_NAME" ]; then
        SESSION="${ZELLIJ_SESSION_NAME}#${ZELLIJ_PANE_ID:-0}-cdx"
    else
        NAME=$(basename "$(git rev-parse --show-toplevel 2>/dev/null || echo "${CWD:-$PWD}")")
        SESSION="${NAME}#cdx-${SESSION_ID:0:8}"
    fi
    ;;
  *)
    if [ -n "$ZELLIJ_SESSION_NAME" ]; then
        SESSION="${ZELLIJ_SESSION_NAME}#${ZELLIJ_PANE_ID:-0}"
    else
        SID=$(ps -o sid= -p $$ 2>/dev/null | tr -d ' ')
        if [ -n "$SID" ] && [ "$SID" != "0" ]; then
            NAME=$(basename "$(git rev-parse --show-toplevel 2>/dev/null || echo "$PWD")")
            SESSION="${NAME}#s${SID}"
        else
            SESSION="standalone#0"
        fi
    fi
    ;;
esac

if [ -z "$CWD" ] && [ -n "$WORKSPACE" ]; then
    CWD="$WORKSPACE"
fi
UNCOMMITTED=0
if [ -n "$CWD" ]; then
    UNCOMMITTED=$(timeout 1 git -C "$CWD" status --short 2>/dev/null | wc -l | tr -d ' ' 2>/dev/null || echo 0)
    [[ "$UNCOMMITTED" =~ ^[0-9]+$ ]] || UNCOMMITTED=0
fi

case "$EVENT" in
  SessionStart|sessionStart)                          STATE="started" ;;
  PreToolUse|preToolUse)                              STATE="working" ;;
  PostToolUseFailure|postToolUseFailure)
    if [ "$IS_INTERRUPT" = "true" ]; then
      STATE="completed"
    else
      STATE="working"
    fi
    ;;
  PermissionRequest)                                  STATE="awaiting" ;;
  beforeShellExecution|beforeMCPExecution)             STATE="awaiting" ;;
  PostToolUse|afterShellExecution|afterMCPExecution|postToolUse) STATE="working" ;;
  UserPromptSubmit|beforeSubmitPrompt)                STATE="processing" ;;
  Stop|stop)                                          STATE="completed" ;;
  SessionEnd|sessionEnd)                              STATE="ended" ;;
  *)
    [ "${ARGUS_DEBUG:-}" = "1" ] && echo "$(date '+%H:%M:%S') SKIP agent=$AGENT_TYPE event=$EVENT" >> "$LOG" 2>/dev/null
    exit 0
    ;;
esac

if [ -z "$ZELLIJ_SESSION_NAME" ]; then
    { printf '\033]0;Argus (%s)\a' "$SESSION" > /dev/tty; } 2>/dev/null || true
fi

SOCK="${XDG_RUNTIME_DIR:-/tmp}/agents-monitor/daemon.sock"
MUX=""
[ -n "$ZELLIJ_SESSION_NAME" ] && MUX=",\"multiplexer\":\"zellij\""
MSG="{\"type\":\"state\",\"session\":\"$SESSION\",\"state\":\"$STATE\",\"tool\":\"$TOOL\",\"agent_type\":\"$AGENT_TYPE\",\"uncommitted_count\":$UNCOMMITTED${MUX}}"

[ "${ARGUS_DEBUG:-}" = "1" ] && mkdir -p "$(dirname "$LOG")" && echo "$(date '+%H:%M:%S') $AGENT_TYPE $SESSION $STATE event=$EVENT tool=$TOOL" >> "$LOG" 2>/dev/null

if command -v socat >/dev/null 2>&1; then
  echo "$MSG" | timeout 2 socat - "UNIX-CONNECT:$SOCK" 2>/dev/null || true
elif command -v nc >/dev/null 2>&1; then
  echo "$MSG" | timeout 2 nc -U "$SOCK" 2>/dev/null || true
fi
