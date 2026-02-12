import asyncio

import pytest

from conftest import agent
from ext_helper import PREAMBLE


async def test_unmanaged_callback_is_wired(ext, view):
    js = (
        f"(async () => {{ {PREAMBLE}"
        "return typeof _view._windowTracker.onWindowUnmanaged;"
        "})()"
    )
    result = await view.raw(js)
    assert result == "function", (
        f"onWindowUnmanaged should be wired as a function, got {result!r}"
    )


async def test_unmanaged_window_notifies_daemon(ext, view):
    await ext.render([agent("proj#1", state="working")])
    await view.wait_dot_count(1)

    ext.messages.clear()

    js = (
        f"(async () => {{ {PREAMBLE}"
        "var _wt = _view._windowTracker; "
        "var _fakeWin = {}; "
        "var _session = 'proj#1'; "
        "_wt._windowToSession.set(_fakeWin, _session); "
        "_wt._sessionToWindow.set(_session, _fakeWin); "
        "_wt._sessionToWindow.delete(_session); "
        "_wt._windowToSession.delete(_fakeWin); "
        "_wt.onWindowUnmanaged?.(_session); "
        "return 'done';"
        "})()"
    )
    await view.raw(js)

    await asyncio.sleep(0.5)

    unmanaged_msgs = [m for m in ext.messages if m.get("session") == "proj#1"]
    assert len(unmanaged_msgs) > 0, (
        f"daemon should receive a message after window unmanaged, "
        f"got messages: {ext.messages}"
    )
