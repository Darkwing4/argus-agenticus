import asyncio
import os
import signal
from datetime import datetime
from pathlib import Path

import pytest
import pytest_asyncio

from mock_daemon import MockDaemon
from shell_eval import make_shell_eval
from ext_helper import ExtView

GNOME_SHELL_STARTUP_TIMEOUT = 15
DBUS_STARTUP_TIMEOUT = 5

_test_results = []


def agent(session="proj#1", state="started", group="proj",
          agent_type="claude", focused=False):
    return {
        "session": session,
        "state": state,
        "focused": focused,
        "group": group,
        "agent_type": agent_type,
    }


# ---------------------------------------------------------------------------
# Session-scoped fixtures (gnome-shell starts once per test run)
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture(scope="session")
async def tmp_session(tmp_path_factory):
    return tmp_path_factory.mktemp("gnome")


@pytest_asyncio.fixture(scope="session")
async def mock_daemon(tmp_session):
    socket_dir = tmp_session / "agents-monitor"
    socket_dir.mkdir(parents=True, exist_ok=True)
    socket_path = str(socket_dir / "daemon.sock")
    daemon = MockDaemon(socket_path)
    await daemon.start()
    yield daemon
    await daemon.stop()


@pytest_asyncio.fixture(scope="session")
async def dbus_session(tmp_session):
    env = os.environ.copy()
    env["XDG_RUNTIME_DIR"] = str(tmp_session)

    proc = await asyncio.create_subprocess_exec(
        "dbus-daemon", "--session", "--print-address", "--nofork",
        env=env,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    try:
        raw = await asyncio.wait_for(proc.stdout.readline(), timeout=DBUS_STARTUP_TIMEOUT)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        pytest.fail("dbus-daemon did not print address in time")

    address = raw.decode().strip()
    assert address, "dbus-daemon returned empty address"

    yield address, env

    proc.send_signal(signal.SIGTERM)
    try:
        await asyncio.wait_for(proc.wait(), timeout=5)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()


@pytest_asyncio.fixture(scope="session")
async def gnome_shell(dbus_session, mock_daemon, tmp_session):
    address, base_env = dbus_session
    env = base_env.copy()
    env["DBUS_SESSION_BUS_ADDRESS"] = address
    env["XDG_RUNTIME_DIR"] = str(tmp_session)

    proc = await asyncio.create_subprocess_exec(
        "gnome-shell", "--headless", "--wayland", "--no-x11", "--unsafe-mode",
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


@pytest_asyncio.fixture(scope="session")
async def shell_eval(dbus_session, gnome_shell):
    address, _ = dbus_session
    return await make_shell_eval(address)


@pytest_asyncio.fixture(scope="session")
async def view(shell_eval):
    return ExtView(shell_eval)


# ---------------------------------------------------------------------------
# Per-test fixture: drains initial messages, resets state after test
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture
async def ext(mock_daemon, gnome_shell, view):
    mock_daemon.messages.clear()
    yield mock_daemon
    try:
        await mock_daemon.render([])
    except Exception:
        pass
    await asyncio.sleep(0.1)
    await _drain_pending(mock_daemon)


async def _drain_pending(daemon):
    while True:
        try:
            await daemon.recv(timeout=0.3)
        except (asyncio.TimeoutError, TimeoutError):
            break


# ---------------------------------------------------------------------------
# gsettings helper
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture(scope="session")
async def gsettings(dbus_session, gnome_shell):
    address, base_env = dbus_session

    schema_dir = str(
        Path(__file__).resolve().parent.parent.parent
        / "src" / "clients" / "gnome" / "argus-agenticus@darkwing4.dev" / "schemas"
    )

    async def _set(key, value):
        env = base_env.copy()
        env["DBUS_SESSION_BUS_ADDRESS"] = address
        env["GSETTINGS_SCHEMA_DIR"] = schema_dir
        if isinstance(value, bool):
            val_str = "true" if value else "false"
        elif isinstance(value, int):
            val_str = str(value)
        else:
            val_str = str(value)
        proc = await asyncio.create_subprocess_exec(
            "gsettings", "set",
            "org.gnome.shell.extensions.argus-agenticus",
            key, val_str,
            env=env,
        )
        await proc.wait()

    return _set


# ---------------------------------------------------------------------------
# Performance reporting hooks
# ---------------------------------------------------------------------------

def pytest_runtest_makereport(item, call):
    if call.when == "call":
        _test_results.append({
            "name": item.name,
            "passed": call.excinfo is None,
            "duration_ms": call.duration * 1000,
        })


def pytest_terminal_summary(terminalreporter, config):
    if not _test_results:
        return

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    ts_file = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")

    lines = []
    lines.append("=== Argus Agenticus GNOME Extension Test Report ===")
    lines.append(f"Date: {now}")
    lines.append("")
    lines.append(f"{'#':>3}  {'Test':<44} {'Status':<8} {'Time':>10}")

    passed = 0
    failed = 0
    for i, r in enumerate(_test_results):
        status = "PASS" if r["passed"] else "FAIL"
        if r["passed"]:
            passed += 1
        else:
            failed += 1
        time_str = _format_time(r["duration_ms"])
        lines.append(f"{i+1:>3}  {r['name']:<44} {status:<8} {time_str:>10}")

    lines.append("")
    lines.append(f"Total: {passed} passed, {failed} failed")

    report_dir = Path(__file__).resolve().parent.parent.parent / "test-reports"
    report_dir.mkdir(exist_ok=True)
    report_path = report_dir / f"gnome-ext-report-{ts_file}.txt"

    report_text = "\n".join(lines) + "\n"
    report_path.write_text(report_text)
    lines.append(f"Report: {report_path}")

    terminalreporter.write_sep("=", "GNOME Extension Performance Report")
    for line in lines:
        terminalreporter.write_line(line)


def _format_time(ms):
    if ms >= 1000:
        return f"{ms / 1000:.1f}s"
    elif ms >= 1:
        return f"{ms:.1f}ms"
    else:
        return f"{ms * 1000:.0f}us"
