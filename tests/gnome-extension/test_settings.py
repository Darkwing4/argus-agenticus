import asyncio


async def test_auto_focus_enabled_sends_config(ext, gsettings):
    await gsettings("auto-focus-enabled", True)
    msg = await ext.recv_until("auto_focus_config", timeout=5)
    assert msg["enabled"] is True
    await gsettings("auto-focus-enabled", False)
    msg = await ext.recv_until("auto_focus_config", timeout=5)
    assert msg["enabled"] is False


async def test_focus_delay_sends_config(ext, gsettings):
    await gsettings("focus-delay-ms", 500)
    msg = await ext.recv_until("auto_focus_config", timeout=5)
    assert msg["focus_delay_ms"] == 500
    await gsettings("focus-delay-ms", 1000)


async def test_idle_threshold_triggers_reset(ext, gsettings):
    await gsettings("input-idle-threshold-ms", 2000)
    msg = await ext.recv_until("idle_status", timeout=5)
    assert msg["idle"] is False
    await gsettings("input-idle-threshold-ms", 1000)
