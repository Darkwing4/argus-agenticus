import asyncio
import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
HOOK_SCRIPT = ROOT / "src" / "hooks" / "events-to-socket.sh"
HOOK_CONFIG = ROOT / "src" / "agents" / "codex" / "hooks.json"
HAS_TRANSPORT = shutil.which("socat") is not None or shutil.which("nc") is not None


class CodexHookConfigTest(unittest.TestCase):
    def test_lifecycle_configuration(self):
        config = json.loads(HOOK_CONFIG.read_text())
        hooks = config["hooks"]

        self.assertEqual(
            set(hooks),
            {
                "SessionStart",
                "UserPromptSubmit",
                "PreToolUse",
                "PostToolUse",
                "PermissionRequest",
                "Stop",
                "SessionEnd",
            },
        )
        self.assertEqual(hooks["SessionStart"][0]["matcher"], "startup|resume|clear")
        self.assertEqual(hooks["SessionEnd"][0]["hooks"][0]["timeout"], 3)


@unittest.skipUnless(shutil.which("jq"), "jq is required")
@unittest.skipUnless(HAS_TRANSPORT, "socat or nc is required")
class CodexHookFunctionalTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.runtime_dir = self.root / "runtime"
        self.socket_path = self.runtime_dir / "agents-monitor" / "daemon.sock"
        self.socket_path.parent.mkdir(parents=True)
        self.workspace = self.root / "standalone-project"
        self.workspace.mkdir()
        self.messages = asyncio.Queue()
        self.connections = set()
        self.server = await asyncio.start_unix_server(
            self._receive_message,
            path=str(self.socket_path),
        )

    async def asyncTearDown(self):
        self.server.close()
        await self.server.wait_closed()
        writers = list(self.connections)
        for writer in writers:
            writer.close()
        if writers:
            await asyncio.gather(
                *(writer.wait_closed() for writer in writers),
                return_exceptions=True,
            )
        self.temp_dir.cleanup()

    async def _receive_message(self, reader, writer):
        self.connections.add(writer)
        try:
            line = await reader.readline()
            await self.messages.put(json.loads(line))
        finally:
            self.connections.discard(writer)
            writer.close()
            await writer.wait_closed()

    async def _run_hook(self, event, tool=None, zellij=False):
        payload = {
            "session_id": "0123456789abcdef",
            "cwd": str(self.workspace),
            "hook_event_name": event,
        }
        if tool is not None:
            payload["tool_name"] = tool

        env = os.environ.copy()
        env["ARGUS_AGENT_TYPE"] = "codex"
        env["XDG_RUNTIME_DIR"] = str(self.runtime_dir)
        env.pop("ZELLIJ_SESSION_NAME", None)
        env.pop("ZELLIJ_PANE_ID", None)
        if zellij:
            env["ZELLIJ_SESSION_NAME"] = 'team "alpha"'
            env["ZELLIJ_PANE_ID"] = "9"

        process = await asyncio.create_subprocess_exec(
            "bash",
            str(HOOK_SCRIPT),
            cwd=self.workspace,
            env=env,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        await process.communicate(json.dumps(payload).encode())
        self.assertEqual(process.returncode, 0)
        return await self.messages.get()

    async def _assert_lifecycle(self, zellij):
        expected_states = [
            ("SessionStart", "started", None),
            ("UserPromptSubmit", "processing", None),
            ("PreToolUse", "working", 'Bash "quoted"'),
            ("PostToolUse", "working", "apply_patch"),
            ("PermissionRequest", "awaiting", "Bash"),
            ("Stop", "completed", None),
            ("SessionEnd", "ended", None),
        ]

        for event, state, tool in expected_states:
            with self.subTest(event=event):
                message = await self._run_hook(event, tool=tool, zellij=zellij)
                expected_session = (
                    'team "alpha"#9-cdx'
                    if zellij
                    else "standalone-project#cdx-01234567"
                )
                expected = {
                    "type": "state",
                    "session": expected_session,
                    "state": state,
                    "tool": tool or "",
                    "agent_type": "codex",
                    "uncommitted_count": 0,
                }
                if zellij:
                    expected["multiplexer"] = "zellij"
                self.assertEqual(message, expected)

    async def test_standalone_lifecycle_states(self):
        await self._assert_lifecycle(zellij=False)

    async def test_zellij_lifecycle_states(self):
        await self._assert_lifecycle(zellij=True)


if __name__ == "__main__":
    unittest.main()
