import asyncio


def make_agent(session="proj#1", state="started", group="proj",
               agent_type="claude", focused=False):
    return {
        "session": session,
        "state": state,
        "focused": focused,
        "group": group,
        "agent_type": agent_type,
    }


async def test_dot_click_sends_message(ext, ext_view):
    await ext.send({"type": "render", "agents": [make_agent()]})
    await asyncio.sleep(0.3)
    await ext_view.click_dot("proj#1")
    msg = await ext.recv_until("click", timeout=3)
    assert msg["session"] == "proj#1"


async def test_focus_next_sends_message(ext, ext_view):
    await ext_view.focus_next()
    msg = await ext.recv_until("focus_next", timeout=3)
    assert msg["type"] == "focus_next"


async def test_focus_command_no_crash(ext, ext_view):
    await ext.send({"type": "focus", "session": "nonexistent#99"})
    await asyncio.sleep(0.3)
    assert await ext_view.is_alive()
