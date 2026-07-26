# Argus Agenticus

Monitor and manage multiple AI coding agents from your desktop panel.

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
![Linux](https://img.shields.io/badge/Linux-Wayland%2FGNOME-informational)
![Rust](https://img.shields.io/badge/Daemon-Rust-orange)
![Claude Code](https://img.shields.io/badge/Claude_Code-supported-green)
![Cursor](https://img.shields.io/badge/Cursor_CLI-supported-green)
![Codex](https://img.shields.io/badge/Codex_CLI-supported-green)

https://github.com/user-attachments/assets/a2057241-5a37-4e31-9132-1449730b53d7

## The Problem

> *"With one agent, I used to wait for Claude. With two agents I still waited for Claude, but not as long. With three agents Claude is waiting for me. I am the bottleneck. And the bottleneck is all planning."*
> — [Robert C. Martin](https://x.com/unclebobmartin/status/2016544529826926618)

But planning isn't the only bottleneck. Human working memory holds [about 4 objects at once](https://en.wikipedia.org/wiki/Working_memory#Capacity) — and every extra terminal, workspace, or monitor competes for that capacity. 9 terminals, 6 workspaces, one agent waiting for permission approval for 8 hours — and you didn't even notice. This is the **"forgotten agent" problem**.

**Argus Agenticus solves it.**

## How It Works

Every running cli-agent gets a colored indicator in your desktop panel:

| Color | State | Meaning |
|-------|-------|---------|
| 🟢 Green | `started` | Idle, no active task |
| 🔴 Red | `awaiting` | Needs permission or approval — don't forget about it |
| 🟡 Yellow | `working` | Agent is busy, everything is fine |
| 🔵 Blue | `completed` | Task finished, terminal not yet focused — "Unread" |

## Features

- **Click an indicator** — focus the agent's window, even across workspaces
- **Easy navigation**
  - Hover over an indicator to see the agent's name, project, and tab number in multiplexer (if used)
  - **Super+F2** — cycle to the next agent, sorted by priority: 🔴 → 🔵 → 🟢 → 🟡
  - **Super+F1** — return to previous focused window after focusing any agent
- **Auto-focus on 🔴** — Argus automatically switches your screen (when idle) to each agent that needs attention, and returns you back when no 🔴 agents remain
- **Visual grouping** — agents are grouped by physical monitors and workspaces
- **Customizable** — dot size, gap, font size, panel position (left/center/right), labels via `dconf`

## Installation

### Quick install (Linux)

```bash
curl -fsSL https://raw.githubusercontent.com/darkwing4/argus-agenticus/main/install.sh | bash
```

### From source

```bash
git clone https://github.com/darkwing4/argus-agenticus.git
cd argus-agenticus
./install.sh
```

### Requirements

- `jq`
- `socat` or `netcat`
- `curl` (for downloading pre-built binary) or [Rust](https://rustup.rs/) toolchain (to build from source)
- GNOME 49+ with Wayland (for the desktop extension)

The installer downloads a pre-built binary from GitHub Releases (x86_64 / aarch64). If that fails, it falls back to building from source with `cargo`. It also configures agent hooks for Claude Code (and Cursor / Codex if installed), sets up the systemd service, and installs the GNOME extension.

## Supported Agents

| Agent | Indicator | Link |
|-------|-----------|------|
| Claude Code | Circle | [github.com/anthropics/claude-code](https://github.com/anthropics/claude-code) |
| Cursor Agent (CLI) | Square | [cursor.com](https://www.cursor.com/) |
| Codex CLI (0.133+) | Circle with purple border | [github.com/openai/codex](https://github.com/openai/codex) |

## Compatibility

### Operating Systems

| OS | Status |
|----|--------|
| Linux (Wayland, GNOME 49+) | Supported |
| macOS 14+ | Planned |
| Windows 11 (WSL + WinUI) | Planned |
