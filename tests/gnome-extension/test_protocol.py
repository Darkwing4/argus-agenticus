import asyncio


async def test_invalid_json(ext, ext_view):
    ext._writer.write(b"not json at all\n")
    await ext._writer.drain()
    await asyncio.sleep(0.3)
    assert await ext_view.is_alive()


async def test_unknown_message_type(ext, ext_view):
    await ext.send({"type": "bogus_unknown_type", "data": 123})
    await asyncio.sleep(0.3)
    assert await ext_view.is_alive()


async def test_empty_render_agents(ext, ext_view):
    await ext.send({"type": "render", "agents": []})
    await asyncio.sleep(0.3)
    assert await ext_view.dot_count() == 0


async def test_large_render(ext, ext_view):
    agents = []
    for i in range(100):
        agents.append({
            "session": f"s{i}#0",
            "state": "started",
            "focused": False,
            "group": f"s{i}",
            "agent_type": "claude",
        })
    await ext.send({"type": "render", "agents": agents})
    await asyncio.sleep(1.0)
    count = await ext_view.dot_count()
    assert count == 100


async def test_rapid_renders(ext, ext_view):
    for i in range(20):
        agents = [{
            "session": f"r#0",
            "state": ["started", "awaiting", "working", "completed"][i % 4],
            "focused": False,
            "group": "r",
            "agent_type": "claude",
        }]
        await ext.send({"type": "render", "agents": agents})
        await asyncio.sleep(0.05)
    await asyncio.sleep(0.3)
    assert await ext_view.is_alive()
    assert await ext_view.dot_count() == 1
