async def test_sends_config_on_connect(ext):
    await ext.disconnect_client()
    await ext.wait_for_connection(timeout=10)
    msg = await ext.recv_until("auto_focus_config", timeout=10)
    assert isinstance(msg["enabled"], bool)
    assert isinstance(msg["focus_delay_ms"], int)


async def test_reconnect_resends_config(ext):
    await ext.disconnect_client()
    await ext.wait_for_connection(timeout=10)
    first = await ext.recv_until("auto_focus_config", timeout=10)
    assert "enabled" in first

    await ext.disconnect_client()
    await ext.wait_for_connection(timeout=10)
    second = await ext.recv_until("auto_focus_config", timeout=10)
    assert "enabled" in second
