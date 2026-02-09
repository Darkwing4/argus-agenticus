#!/bin/bash
INPUT=$(timeout 1 cat 2>/dev/null || echo '{}')
read -r EVENT TOOL IS_INTERRUPT <<< $(echo "$INPUT" | jq -r '[.hook_event_name // "unknown", .tool_name // "", .is_interrupt // false] | @tsv')

LOG="$HOME/Desktop/agents-monitor-v2.log"

if echo "$INPUT" | jq -e '.cursor_version' > /dev/null 2>&1; then
    AGENT_TYPE="cursor"
    CONV_ID=$(echo "$INPUT" | jq -r '.conversation_id // "unknown"')
    if [ -n "$ZELLIJ_SESSION_NAME" ]; then
        SESSION="${ZELLIJ_SESSION_NAME}#c-${CONV_ID:0:8}"
    else
        SID=$(ps -o sid= -p $$ 2>/dev/null | tr -d ' ')
        if [ -n "$SID" ] && [ "$SID" != "0" ]; then
            NAME=$(basename "$(git rev-parse --show-toplevel 2>/dev/null || echo "$PWD")")
            SESSION="${NAME}#c-${CONV_ID:0:8}"
        else
            SESSION="cursor#${CONV_ID:0:8}"
        fi
    fi
else
    AGENT_TYPE="claude"
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
    echo "$(date '+%H:%M:%S') SKIP agent=$AGENT_TYPE event=$EVENT" >> "$LOG" 2>/dev/null
    exit 0
    ;;
esac

if [ -z "$ZELLIJ_SESSION_NAME" ] && [ "$STATE" = "started" ]; then
    printf '\033]0;Argus (%s)\a' "$SESSION" > /dev/tty 2>/dev/null || true
fi

SOCK="${XDG_RUNTIME_DIR:-/tmp}/agents-monitor/daemon.sock"
MSG="{\"type\":\"state\",\"session\":\"$SESSION\",\"state\":\"$STATE\",\"tool\":\"$TOOL\",\"agent_type\":\"$AGENT_TYPE\"}"

echo "$(date '+%H:%M:%S') $AGENT_TYPE $SESSION $STATE event=$EVENT tool=$TOOL" >> "$LOG" 2>/dev/null

if command -v socat >/dev/null 2>&1; then
  echo "$MSG" | timeout 2 socat - "UNIX-CONNECT:$SOCK" 2>/dev/null || true
elif command -v nc >/dev/null 2>&1; then
  echo "$MSG" | timeout 2 nc -U "$SOCK" 2>/dev/null || true
fi
