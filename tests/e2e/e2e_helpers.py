import asyncio
import json
import os
import shutil
import signal
import subprocess
import sys

FOOT_AVAILABLE = shutil.which("foot") is not None

GNOME_EXT_TESTS = os.path.join(
    os.path.dirname(__file__), os.pardir, "gnome-extension"
)
if GNOME_EXT_TESTS not in sys.path:
    sys.path.insert(0, os.path.abspath(GNOME_EXT_TESTS))


class DaemonClient:

    def __init__(self, socket_path):
        self.socket_path = socket_path
        self.renders = []
        self._reader = None
        self._writer = None
        self._read_task = None

    async def connect(self):
        self._reader, self._writer = await asyncio.open_unix_connection(
            self.socket_path
        )
        self._read_task = asyncio.create_task(self._read_loop())

    async def mark_as_extension(self):
        await self._send({
            "type": "auto_focus_config",
            "enabled": False,
            "focus_delay_ms": 1000,
        })
        await asyncio.sleep(0.1)

    async def send_state(self, session, state, agent_type="claude", tool=""):
        await self._send({
            "type": "state",
            "session": session,
            "state": state,
            "tool": tool,
            "agent_type": agent_type,
        })

    async def send_window_focus(self, title):
        await self._send({"type": "window_focus", "title": title})

    async def send_session_workspace(self, session, workspace, monitor=0):
        await self._send({
            "type": "session_workspace",
            "session": session,
            "workspace": workspace,
            "monitor": monitor,
        })

    async def send_click(self, session):
        await self._send({"type": "click", "session": session})

    async def send_focus_next(self):
        await self._send({"type": "focus_next"})

    async def send_idle_status(self, idle):
        await self._send({"type": "idle_status", "idle": idle})

    async def send_auto_focus_config(self, enabled, focus_delay_ms=1000):
        await self._send({
            "type": "auto_focus_config",
            "enabled": enabled,
            "focus_delay_ms": focus_delay_ms,
        })

    async def wait_render(self, predicate=None, timeout=5):
        deadline = asyncio.get_event_loop().time() + timeout
        while asyncio.get_event_loop().time() < deadline:
            for r in self.renders:
                if r.get("type") == "render":
                    if predicate is None or predicate(r):
                        return r
            await asyncio.sleep(0.05)
        raise TimeoutError(
            f"No matching render within {timeout}s. "
            f"Got {len(self.renders)} messages: "
            f"{[m.get('type') for m in self.renders]}"
        )

    async def wait_render_with_session(self, session, timeout=5):
        def has_session(r):
            return any(a["session"] == session for a in r.get("agents", []))
        return await self.wait_render(has_session, timeout)

    async def wait_render_with_agents(self, count, timeout=5):
        def has_count(r):
            return len(r.get("agents", [])) == count
        return await self.wait_render(has_count, timeout)

    async def wait_message(self, msg_type, predicate=None, timeout=5):
        deadline = asyncio.get_event_loop().time() + timeout
        while asyncio.get_event_loop().time() < deadline:
            for m in self.renders:
                if m.get("type") == msg_type:
                    if predicate is None or predicate(m):
                        return m
            await asyncio.sleep(0.05)
        raise TimeoutError(
            f"No '{msg_type}' message within {timeout}s. "
            f"Got: {[m.get('type') for m in self.renders]}"
        )

    def last_render(self):
        for m in reversed(self.renders):
            if m.get("type") == "render":
                return m
        return None

    async def reset_for_test(self):
        await self._send({"type": "clear_agents"})
        await asyncio.sleep(0.2)
        self.renders.clear()

    def clear(self):
        self.renders.clear()

    async def disconnect(self):
        if self._read_task:
            self._read_task.cancel()
            try:
                await self._read_task
            except (asyncio.CancelledError, Exception):
                pass
            self._read_task = None
        if self._writer:
            self._writer.close()
            try:
                await self._writer.wait_closed()
            except Exception:
                pass
            self._writer = None
        self._reader = None

    async def _send(self, msg):
        assert self._writer is not None, "not connected"
        data = json.dumps(msg) + "\n"
        self._writer.write(data.encode())
        await self._writer.drain()

    async def _read_loop(self):
        try:
            while True:
                line = await self._reader.readline()
                if not line:
                    break
                msg = json.loads(line.decode())
                self.renders.append(msg)
        except (asyncio.CancelledError, ConnectionError):
            pass


