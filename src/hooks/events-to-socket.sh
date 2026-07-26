#!/bin/bash
ARGUS_HOOK_LOG="${XDG_RUNTIME_DIR:-/tmp}/argus-agenticus/hook-stderr.log"
mkdir -p "$(dirname "$ARGUS_HOOK_LOG")" 2>/dev/null
exec >/dev/null 2>>"$ARGUS_HOOK_LOG"
trap 'exit 0' EXIT
command -v jq >/dev/null 2>&1 || exit 0
INPUT=$(timeout 1 cat 2>/dev/null || echo '{}')
mapfile -d '' -t INPUT_FIELDS < <(
  printf '%s' "$INPUT" |
    jq -jr '(.hook_event_name // "unknown"), "\u0000", (.tool_name // ""), "\u0000", ((.is_interrupt // false) | tostring), "\u0000", (.cwd // ""), "\u0000"'
)
EVENT="${INPUT_FIELDS[0]:-unknown}"
TOOL="${INPUT_FIELDS[1]:-}"
IS_INTERRUPT="${INPUT_FIELDS[2]:-false}"
CWD="${INPUT_FIELDS[3]:-}"

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

UNCOMMITTED=0
if [ "$STATE" != "ended" ] && [ -n "$CWD" ]; then
    UNCOMMITTED=$(timeout 1 git -C "$CWD" status --short 2>/dev/null | wc -l | tr -d ' ' 2>/dev/null || echo 0)
    [[ "$UNCOMMITTED" =~ ^[0-9]+$ ]] || UNCOMMITTED=0
fi

if [ -z "$ZELLIJ_SESSION_NAME" ]; then
    { printf '\033]0;Argus (%s)\a' "$SESSION" > /dev/tty; } 2>/dev/null || true
fi

SOCK="${XDG_RUNTIME_DIR:-/tmp}/agents-monitor/daemon.sock"
MULTIPLEXER=""
[ -n "$ZELLIJ_SESSION_NAME" ] && MULTIPLEXER="zellij"
MSG=$(jq -cn \
  --arg session "$SESSION" \
  --arg state "$STATE" \
  --arg tool "$TOOL" \
  --arg agent_type "$AGENT_TYPE" \
  --argjson uncommitted_count "$UNCOMMITTED" \
  --arg multiplexer "$MULTIPLEXER" \
  '{type: "state", session: $session, state: $state, tool: $tool, agent_type: $agent_type, uncommitted_count: $uncommitted_count}
   + if $multiplexer == "" then {} else {multiplexer: $multiplexer} end')

[ "${ARGUS_DEBUG:-}" = "1" ] && mkdir -p "$(dirname "$LOG")" && echo "$(date '+%H:%M:%S') $AGENT_TYPE $SESSION $STATE event=$EVENT tool=$TOOL" >> "$LOG" 2>/dev/null

if command -v socat >/dev/null 2>&1; then
  printf '%s\n' "$MSG" | timeout 2 socat - "UNIX-CONNECT:$SOCK" 2>/dev/null || true
elif command -v nc >/dev/null 2>&1; then
  printf '%s\n' "$MSG" | timeout 2 nc -U "$SOCK" 2>/dev/null || true
fi
