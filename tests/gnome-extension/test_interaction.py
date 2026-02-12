from conftest import agent


async def test_dot_click_sends_message(ext, view):
    await ext.render([agent()])
    await view.wait_dot_count(1)
    await view.click_dot("proj#1")
    msg = await ext.recv_until("click", timeout=3)
    assert msg["session"] == "proj#1"


async def test_focus_next_sends_message(ext, view):
    await view.focus_next()
    msg = await ext.recv_until("focus_next", timeout=3)
    assert msg["type"] == "focus_next"


async def test_tooltip_on_hover(ext, view):
    await ext.render([agent()])
    await view.wait_dot_count(1)
    await view.hover_dot("proj#1", enter=True)
    await view.wait_tooltip("proj#1")
    await view.hover_dot("proj#1", enter=False)


async def test_tooltip_hides_on_leave(ext, view):
    await ext.render([agent()])
    await view.wait_dot_count(1)
    await view.hover_dot("proj#1", enter=True)
    await view.wait_tooltip("proj#1")
    await view.hover_dot("proj#1", enter=False)
    await view.wait_tooltip(None)
