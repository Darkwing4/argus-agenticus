async def test_idle_status_received(ext_client):
    msg = await ext_client.recv_until("idle_status", timeout=5)
    assert isinstance(msg["idle"], bool)
