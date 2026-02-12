import asyncio

from conftest import agent


async def test_survives_invalid_json(ext, view):
    ext._writer.write(b"not json at all\n")
    await ext._writer.drain()
    await ext.render([agent()])
    await view.wait_dot_count(1)


async def test_survives_unknown_message_type(ext, view):
    await ext.send({"type": "bogus_unknown_type", "data": 123})
    await ext.render([agent()])
    await view.wait_dot_count(1)


async def test_empty_render(ext, view):
    await ext.render([])
    await view.wait_dot_count(0)


async def test_large_render(ext, view):
    agents = [
        agent(session=f"s{i}#0", group=f"s{i}")
        for i in range(100)
    ]
    await ext.render(agents)
    await view.wait_dot_count(100, timeout=3.0)


async def test_rapid_renders(ext, view):
    for i in range(20):
        states = ["started", "awaiting", "working", "completed"]
        await ext.render([agent(session="r#0", state=states[i % 4], group="r")])
        await asyncio.sleep(0.05)
    await view.wait_dot_count(1)
