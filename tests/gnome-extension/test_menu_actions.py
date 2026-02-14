from conftest import agent


async def test_clear_agents_sends_message(ext, view):
    await ext.render([agent()])
    await view.wait_dot_count(1)
    await view.clear_agents()
    msg = await ext.recv_until("clear_agents", timeout=3)
    assert msg["type"] == "clear_agents"


async def test_mark_all_started_sends_message(ext, view):
    await ext.render([agent(state="awaiting")])
    await view.wait_dot_count(1)
    await view.mark_all_started()
    msg = await ext.recv_until("mark_all_started", timeout=3)
    assert msg["type"] == "mark_all_started"
