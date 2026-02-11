import asyncio


AGENT_CLAUDE = {
    "session": "proj#1",
    "state": "started",
    "focused": False,
    "group": "proj",
    "agent_type": "claude",
}


def make_agent(session="proj#1", state="started", group="proj",
               agent_type="claude", focused=False):
    return {
        "session": session,
        "state": state,
        "focused": focused,
        "group": group,
        "agent_type": agent_type,
    }


async def test_single_agent_dot(ext, ext_view):
    await ext.send({"type": "render", "agents": [AGENT_CLAUDE]})
    await asyncio.sleep(0.3)
    assert await ext_view.dot_count() == 1


async def test_multiple_agents_dots(ext, ext_view):
    agents = [
        make_agent("proj#1", group="proj"),
        make_agent("proj#2", group="proj"),
        make_agent("other#1", group="other"),
    ]
    await ext.send({"type": "render", "agents": agents})
    await asyncio.sleep(0.3)
    assert await ext_view.dot_count() == 3


async def test_empty_render_hides(ext, ext_view):
    await ext.send({"type": "render", "agents": [AGENT_CLAUDE]})
    await asyncio.sleep(0.2)
    await ext.send({"type": "render", "agents": []})
    await asyncio.sleep(0.2)
    assert await ext_view.is_visible() is False


async def test_agents_render_shows(ext, ext_view):
    await ext.send({"type": "render", "agents": [AGENT_CLAUDE]})
    await asyncio.sleep(0.3)
    assert await ext_view.is_visible() is True


async def test_dot_state_class_started(ext, ext_view):
    await ext.send({"type": "render", "agents": [make_agent(state="started")]})
    await asyncio.sleep(0.3)
    classes = await ext_view.dot_style_classes("proj#1")
    assert "agent-dot-started" in classes


async def test_dot_state_class_awaiting(ext, ext_view):
    await ext.send({"type": "render", "agents": [make_agent(state="awaiting")]})
    await asyncio.sleep(0.3)
    classes = await ext_view.dot_style_classes("proj#1")
    assert "agent-dot-awaiting" in classes


async def test_dot_state_class_working(ext, ext_view):
    await ext.send({"type": "render", "agents": [make_agent(state="working")]})
    await asyncio.sleep(0.3)
    classes = await ext_view.dot_style_classes("proj#1")
    assert "agent-dot-working" in classes


async def test_dot_state_class_completed(ext, ext_view):
    await ext.send({"type": "render", "agents": [make_agent(state="completed")]})
    await asyncio.sleep(0.3)
    classes = await ext_view.dot_style_classes("proj#1")
    assert "agent-dot-completed" in classes


async def test_dot_state_transition(ext, ext_view):
    await ext.send({"type": "render", "agents": [make_agent(state="started")]})
    await asyncio.sleep(0.3)
    classes = await ext_view.dot_style_classes("proj#1")
    assert "agent-dot-started" in classes

    await ext.send({"type": "render", "agents": [make_agent(state="awaiting")]})
    await asyncio.sleep(0.3)
    classes = await ext_view.dot_style_classes("proj#1")
    assert "agent-dot-awaiting" in classes
    assert "agent-dot-started" not in classes


async def test_dot_type_class_cursor(ext, ext_view):
    agent = make_agent(session="cur#1", agent_type="cursor", group="cur")
    await ext.send({"type": "render", "agents": [agent]})
    await asyncio.sleep(0.3)
    classes = await ext_view.dot_style_classes("cur#1")
    assert "agent-dot-cursor" in classes


async def test_group_separation(ext, ext_view):
    agents = [
        make_agent("a#1", group="a"),
        make_agent("b#1", group="b"),
    ]
    await ext.send({"type": "render", "agents": agents})
    await asyncio.sleep(0.3)
    assert await ext_view.group_count() == 2


async def test_agent_removal(ext, ext_view):
    agents = [
        make_agent("proj#1", group="proj"),
        make_agent("proj#2", group="proj"),
    ]
    await ext.send({"type": "render", "agents": agents})
    await asyncio.sleep(0.3)
    assert await ext_view.dot_count() == 2

    await ext.send({"type": "render", "agents": [agents[0]]})
    await asyncio.sleep(0.3)
    assert await ext_view.dot_count() == 1
    sessions = await ext_view.dot_sessions()
    assert "proj#1" in sessions
    assert "proj#2" not in sessions
