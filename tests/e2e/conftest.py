import asyncio
import os
import sys
from datetime import datetime
from pathlib import Path

import pytest
import pytest_asyncio

GNOME_EXT_TESTS = os.path.join(
    os.path.dirname(__file__), os.pardir, "gnome-extension"
)
if GNOME_EXT_TESTS not in sys.path:
    sys.path.insert(0, os.path.abspath(GNOME_EXT_TESTS))

from shell_eval import make_shell_eval
from ext_helper import ExtView
from e2e_helpers import DaemonClient, TerminalFactory, WorkspaceManager, FOOT_AVAILABLE

_test_results = []


def _require_env(name):
    val = os.environ.get(name)
    if not val:
        pytest.skip(f"{name} not set. Run via: tests/e2e/run.sh")
    return val


@pytest_asyncio.fixture(scope="session")
async def dbus_address():
    return _require_env("E2E_DBUS_ADDRESS")


@pytest_asyncio.fixture(scope="session")
async def xdg_runtime_dir():
    return _require_env("E2E_XDG_RUNTIME_DIR")


@pytest_asyncio.fixture(scope="session")
async def daemon_socket():
    path = _require_env("E2E_DAEMON_SOCKET")
    assert os.path.exists(path), f"Daemon socket not found: {path}"
    return path


@pytest_asyncio.fixture(scope="session")
async def wayland_display():
    return _require_env("E2E_WAYLAND_DISPLAY")


@pytest_asyncio.fixture(scope="session")
async def shell_eval(dbus_address):
    return await make_shell_eval(dbus_address)


@pytest_asyncio.fixture(scope="session")
async def view(shell_eval):
    return ExtView(shell_eval)


@pytest_asyncio.fixture(scope="session")
async def gsettings(dbus_address):
    schema_dir = str(
        Path(__file__).resolve().parent.parent.parent
        / "src" / "clients" / "gnome"
        / "argus-agenticus@darkwing4.dev" / "schemas"
    )

    async def _set(key, value):
        env = os.environ.copy()
        env["DBUS_SESSION_BUS_ADDRESS"] = dbus_address
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


@pytest_asyncio.fixture
async def spy(daemon_socket, view):
    client = DaemonClient(daemon_socket)
    await client.connect()
    await client.mark_as_extension()
    await client.reset_for_test()
    yield client
    await client.disconnect()


@pytest_asyncio.fixture
async def terminals(xdg_runtime_dir, wayland_display, gsettings):
    await gsettings("terminal-wm-classes", "['foot']")
    await asyncio.sleep(0.3)
    env = os.environ.copy()
    env["XDG_RUNTIME_DIR"] = xdg_runtime_dir
    env["WAYLAND_DISPLAY"] = wayland_display
    factory = TerminalFactory(env)
    yield factory
    await factory.cleanup_all()


@pytest_asyncio.fixture
async def ws(shell_eval):
    return WorkspaceManager(shell_eval)


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
    lines.append("=== Argus Agenticus E2E Test Report ===")
    lines.append(f"Date: {now}")
    lines.append("")
    lines.append(f"{'#':>3}  {'Test':<50} {'Status':<8} {'Time':>10}")

    passed = 0
    failed = 0
    for i, r in enumerate(_test_results):
        status = "PASS" if r["passed"] else "FAIL"
        if r["passed"]:
            passed += 1
        else:
            failed += 1
        time_str = _format_time(r["duration_ms"])
        lines.append(f"{i+1:>3}  {r['name']:<50} {status:<8} {time_str:>10}")

    lines.append("")
    lines.append(f"Total: {passed} passed, {failed} failed")

    report_dir = Path(__file__).resolve().parent.parent.parent / "test-reports"
    report_dir.mkdir(exist_ok=True)
    report_path = report_dir / f"e2e-report-{ts_file}.txt"

    report_text = "\n".join(lines) + "\n"
    report_path.write_text(report_text)
    lines.append(f"Report: {report_path}")

    terminalreporter.write_sep("=", "E2E Performance Report")
    for line in lines:
        terminalreporter.write_line(line)


def _format_time(ms):
    if ms >= 1000:
        return f"{ms / 1000:.1f}s"
    elif ms >= 1:
        return f"{ms:.1f}ms"
    else:
        return f"{ms * 1000:.0f}us"
