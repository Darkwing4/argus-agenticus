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


async def test_cursor_window_detected(spy, terminals, view):
    session = "curproj#c-1"
    await terminals.launch("curproj", agent_type="cursor")

    await send_hook_event(
        spy.socket_path, session, "started", agent_type="cursor"
    )
    await spy.wait_render_with_session(session, timeout=5)
    await view.wait_dot_count(1, timeout=5)
    await view.wait_dot_class(session, "agent-dot-cursor", timeout=3)


async def test_mixed_claude_and_cursor(spy, terminals, view):
    s_claude = "mixproj#1"
    s_cursor = "mixcur#c-1"
    socket = spy.socket_path

    await terminals.launch("mixproj")
    await send_hook_event(socket, s_claude, "started")
    await spy.wait_render_with_session(s_claude, timeout=5)

    spy.clear()
    await terminals.launch("mixcur", agent_type="cursor")
    await send_hook_event(socket, s_cursor, "started", agent_type="cursor")
    await spy.wait_render_with_agents(2, timeout=5)

    await view.wait_dot_count(2, timeout=5)

    classes_cursor = await view.dot_style_classes(s_cursor)
    assert "agent-dot-cursor" in classes_cursor

    classes_claude = await view.dot_style_classes(s_claude)
    assert "agent-dot-cursor" not in classes_claude


async def test_cursor_title_extraction(spy, terminals, view):
    session = "curext#c-1"
    await terminals.launch("curext", agent_type="cursor")

    await send_hook_event(
        spy.socket_path, session, "started", agent_type="cursor"
    )
    await spy.wait_render_with_session(session, timeout=5)

    render = spy.last_render()
    agents = render.get("agents", [])
    matching = [a for a in agents if a["session"] == session]
    assert len(matching) == 1
    assert matching[0]["agent_type"] == "cursor"
