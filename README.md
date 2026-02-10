# Argus Agenticus

Monitor and manage multiple AI coding agents from your desktop panel.

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
![Linux](https://img.shields.io/badge/Linux-Wayland%2FGNOME-informational)
![Rust](https://img.shields.io/badge/Daemon-Rust-orange)
![Claude Code](https://img.shields.io/badge/Claude_Code-supported-green)
![Cursor](https://img.shields.io/badge/Cursor_CLI-supported-green)

https://github.com/user-attachments/assets/a2057241-5a37-4e31-9132-1449730b53d7

## The Problem

Running multiple AI agents across terminals, workspaces, and monitors hits a hard limit: **developer attention**.

> *"With one agent, I used to wait for Claude. With two agents I still waited for Claude, but not as long. With three agents Claude is waiting for me. I am the bottleneck. And the bottleneck is all planning."*
> — [Robert C. Martin](https://x.com/unclebobmartin/status/2016544529826926618)

Planning isn't the only bottleneck — there's also the **attention limit**. 9 terminals, 6 workspaces, one agent has been waiting for permission approval for 8 hours and you didn't even notice. This creates the **"forgotten agent" problem**.

**Argus Agenticus solves it.**

## How It Works

Every running cli-agent gets a colored indicator in your desktop panel:

| Color | State | Meaning |
|-------|-------|---------|
| 🟢 Green | `started` | Idle, no active task |
| 🔴 Red | `awaiting` | Needs permission or approval — don't forget about it |
| 🟡 Yellow | `working` | Agent is busy, everything is fine |
| 🔵 Blue | `completed` | Task finished, terminal not yet opened — "Unread" |

## Features

- **Click an indicator** — focus the agent's window, even across workspaces
- **Super+F2** — cycle to the next agent, sorted by priority: 🔴 → 🔵 → 🟢 → 🟡
- **Auto-focus on 🔴** — Argus automatically switches your screen (when idle) to each agent that needs attention, and returns you back when no 🔴 agents remain
- **Visual grouping** — agents are grouped by physical monitors and workspaces

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

The installer downloads a pre-built binary from GitHub Releases (x86_64 / aarch64). If that fails, it falls back to building from source with `cargo`. It also configures agent hooks for Claude Code (and Cursor if installed), sets up the systemd service, and installs the GNOME extension.

## Supported Agents

| Agent | Indicator | Link |
|-------|-----------|------|
| Claude Code | Circle | [github.com/anthropics/claude-code](https://github.com/anthropics/claude-code) |
| Cursor Agent (CLI) | Square | [cursor.com](https://www.cursor.com/) |

## Compatibility

### Operating Systems

| OS | Status |
|----|--------|
| Linux (Wayland, GNOME 49+) | Supported |
| macOS 14+ | Coming soon |
| Windows 11 (WSL + WinUI) | In progress |

### Terminal Multiplexers

| Multiplexer | Status |
|-------------|--------|
| [Zellij](https://zellij.dev/) | Supported |
| Tmux | Planned |

Other multiplexers will be supported in the future.

### Terminals

Any terminal emulator with a WM Class is supported (Ptyxis, Ghostty, Kitty, Alacritty, WezTerm, etc.).

## Why "Argus Agenticus"?

**Argus Panoptes** (Ancient Greek: Ἄργος Πανόπτης — "all-seeing") was a hundred-eyed giant from Greek mythology, appointed by Hera to watch over Io. Some of his eyes were always awake while the others slept — the perfect guardian who never misses a thing. **Agenticus** — because he watches not nymphs, but AI agents; the Latin suffix *-icus* means "related to / belonging to."

Thus was born **Argus Agenticus** — the watcher of agents.

## Architecture

Argus is built as a clean pipeline where each layer has a single job:

```
Agent hooks → shell script → Unix socket → Daemon (Rust) → Unix socket → Desktop Extension
```

**Agent hooks** fire on lifecycle events (session start, permission request, tool use, stop) and send a short message through a **shell script** to the **daemon** over a Unix socket. The daemon — written in Rust — owns all the business logic: it tracks agent states, groups and sorts them, manages the auto-focus queue, and pushes render-ready data to connected clients. The **desktop extension** (GNOME JS / macOS Swift) is a pure view: it receives pre-sorted data, draws the indicators, detects user idle, and handles window focus.

Agent type is just a string that flows through the entire chain — the daemon has zero type-specific logic, making it trivial to add new agents.
