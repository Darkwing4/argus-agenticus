import asyncio


async def test_idle_detected(ext, gsettings):
    await gsettings("input-idle-threshold-ms", 200)
    msg = await ext.recv_until("idle_status", timeout=5)
    while not msg["idle"]:
        msg = await ext.recv_until("idle_status", timeout=5)
    assert msg["idle"] is True


async def test_idle_status_is_bool(ext, gsettings):
    await gsettings("input-idle-threshold-ms", 250)
    msg = await ext.recv_until("idle_status", timeout=5)
    assert isinstance(msg["idle"], bool)


async def test_idle_active_on_threshold_change(ext, gsettings):
    await gsettings("input-idle-threshold-ms", 300)
    msg = await ext.recv_until("idle_status", timeout=5)
    assert msg["idle"] is False


async def test_idle_cycle(ext, gsettings):
    await gsettings("input-idle-threshold-ms", 350)
    active = await ext.recv_until("idle_status", timeout=5)
    assert active["idle"] is False
    idle = await ext.recv_until("idle_status", timeout=5)
    assert idle["idle"] is True
