import asyncio
import os
import signal

import pytest
import pytest_asyncio

from mock_daemon import MockDaemon

GNOME_SHELL_STARTUP_TIMEOUT = 15


@pytest_asyncio.fixture
async def mock_daemon(tmp_path):
    socket_dir = tmp_path / "agents-monitor"
    socket_dir.mkdir(parents=True, exist_ok=True)
    socket_path = str(socket_dir / "daemon.sock")
    daemon = MockDaemon(socket_path)
    await daemon.start()
    yield daemon
    await daemon.stop()


@pytest_asyncio.fixture
async def gnome_shell(mock_daemon, tmp_path):
    env = os.environ.copy()
    env["XDG_RUNTIME_DIR"] = str(tmp_path)

    proc = await asyncio.create_subprocess_exec(
        "dbus-run-session", "--",
        "gnome-shell", "--headless", "--wayland", "--no-x11",
        env=env,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    try:
        await asyncio.wait_for(
            mock_daemon.wait_for_connection(),
            timeout=GNOME_SHELL_STARTUP_TIMEOUT,
        )
    except (asyncio.TimeoutError, Exception):
        proc.send_signal(signal.SIGTERM)
        stdout, stderr = await proc.communicate()
        pytest.fail(
            f"GNOME Shell did not connect within {GNOME_SHELL_STARTUP_TIMEOUT}s.\n"
            f"stdout: {stdout.decode(errors='replace')[-2000:]}\n"
            f"stderr: {stderr.decode(errors='replace')[-2000:]}"
        )

    yield proc

    proc.send_signal(signal.SIGTERM)
    try:
        await asyncio.wait_for(proc.wait(), timeout=5)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()


@pytest_asyncio.fixture
async def ext_client(mock_daemon, gnome_shell):
    return mock_daemon
