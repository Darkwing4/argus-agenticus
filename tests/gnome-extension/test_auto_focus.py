async def test_auto_focus_config_on_connect(ext_client):
    msg = await ext_client.recv_until("auto_focus_config")
    assert msg["enabled"] is False
    assert msg["focus_delay_ms"] == 1000
