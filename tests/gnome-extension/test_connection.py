import pytest


async def test_extension_connects(ext_client):
    assert ext_client is not None


async def test_initial_auto_focus_config(ext_client):
    msg = await ext_client.recv_until("auto_focus_config")
    assert "enabled" in msg
    assert "focus_delay_ms" in msg


async def test_initial_idle_status(ext_client):
    msg = await ext_client.recv_until("idle_status")
    assert msg["idle"] is True
