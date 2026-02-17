import asyncio
import shutil

import pytest

from e2e_helpers import (
    FOOT_AVAILABLE,
    send_hook_event,
    wait_session_tracked,
    get_focused_window_title,
)

pytestmark = pytest.mark.skipif(
    not FOOT_AVAILABLE, reason="foot terminal not installed"
)


async def test_click_dot_focuses_window(spy, terminals, view):
    session = "clickfoc#1"
    await terminals.launch(session)

    await send_hook_event(spy.socket_path, session, "started")
    await spy.wait_render_with_session(session, timeout=5)
    await wait_session_tracked(view, session, timeout=8)
    await view.wait_dot_count(1, timeout=5)

    spy.clear()
    await spy.send_click(session)

    focus_msg = await spy.wait_message("focus", timeout=5)
    assert focus_msg["session"] == session


async def test_focus_next_cycles(spy, terminals, view):
    s1 = "fnext#1"
    s2 = "fnext#2"
    s3 = "fnext#3"
    socket = spy.socket_path

    await terminals.launch(s1)
    await terminals.launch(s2)
    await terminals.launch(s3)

    await send_hook_event(socket, s1, "awaiting")
    await spy.wait_render_with_session(s1, timeout=5)

    spy.clear()
    await send_hook_event(socket, s2, "started")
    await spy.wait_render_with_agents(2, timeout=5)

    spy.clear()
    await send_hook_event(socket, s3, "started")
    await spy.wait_render_with_agents(3, timeout=5)

    await view.wait_dot_count(3, timeout=5)

    spy.clear()
    await spy.send_focus_next()

    focus_msg = await spy.wait_message("focus", timeout=5)
    assert focus_msg["session"] == s1


async def test_focus_switches_workspace(spy, terminals, view, ws):
    session = "wsfocus#1"
    socket = spy.socket_path

    await ws.ensure_workspaces(2)
    await ws.switch_to_workspace(0)

    await terminals.launch(session)
    await send_hook_event(socket, session, "started")
    await spy.wait_render_with_session(session, timeout=5)
    await wait_session_tracked(view, session, timeout=8)

    await ws.move_window_to_workspace(session, 1)
    await asyncio.sleep(0.5)

    spy.clear()
    await spy.send_click(session)
    focus_msg = await spy.wait_message("focus", timeout=5)
    assert focus_msg["session"] == session
