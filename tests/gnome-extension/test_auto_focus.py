import asyncio


async def test_default_config(ext):
    await ext.disconnect_client()
    await ext.wait_for_connection(timeout=10)
    msg = await ext.recv_until("auto_focus_config", timeout=5)
    assert msg["enabled"] is False
    assert msg["focus_delay_ms"] == 1000


async def test_toggle_via_settings(ext, gsettings):
    await gsettings("auto-focus-enabled", True)
    msg = await ext.recv_until("auto_focus_config", timeout=5)
    assert msg["enabled"] is True
    await gsettings("auto-focus-enabled", False)
    msg = await ext.recv_until("auto_focus_config", timeout=5)
    assert msg["enabled"] is False


async def test_button_style_disabled(ext, ext_view, gsettings):
    await gsettings("auto-focus-enabled", False)
    await asyncio.sleep(0.3)
    has = await ext_view.auto_focus_button_has_class("auto-focus-enabled")
    assert has is False


async def test_button_style_enabled(ext, ext_view, gsettings):
    await gsettings("auto-focus-enabled", True)
    await asyncio.sleep(0.3)
    has = await ext_view.auto_focus_button_has_class("auto-focus-enabled")
    assert has is True
    await gsettings("auto-focus-enabled", False)


async def test_delay_change(ext, gsettings):
    await gsettings("focus-delay-ms", 2000)
    msg = await ext.recv_until("auto_focus_config", timeout=5)
    assert msg["focus_delay_ms"] == 2000
    await gsettings("focus-delay-ms", 1000)
