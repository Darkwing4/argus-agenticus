from conftest import agent


async def test_focus_unmapped_session(ext, view):
    await ext.focus("ghost#99")
    assert await view.is_alive()


async def test_auto_focus_saves_workspace(ext, view):
    await ext.auto_focus("proj#1")
    await view.wait_original_workspace(0)


async def test_return_workspace_clears(ext, view):
    await ext.auto_focus("proj#1")
    await view.wait_original_workspace(0)
    await ext.return_workspace()
    await view.wait_original_workspace(None)


async def test_auto_focus_no_crash(ext, view):
    await ext.auto_focus("nonexistent#0")
    await ext.return_workspace()
    assert await view.is_alive()


async def test_auto_focus_default_config(ext):
    await ext.disconnect_client()
    await ext.wait_for_connection(timeout=10)
    msg = await ext.recv_until("auto_focus_config", timeout=5)
    assert msg["enabled"] is False
    assert msg["focus_delay_ms"] == 1000


async def test_auto_focus_toggle(ext, gsettings):
    await gsettings("auto-focus-enabled", True)
    msg = await ext.recv_until("auto_focus_config", timeout=5)
    assert msg["enabled"] is True
    await gsettings("auto-focus-enabled", False)
    msg = await ext.recv_until("auto_focus_config", timeout=5)
    assert msg["enabled"] is False


async def test_auto_focus_button_style(ext, view, gsettings):
    await gsettings("auto-focus-enabled", False)
    await view.wait_auto_focus_class("auto-focus-enabled", False)

    await gsettings("auto-focus-enabled", True)
    await view.wait_auto_focus_class("auto-focus-enabled", True)
    await gsettings("auto-focus-enabled", False)


async def test_focus_delay_change(ext, gsettings):
    await gsettings("focus-delay-ms", 2000)
    msg = await ext.recv_until("auto_focus_config", timeout=5)
    assert msg["focus_delay_ms"] == 2000
    await gsettings("focus-delay-ms", 1000)
