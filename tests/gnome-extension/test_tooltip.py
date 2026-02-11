import asyncio


def make_agent(session="proj#1", state="started", group="proj"):
    return {
        "session": session,
        "state": state,
        "focused": False,
        "group": group,
        "agent_type": "claude",
    }


async def test_tooltip_on_hover(ext, ext_view):
    await ext.send({"type": "render", "agents": [make_agent()]})
    await asyncio.sleep(0.3)
    await ext_view.hover_dot("proj#1", enter=True)
    await asyncio.sleep(0.1)
    text = await ext_view.tooltip_text()
    assert text is not None
    await ext_view.hover_dot("proj#1", enter=False)


async def test_tooltip_text_is_session(ext, ext_view):
    await ext.send({"type": "render", "agents": [make_agent()]})
    await asyncio.sleep(0.3)
    await ext_view.hover_dot("proj#1", enter=True)
    await asyncio.sleep(0.1)
    text = await ext_view.tooltip_text()
    assert text == "proj#1"
    await ext_view.hover_dot("proj#1", enter=False)


async def test_tooltip_hides_on_leave(ext, ext_view):
    await ext.send({"type": "render", "agents": [make_agent()]})
    await asyncio.sleep(0.3)
    await ext_view.hover_dot("proj#1", enter=True)
    await asyncio.sleep(0.1)
    await ext_view.hover_dot("proj#1", enter=False)
    await asyncio.sleep(0.1)
    text = await ext_view.tooltip_text()
    assert text is None
