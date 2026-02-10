import asyncio


async def test_render_no_crash(ext_client):
    await ext_client.recv_until("auto_focus_config")
    await ext_client.send({
        "type": "render",
        "agents": [
            {
                "session": "test#1",
                "state": "awaiting",
                "focused": False,
                "group": "test",
                "agent_type": "claude",
            }
        ],
    })
    await asyncio.sleep(0.5)
    await ext_client.send({"type": "render", "agents": []})
    await asyncio.sleep(0.2)


async def test_render_empty_agents(ext_client):
    await ext_client.recv_until("auto_focus_config")
    await ext_client.send({"type": "render", "agents": []})
    await asyncio.sleep(0.3)
