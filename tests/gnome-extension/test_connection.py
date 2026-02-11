import asyncio


async def test_connects_and_sends_config(ext):
    await ext.disconnect_client()
    await ext.wait_for_connection(timeout=10)
    msg = await ext.recv_until("auto_focus_config", timeout=10)
    assert "enabled" in msg
    assert "focus_delay_ms" in msg


async def test_sends_auto_focus_config_on_connect(ext):
    await ext.disconnect_client()
    await ext.wait_for_connection(timeout=10)
    msg = await ext.recv_until("auto_focus_config", timeout=5)
    assert isinstance(msg["enabled"], bool)
    assert isinstance(msg["focus_delay_ms"], int)


async def test_reconnect_after_disconnect(ext):
    await ext.disconnect_client()
    await ext.wait_for_connection(timeout=10)
    msg = await ext.recv_until("auto_focus_config", timeout=10)
    assert "enabled" in msg


async def test_reconnect_resends_initial(ext):
    await ext.disconnect_client()
    await ext.wait_for_connection(timeout=10)
    config = await ext.recv_until("auto_focus_config", timeout=10)
    assert "enabled" in config
    await ext.disconnect_client()
    await ext.wait_for_connection(timeout=10)
    config2 = await ext.recv_until("auto_focus_config", timeout=10)
    assert "enabled" in config2
