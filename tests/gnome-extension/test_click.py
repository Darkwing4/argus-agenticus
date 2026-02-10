import asyncio


async def test_focus_no_crash(ext_client):
    await ext_client.recv_until("auto_focus_config")
    await ext_client.send({
        "type": "focus",
        "session": "test#1",
    })
    await asyncio.sleep(0.3)
