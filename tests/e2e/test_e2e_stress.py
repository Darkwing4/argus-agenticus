import asyncio
import shutil

import pytest

from e2e_helpers import (
    FOOT_AVAILABLE,
    send_hook_event,
)

pytestmark = pytest.mark.skipif(
    not FOOT_AVAILABLE, reason="foot terminal not installed"
)


async def test_rapid_state_transitions(spy, terminals, view):
    session = "rapid#1"
    socket = spy.socket_path

    states = [
        "started", "working", "awaiting", "working", "awaiting",
        "working", "awaiting", "working", "completed", "started",
        "working", "awaiting", "working", "completed", "ended",
    ]

    for state in states:
        await send_hook_event(socket, session, state)
        await asyncio.sleep(0.05)

    await asyncio.sleep(1.0)

    render = spy.last_render()
    assert render is not None, "Should have received at least one render"
    agents = render.get("agents", [])
    matching = [a for a in agents if a["session"] == session]
    assert len(matching) == 1
    assert matching[0]["state"] == "ended"


async def test_ten_agents_three_workspaces(spy, terminals, view, ws):
    socket = spy.socket_path

    await ws.ensure_workspaces(3)

    sessions = [f"stress{i}#{i}" for i in range(10)]

    for s in sessions:
        await send_hook_event(socket, s, "started")
        await asyncio.sleep(0.1)

    await asyncio.sleep(1.0)

    render = spy.last_render()
    assert render is not None
    agents = render.get("agents", [])
    render_sessions = {a["session"] for a in agents}

    for s in sessions:
        assert s in render_sessions, f"Session {s} missing from render"

    await view.wait_dot_count(10, timeout=8)