class TerminalFactory:

    def __init__(self, env):
        self._env = env
        self._procs = []

    async def launch(self, session_key, agent_type="claude"):
        env = self._env.copy()
        if agent_type == "cursor":
            title = f"{session_key} | cursor"
            cmd = [
                "foot", "-a", "Cursor", "-T", title,
                "--hold", "-e", "sleep", "120",
            ]
        else:
            title = f"Argus ({session_key})"
            cmd = [
                "foot", "-T", title,
                "--hold", "-e", "sleep", "120",
            ]

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            env=env,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        self._procs.append(proc)
        await asyncio.sleep(0.5)
        return proc

    async def cleanup_all(self):
        for proc in self._procs:
            try:
                proc.send_signal(signal.SIGTERM)
            except ProcessLookupError:
                pass
        for proc in self._procs:
            try:
                await asyncio.wait_for(proc.wait(), timeout=3)
            except asyncio.TimeoutError:
                proc.kill()
                await proc.wait()
        self._procs.clear()


class WorkspaceManager:

    def __init__(self, shell_eval):
        self._eval = shell_eval

    async def ensure_workspaces(self, count):
        from ext_helper import _wrap
        await self._eval(_wrap(
            f"let wm = global.workspace_manager; "
            f"while (wm.get_n_workspaces() < {count}) "
            f"  wm.append_new_workspace(false, global.get_current_time()); "
            f"return wm.get_n_workspaces();"
        ))

    async def get_active_workspace(self):
        from ext_helper import _wrap
        val = await self._eval(_wrap(
            "return global.workspace_manager.get_active_workspace_index();"
        ))
        return int(val)

    async def switch_to_workspace(self, ws_index):
        from ext_helper import _wrap
        await self._eval(_wrap(
            f"let ws = global.workspace_manager.get_workspace_by_index({ws_index}); "
            f"if (ws) ws.activate(global.get_current_time()); "
            f"return '';"
        ))
        await asyncio.sleep(0.2)

    async def move_window_to_workspace(self, title_part, ws_index):
        from ext_helper import _wrap
        await self._eval(_wrap(
            f"let wins = global.get_window_actors().map(a => a.meta_window); "
            f"let win = wins.find(w => w.get_title() && w.get_title().includes('{title_part}')); "
            f"if (win) {{ "
            f"  let ws = global.workspace_manager.get_workspace_by_index({ws_index}); "
            f"  if (ws) win.change_workspace(ws); "
            f"}} "
            f"return '';"
        ))
        await asyncio.sleep(0.2)


async def send_hook_event(socket_path, session, state, agent_type="claude", tool=""):
    try:
        reader, writer = await asyncio.open_unix_connection(socket_path)
        msg = json.dumps({
            "type": "state",
            "session": session,
            "state": state,
            "tool": tool,
            "agent_type": agent_type,
        }) + "\n"
        writer.write(msg.encode())
        await writer.drain()
        writer.close()
        await writer.wait_closed()
    except Exception:
        pass


async def wait_session_tracked(view, session, timeout=5):
    from ext_helper import _wrap
    deadline = asyncio.get_event_loop().time() + timeout
    last_debug = ""
    while asyncio.get_event_loop().time() < deadline:
        try:
            val = await view.raw(_wrap(
                f"return _view._windowTracker._sessionToWindow.has('{session}');"
            ))
            if val:
                return True
            last_debug = await view.raw(_wrap(
                "let wins = global.get_window_actors().map(a => ({"
                "  t: a.meta_window.get_title(),"
                "  wm: a.meta_window.get_wm_class()"
                "}));"
                "let tracked = Array.from(_view._windowTracker._sessionToWindow.keys());"
                "return JSON.stringify({wins, tracked});"
            ))
        except Exception:
            pass
        await asyncio.sleep(0.2)
    raise TimeoutError(
        f"Session '{session}' not tracked within {timeout}s. "
        f"Debug: {last_debug}"
    )


async def get_focused_window_title(view):
    from ext_helper import _wrap
    val = await view.raw(_wrap(
        "let w = global.display.focus_window; "
        "return w ? w.get_title() : null;"
    ))
    return val
