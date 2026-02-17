import asyncio
import shutil

import pytest

from e2e_helpers import (
    FOOT_AVAILABLE,
    send_hook_event,
    wait_session_tracked,
)

pytestmark = pytest.mark.skipif(
    not FOOT_AVAILABLE, reason="foot terminal not installed"
)


async def test_single_agent_full_lifecycle(spy, terminals, view):
    session = "lifecycle#1"
    socket_path = spy.socket_path

    await send_hook_event(socket_path, session, "started")
    await spy.wait_render_with_session(session, timeout=5)
    await view.wait_dot_count(1, timeout=5)
    await view.wait_dot_class(session, "agent-dot-started", timeout=3)

    spy.clear()
    await send_hook_event(socket_path, session, "working", tool="shell")
    await spy.wait_render_with_session(session, timeout=5)
    await view.wait_dot_class(session, "agent-dot-working", timeout=3)

    spy.clear()
    await send_hook_event(socket_path, session, "awaiting")
    await spy.wait_render_with_session(session, timeout=5)
    await view.wait_dot_class(session, "agent-dot-awaiting", timeout=3)

    spy.clear()
    await send_hook_event(socket_path, session, "working", tool="browser")
    await spy.wait_render_with_session(session, timeout=5)
    await view.wait_dot_class(session, "agent-dot-working", timeout=3)

    spy.clear()
    await send_hook_event(socket_path, session, "completed")
    await spy.wait_render_with_session(session, timeout=5)

    spy.clear()
    await send_hook_event(socket_path, session, "ended")
    await spy.wait_render_with_session(session, timeout=5)
    await view.wait_dot_class(session, "agent-dot-ended", timeout=3)


async def test_window_tracked_by_tracker(spy, terminals, view):
    session = "tracked#1"
    await terminals.launch(session)

    await send_hook_event(spy.socket_path, session, "started")
    await spy.wait_render_with_session(session, timeout=5)

    await wait_session_tracked(view, session, timeout=8)


async def test_window_focus_sends_event(spy, terminals, view):
    session = "focusev#1"
    await terminals.launch(session)

    await send_hook_event(spy.socket_path, session, "started")
    await spy.wait_render_with_session(session, timeout=5)
    await wait_session_tracked(view, session, timeout=8)

    spy.clear()
    from ext_helper import _wrap
    await view.raw(_wrap(
        f"let wins = global.get_window_actors().map(a => a.meta_window); "
        f"let win = wins.find(w => w.get_title() && w.get_title().includes('focusev')); "
        f"if (win) win.activate(global.get_current_time()); "
        f"return '';"
    ))
    await asyncio.sleep(0.5)

    render = await spy.wait_render(timeout=5)
    agents = render.get("agents", [])
    matching = [a for a in agents if a["session"] == session]
    assert len(matching) == 1
    assert matching[0]["focused"] is True


async def test_state_from_hook_creates_dot(spy, terminals, view):
    session = "hookdot#1"

    await send_hook_event(spy.socket_path, session, "started")
    await spy.wait_render_with_session(session, timeout=5)
    await view.wait_dot_count(1, timeout=5)

    sessions = await view.dot_sessions()
    assert session in sessions
