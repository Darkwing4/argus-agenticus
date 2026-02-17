import asyncio

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

    async def wait_dot_count(self, expected, timeout=2.0):
        return await self._poll(self.dot_count, expected, timeout)

    async def wait_visible(self, expected, timeout=2.0):
        return await self._poll(self.is_visible, expected, timeout)

    async def wait_group_count(self, expected, timeout=2.0):
        return await self._poll(self.group_count, expected, timeout)

    async def wait_dot_class(self, session, cls, timeout=2.0):
        async def check():
            classes = await self.dot_style_classes(session)
            return cls in classes
        return await self._poll(check, True, timeout)

    async def wait_no_dot_class(self, session, cls, timeout=2.0):
        async def check():
            classes = await self.dot_style_classes(session)
            return cls not in classes
        return await self._poll(check, True, timeout)

    async def dot_visual_order(self):
        val = await self._eval(_wrap(
            "let r = []; "
            "let box = _view._renderer._groupsBox; "
            "for (let gi = 0; gi < box.get_n_children(); gi++) { "
            "  let c = box.get_child_at_index(gi); "
            "  for (let di = 0; di < c.get_n_children(); di++) { "
            "    let child = c.get_child_at_index(di); "
            "    for (let [s, w] of _view._renderer._dotWidgets) { "
            "      if (w.button === child) { r.push(s); break; } "
            "    } "
            "  } "
            "} "
            "return r.join('|');"
        ))
        if not val:
            return []
        return val.split('|')

    async def wait_dot_visual_order(self, expected, timeout=2.0):
        return await self._poll(self.dot_visual_order, expected, timeout)

    async def wait_tooltip(self, expected, timeout=2.0):
        return await self._poll(self.tooltip_text, expected, timeout)

    async def wait_auto_focus_class(self, cls, expected, timeout=2.0):
        async def check():
            return await self.auto_focus_button_has_class(cls)
        return await self._poll(check, expected, timeout)

    async def clear_agents(self):
        await self._eval(_wrap(
            "_view._daemon.send({type: 'clear_agents'}); return '';"
        ))

    async def mark_all_started(self):
        await self._eval(_wrap(
            "_view._daemon.send({type: 'mark_all_started'}); return '';"
        ))

    async def wait_original_workspace(self, expected, timeout=2.0):
        return await self._poll(self.original_workspace, expected, timeout)

    async def _poll(self, fn, expected, timeout, interval=0.1):
        deadline = asyncio.get_event_loop().time() + timeout
        last = None
        while asyncio.get_event_loop().time() < deadline:
            last = await fn()
            if last == expected:
                return last
            await asyncio.sleep(interval)
        last = await fn()
        assert last == expected, f"poll timeout: expected {expected!r}, got {last!r}"
        return last
