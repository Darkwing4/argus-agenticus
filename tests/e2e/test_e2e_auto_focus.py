import asyncio
import shutil

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


async def test_auto_focus_activates_window(spy, terminals, view, gsettings):
    session = "autofoc#1"
    socket = spy.socket_path

    await terminals.launch(session)
    await send_hook_event(socket, session, "started")
    await spy.wait_render_with_session(session, timeout=5)
    await wait_session_tracked(view, session, timeout=8)

    await spy.send_auto_focus_config(True, 100)
    await asyncio.sleep(0.3)

    spy.clear()
    await send_hook_event(socket, session, "awaiting")
    await spy.wait_render_with_session(session, timeout=5)

    await spy.send_idle_status(True)
    await asyncio.sleep(1.0)

    auto_focus_msg = None
    for m in spy.renders:
        if m.get("type") == "auto_focus":
            auto_focus_msg = m
            break

    assert auto_focus_msg is not None, (
        f"No auto_focus message received. Got: {[m.get('type') for m in spy.renders]}"
    )
    assert auto_focus_msg["session"] == session


async def test_auto_focus_return_workspace(spy, terminals, view, ws, gsettings):
    session = "autoret#1"
    socket = spy.socket_path

    await ws.ensure_workspaces(2)
    await ws.switch_to_workspace(0)

    await terminals.launch(session)
    await send_hook_event(socket, session, "started")
    await spy.wait_render_with_session(session, timeout=5)
    await wait_session_tracked(view, session, timeout=8)

    await ws.move_window_to_workspace(session, 1)
    await asyncio.sleep(0.5)

    await spy.send_auto_focus_config(True, 100)
    await asyncio.sleep(0.3)

    spy.clear()
    await send_hook_event(socket, session, "awaiting")
    await spy.wait_render_with_session(session, timeout=5)

    await spy.send_idle_status(True)
    await asyncio.sleep(1.0)

    spy.clear()
    await send_hook_event(socket, session, "working")
    await asyncio.sleep(1.0)

    return_msg = None
    for m in spy.renders:
        if m.get("type") == "return_workspace":
            return_msg = m
            break

    assert return_msg is not None, (
        f"No return_workspace message received. Got: {[m.get('type') for m in spy.renders]}"
    )
