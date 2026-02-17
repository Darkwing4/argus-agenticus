import asyncio

import pytest

from e2e_helpers import (
    FOOT_AVAILABLE,
    send_hook_event,
    wait_session_tracked,
    get_focused_window_title,
)
from ext_helper import _wrap

pytestmark = pytest.mark.skipif(
    not FOOT_AVAILABLE, reason="foot terminal not installed"
)


async def test_cursor_three_workspaces_sorting(spy, terminals, view, ws):
    socket = spy.socket_path

    await ws.ensure_workspaces(3)
    await ws.switch_to_workspace(0)

    s1 = "cw-alpha#c-1"
    s2 = "cw-beta#c-1"
    s3 = "cw-gamma#c-1"

    await terminals.launch("cw-alpha", agent_type="cursor")
    await terminals.launch("cw-beta", agent_type="cursor")
    await terminals.launch("cw-gamma", agent_type="cursor")

    await send_hook_event(socket, s1, "started", agent_type="cursor")
    await spy.wait_render_with_session(s1, timeout=5)

    spy.clear()
    await send_hook_event(socket, s2, "started", agent_type="cursor")
    await spy.wait_render_with_agents(2, timeout=5)

    spy.clear()
    await send_hook_event(socket, s3, "started", agent_type="cursor")
    await spy.wait_render_with_agents(3, timeout=5)

    await view.wait_dot_count(3, timeout=5)

    for s in [s1, s2, s3]:
        classes = await view.dot_style_classes(s)
        assert "agent-dot-cursor" in classes, f"{s} missing agent-dot-cursor class"

    await view.wait_group_count(3, timeout=3)

    await ws.move_window_to_workspace("cw-beta", 1)
    await ws.move_window_to_workspace("cw-gamma", 2)

    spy.clear()
    await spy.send_session_workspace(s1, 0, 0)
    await spy.send_session_workspace(s2, 1, 0)
    await spy.send_session_workspace(s3, 2, 0)
    await spy.wait_render(timeout=5)

    await view.wait_dot_visual_order([s1, s2, s3], timeout=5)


async def test_cursor_click_sends_focus_reply(spy, terminals, view, ws):
    socket = spy.socket_path

    await ws.ensure_workspaces(3)
    await ws.switch_to_workspace(0)

    s1 = "cc-alpha#c-1"
    s2 = "cc-beta#c-1"
    s3 = "cc-gamma#c-1"

    await terminals.launch("cc-alpha", agent_type="cursor")
    await terminals.launch("cc-beta", agent_type="cursor")
    await terminals.launch("cc-gamma", agent_type="cursor")

    await send_hook_event(socket, s1, "started", agent_type="cursor")
    await spy.wait_render_with_session(s1, timeout=5)

    spy.clear()
    await send_hook_event(socket, s2, "started", agent_type="cursor")
    await spy.wait_render_with_agents(2, timeout=5)

    spy.clear()
    await send_hook_event(socket, s3, "started", agent_type="cursor")
    await spy.wait_render_with_agents(3, timeout=5)

    await ws.move_window_to_workspace("cc-beta", 1)
    await ws.move_window_to_workspace("cc-gamma", 2)

    spy.clear()
    await spy.send_click(s3)
    focus_msg = await spy.wait_message("focus", timeout=5)
    assert focus_msg["session"] == s3

    spy.clear()
    await spy.send_click(s1)
    focus_msg = await spy.wait_message("focus", timeout=5)
    assert focus_msg["session"] == s1

    spy.clear()
    await spy.send_click(s2)
    focus_msg = await spy.wait_message("focus", timeout=5)
    assert focus_msg["session"] == s2


async def test_cursor_focus_activates_window(spy, terminals, view, ws):
    socket = spy.socket_path

    await ws.ensure_workspaces(2)
    await ws.switch_to_workspace(0)

    s1 = "cf-alpha#c-1"
    s2 = "cf-beta#c-1"

    await terminals.launch("cf-alpha", agent_type="cursor")
    await terminals.launch("cf-beta", agent_type="cursor")

    await send_hook_event(socket, s1, "started", agent_type="cursor")
    await spy.wait_render_with_session(s1, timeout=5)

    spy.clear()
    await send_hook_event(socket, s2, "started", agent_type="cursor")
    await spy.wait_render_with_agents(2, timeout=5)

    await wait_session_tracked(view, "cf-alpha", timeout=8)
    await wait_session_tracked(view, "cf-beta", timeout=8)

    await ws.move_window_to_workspace("cf-beta", 1)

    await view.click_dot(s2)
    await asyncio.sleep(0.5)

    title = await get_focused_window_title(view)
    assert title is not None and "cf-beta" in title


async def test_cursor_reverse_workspace_order(spy, terminals, view, ws):
    socket = spy.socket_path

    await ws.ensure_workspaces(3)
    await ws.switch_to_workspace(0)

    s1 = "cr-a#c-1"
    s2 = "cr-b#c-1"
    s3 = "cr-c#c-1"

    await terminals.launch("cr-a", agent_type="cursor")
    await terminals.launch("cr-b", agent_type="cursor")
    await terminals.launch("cr-c", agent_type="cursor")

    await send_hook_event(socket, s1, "started", agent_type="cursor")
    await spy.wait_render_with_session(s1, timeout=5)

    spy.clear()
    await send_hook_event(socket, s2, "started", agent_type="cursor")
    await spy.wait_render_with_agents(2, timeout=5)

    spy.clear()
    await send_hook_event(socket, s3, "started", agent_type="cursor")
    await spy.wait_render_with_agents(3, timeout=5)

    await ws.move_window_to_workspace("cr-a", 2)
    await ws.move_window_to_workspace("cr-c", 0)

    spy.clear()
    await spy.send_session_workspace(s1, 2, 0)
    await spy.send_session_workspace(s2, 1, 0)
    await spy.send_session_workspace(s3, 0, 0)
    await spy.wait_render(timeout=5)

    await view.wait_dot_visual_order([s3, s2, s1], timeout=5)
