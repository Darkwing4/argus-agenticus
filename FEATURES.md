# Argus Agenticus — Features

## Agent States

| Color | State | Trigger (hook event) | Description |
|-------|-------|---------------------|-------------|
| Green | `started` | `SessionStart` | Agent launched, idle |
| Red | `awaiting` | `PermissionRequest`, `beforeShellExecution`, `beforeMCPExecution` | Agent needs user permission |
| Yellow | `working` | `PreToolUse`, `PostToolUse`, `afterShellExecution`, `afterMCPExecution` | Agent is using a tool |
| Yellow | `processing` | `UserPromptSubmit`, `beforeSubmitPrompt` | Agent is processing user prompt |
| Blue | `completed` | `Stop` | Task finished, terminal not yet focused |
| Gray | `ended` | `SessionEnd` | Session ended, dot hidden after 30s |

Special case: `PostToolUseFailure` with `is_interrupt=true` → `completed`.

## Multi-Agent Support

| Type | WM Classes | Dot Shape | Session Format |
|------|-----------|-----------|----------------|
| `claude` | Ptyxis, org.gnome.Ptyxis | Circle | `zellij_session#pane_id` or `name#sSID` |
| `cursor` | Cursor | Square | `zellij_session#c-conv_id` or `name#c-conv_id` |

Adding a new agent type (Windsurf, Codex, etc.) requires:

1. **Hook**: detection in `events-to-socket.sh`, send `agent_type`
2. **Extension**: add entry to `AGENT_TYPES` (wmClasses, dotClass)
3. **CSS**: dot style (`.agent-dot-<type>`)
4. **Daemon**: no changes needed

## Panel Indicators

- Each agent is a colored dot in the left side of the GNOME Shell panel
- Dots grouped by session, groups separated by 6px gap
- Sorted by workspace index, then by session name
- 1.2x scale on hover with session name tooltip
- Focused group gets a highlight underline
- `completed` → `started` transition when agent window is focused

## Click to Focus

- Click on a dot — switch to workspace and focus the agent window
- Works across workspaces and monitors
- Claude: matched by terminal title (Zellij session name)
- Cursor: matched by WM class

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Super+F2` | Cycle to next agent by priority: awaiting → completed → started |

## Auto-Focus Awaiting

Automatically focuses agent windows waiting for permission when the user is idle.

- **A** button next to dots — toggle on/off (red = enabled, gray = disabled)
- Tooltip "Auto-focus awaiting" on hover
- Only triggers when user keyboard/mouse is idle (configurable threshold)
- Configurable delay before focus switch
- Remembers original workspace, returns to it when all awaiting agents are handled
- Cancels return if user manually switches to a non-agent window
- Respects primary monitor boundary

### Settings (GSettings)

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `auto-focus-enabled` | bool | `false` | Enable/disable auto-focus |
| `focus-delay-ms` | int | `1000` | Delay before auto-focus (0–10000 ms) |
| `input-idle-threshold-ms` | int | `1000` | User idle threshold (100–10000 ms) |

## Workspace-Aware Sorting

- Extension tracks which workspace and monitor each agent session occupies
- Sends `session_workspace` to daemon on window move/focus
- Daemon sorts agents: workspace 0 before workspace 1
- Grouping by session preserved within sort order

## Session Identification

- Zellij: `SESSION#pane_id` (Claude) or `SESSION#c-conv_id` (Cursor)
- Standalone with git: `repo_name#sSID` (Claude) or `repo_name#c-conv_id` (Cursor)
- Fallback: `standalone#0` (Claude) or `cursor#conv_id` (Cursor)
- Terminal title set to `Argus (session_id)` for non-Zellij standalone agents

## Hook System

Single hook script `events-to-socket.sh` handles all lifecycle events for both Claude Code and Cursor CLI.

Supported events: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`, `Stop`, `SessionEnd`, `beforeShellExecution`, `afterShellExecution`, `beforeMCPExecution`, `afterMCPExecution`, `beforeSubmitPrompt`.

Agent type auto-detected by presence of `cursor_version` in hook payload.

Message delivery: JSON via Unix socket using `socat` (preferred) or `nc` fallback.

## Auto-Cleanup

- Ended sessions hidden after 30 seconds (daemon cleanup every 5s)
- No stale sessions on window close

## Daemon Connection

- Unix socket at `$XDG_RUNTIME_DIR/agents-monitor/daemon.sock`
- Auto-reconnect on disconnect (every 3s)
- Sends current focus, workspaces, and auto-focus config on connect
- JSON-line protocol (newline-delimited JSON)

## Architecture

```
Agent hooks → events-to-socket.sh → Unix socket → daemon (Rust) → Unix socket → GNOME Extension
```

| Component | Responsibility |
|-----------|---------------|
| Hook script | Agent type detection, event-to-state mapping, session ID generation |
| Daemon (Rust) | State machine, queue, sorting, auto-focus timer, cleanup |
| Extension (JS) | Rendering, idle detection, window focus, workspace tracking |

Extension is a pure view — all business logic lives in the daemon. Agent type is a passthrough string with no type-specific logic in the daemon.
