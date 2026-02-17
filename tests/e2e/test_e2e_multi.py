import asyncio
import shutil

import pytest

from e2e_helpers import FOOT_AVAILABLE, send_hook_event

pytestmark = pytest.mark.skipif(
    not FOOT_AVAILABLE, reason="foot terminal not installed"
)


async def test_two_groups_on_panel(spy, terminals, view):
    s1 = "alpha#1"
    s2 = "beta#1"
    socket = spy.socket_path

    await send_hook_event(socket, s1, "started")
    await spy.wait_render_with_session(s1, timeout=5)

    spy.clear()
    await send_hook_event(socket, s2, "started")
    await spy.wait_render_with_agents(2, timeout=5)

    await view.wait_dot_count(2, timeout=5)
    await view.wait_group_count(2, timeout=3)


async def test_agents_on_different_workspaces(spy, terminals, view, ws):
    s1 = "wstest#1"
    s2 = "wstest#2"
    socket = spy.socket_path

    await ws.ensure_workspaces(2)

    await terminals.launch(s1)
    await send_hook_event(socket, s1, "started")
    await spy.wait_render_with_session(s1, timeout=5)

    spy.clear()
    await terminals.launch(s2)
    await send_hook_event(socket, s2, "started")
    await spy.wait_render_with_agents(2, timeout=5)

    await ws.move_window_to_workspace("wstest#2", 1)
    await asyncio.sleep(0.5)

    spy.clear()
    await spy.send_session_workspace(s2, 1, 0)
    render = await spy.wait_render(timeout=5)
    agents = render.get("agents", [])
    sessions = {a["session"]: a for a in agents}

    assert s1 in sessions
    assert s2 in sessions


async def test_many_agents_same_group(spy, terminals, view):
    socket = spy.socket_path

    await send_hook_event(socket, "proj#1", "started")
    await spy.wait_render_with_session("proj#1", timeout=5)

    spy.clear()
    await send_hook_event(socket, "proj#2", "started")
    await spy.wait_render_with_agents(2, timeout=5)

    spy.clear()
    await send_hook_event(socket, "proj#3", "started")
    await spy.wait_render_with_agents(3, timeout=5)

    await view.wait_dot_count(3, timeout=5)
    await view.wait_group_count(1, timeout=3)
