import pytest

from conftest import agent


async def test_single_agent_dot(ext, view):
    await ext.render([agent()])
    await view.wait_dot_count(1)


async def test_multiple_agents_dots(ext, view):
    agents = [
        agent("proj#1", group="proj"),
        agent("proj#2", group="proj"),
        agent("other#1", group="other"),
    ]
    await ext.render(agents)
    await view.wait_dot_count(3)


async def test_agents_render_shows(ext, view):
    await ext.render([agent()])
    await view.wait_visible(True)


async def test_empty_render_hides(ext, view):
    await ext.render([agent()])
    await view.wait_visible(True)
    await ext.render([])
    await view.wait_visible(False)


@pytest.mark.parametrize("state", [
    "started", "awaiting", "working", "processing", "completed", "ended",
])
async def test_dot_state_class(ext, view, state):
    await ext.render([agent(state=state)])
    await view.wait_dot_class("proj#1", f"agent-dot-{state}")


async def test_dot_state_transition(ext, view):
    await ext.render([agent(state="started")])
    await view.wait_dot_class("proj#1", "agent-dot-started")

    await ext.render([agent(state="awaiting")])
    await view.wait_dot_class("proj#1", "agent-dot-awaiting")
    await view.wait_no_dot_class("proj#1", "agent-dot-started")


async def test_dot_type_class_cursor(ext, view):
    await ext.render([agent(session="cur#1", agent_type="cursor", group="cur")])
    await view.wait_dot_class("cur#1", "agent-dot-cursor")


async def test_group_separation(ext, view):
    agents = [
        agent("a#1", group="a"),
        agent("b#1", group="b"),
    ]
    await ext.render(agents)
    await view.wait_group_count(2)


async def test_agent_removal(ext, view):
    a1 = agent("proj#1", group="proj")
    a2 = agent("proj#2", group="proj")
    await ext.render([a1, a2])
    await view.wait_dot_count(2)

    await ext.render([a1])
    await view.wait_dot_count(1)
    sessions = await view.dot_sessions()
    assert "proj#1" in sessions
    assert "proj#2" not in sessions
