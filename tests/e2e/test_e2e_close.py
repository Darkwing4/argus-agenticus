import asyncio
import shutil

import pytest

from e2e_helpers import (
    FOOT_AVAILABLE,
    send_hook_event,
    wait_session_tracked,
)
from ext_helper import _wrap

pytestmark = pytest.mark.skipif(
    not FOOT_AVAILABLE, reason="foot terminal not installed"
)


async def test_window_close_cleanup(spy, terminals, view):
    session = "closeme#1"
    proc = await terminals.launch(session)

    await send_hook_event(spy.socket_path, session, "started")
    await spy.wait_render_with_session(session, timeout=5)
    await wait_session_tracked(view, session, timeout=8)

    await view.raw(_wrap(
        f"let wins = global.get_window_actors().map(a => a.meta_window); "
        f"let win = wins.find(w => w.get_title() && w.get_title().includes('{session}')); "
        f"if (win) win.delete(global.get_current_time()); "
        f"return '';"
    ))
    await asyncio.sleep(1.0)

    tracked = True
    try:
        val = await view.raw(_wrap(
            f"return _view._windowTracker._sessionToWindow.has('{session}');"
        ))
        tracked = bool(val)
    except Exception:
        tracked = False

    assert not tracked, "Session should be removed from WindowTracker after window close"


async def test_close_one_of_many(spy, terminals, view):
    s1 = "multi#1"
    s2 = "multi#2"
    s3 = "multi#3"
    socket = spy.socket_path

    proc1 = await terminals.launch(s1)
    await send_hook_event(socket, s1, "started")
    await spy.wait_render_with_session(s1, timeout=5)

    spy.clear()
    proc2 = await terminals.launch(s2)
    await send_hook_event(socket, s2, "started")
    await spy.wait_render_with_agents(2, timeout=5)

    spy.clear()
    proc3 = await terminals.launch(s3)
    await send_hook_event(socket, s3, "started")
    await spy.wait_render_with_agents(3, timeout=5)

    await view.wait_dot_count(3, timeout=5)

    await view.raw(_wrap(
        f"let wins = global.get_window_actors().map(a => a.meta_window); "
        f"let win = wins.find(w => w.get_title() && w.get_title().includes('{s2}')); "
        f"if (win) win.delete(global.get_current_time()); "
        f"return '';"
    ))
    await asyncio.sleep(1.0)

    dot_count = await view.dot_count()
    assert dot_count >= 2, f"Expected at least 2 dots after closing one, got {dot_count}"
