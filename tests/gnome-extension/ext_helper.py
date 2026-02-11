EXT_UUID = "argus-agenticus@darkwing4.dev"

PREAMBLE = (
    "var _M = await import('resource:///org/gnome/shell/ui/main.js'); "
    f"var _ext = _M.extensionManager.lookup('{EXT_UUID}'); "
    "var _view = _ext.stateObj._view; "
)


def _wrap(body):
    return f"(async () => {{ {PREAMBLE}{body} }})()"


class ExtView:

    def __init__(self, shell_eval):
        self._eval = shell_eval

    async def raw(self, js):
        return await self._eval(js)

    async def dot_count(self):
        val = await self._eval(_wrap(
            "return Number(_view._renderer._dotWidgets.size);"
        ))
        return int(val)

    async def dot_sessions(self):
        val = await self._eval(_wrap(
            "return [..._view._renderer._dotWidgets.keys()];"
        ))
        return val

    async def dot_style_classes(self, session):
        val = await self._eval(_wrap(
            f"var _w = _view._renderer._dotWidgets.get('{session}'); "
            "return _w ? _w.dot.get_style_class_name() : '';"
        ))
        return val

    async def group_count(self):
        val = await self._eval(_wrap(
            "return Number(_view._renderer._groupContainers.size);"
        ))
        return int(val)

    async def is_visible(self):
        val = await self._eval(_wrap(
            "return _view.visible;"
        ))
        return bool(val)

    async def auto_focus_button_has_class(self, cls):
        val = await self._eval(_wrap(
            f"return _view._renderer._autoFocusButton.has_style_class_name('{cls}');"
        ))
        return bool(val)

    async def original_workspace(self):
        val = await self._eval(_wrap(
            "var _ws = _view._focusManager._originalWorkspace; "
            "return _ws === null ? null : _ws;"
        ))
        return val

    async def click_dot(self, session):
        await self._eval(_wrap(
            f"var _w = _view._renderer._dotWidgets.get('{session}'); "
            "if (_w) _w.button.emit('clicked', _w.button); return '';"
        ))

    async def focus_next(self):
        await self._eval(_wrap(
            "_view.focusNext(); return '';"
        ))

    async def hover_dot(self, session, enter=True):
        if enter:
            await self._eval(_wrap(
                f"var _w = _view._renderer._dotWidgets.get('{session}'); "
                f"if (_w) {{ _view._renderer.showTooltip(_w.button, '{session}'); }} "
                "return '';"
            ))
        else:
            await self._eval(_wrap(
                "_view._renderer.hideTooltip(); return '';"
            ))

    async def tooltip_text(self):
        val = await self._eval(_wrap(
            "var _tip = _view._renderer._tooltip; "
            "return _tip ? _tip.text : null;"
        ))
        return val

    async def is_alive(self):
        try:
            val = await self._eval("'alive';")
            return val == "alive"
        except Exception:
            return False
