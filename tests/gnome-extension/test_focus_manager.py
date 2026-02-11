import asyncio


async def test_focus_unmapped_session(ext, ext_view):
    await ext.send({"type": "focus", "session": "ghost#99"})
    await asyncio.sleep(0.3)
    assert await ext_view.is_alive()


async def test_auto_focus_saves_workspace(ext, ext_view):
    await ext.send({"type": "auto_focus", "session": "proj#1"})
    await asyncio.sleep(0.3)
    ws = await ext_view.original_workspace()
    assert ws is not None


async def test_return_workspace_clears(ext, ext_view):
    await ext.send({"type": "auto_focus", "session": "proj#1"})
    await asyncio.sleep(0.2)
    await ext.send({"type": "return_workspace"})
    await asyncio.sleep(0.2)
    ws = await ext_view.original_workspace()
    assert ws is None


async def test_auto_focus_no_crash(ext, ext_view):
    await ext.send({"type": "auto_focus", "session": "nonexistent#0"})
    await asyncio.sleep(0.3)
    await ext.send({"type": "return_workspace"})
    await asyncio.sleep(0.2)
    assert await ext_view.is_alive()
