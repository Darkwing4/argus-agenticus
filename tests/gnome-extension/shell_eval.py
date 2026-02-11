import asyncio
import json
import os
import re


async def make_shell_eval(dbus_address):
    env = {
        "DBUS_SESSION_BUS_ADDRESS": dbus_address,
        "HOME": os.environ.get("HOME", "/tmp"),
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
    }

    async def eval_js(code):
        proc = await asyncio.create_subprocess_exec(
            "gdbus", "call", "--session",
            "--dest", "org.gnome.Shell",
            "--object-path", "/org/gnome/Shell",
            "--method", "org.gnome.Shell.Eval",
            code,
            env=env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()
        raw_out = stdout.decode().strip()
        raw_err = stderr.decode().strip()
        if proc.returncode != 0:
            raise RuntimeError(
                f"Shell.Eval failed (rc={proc.returncode}): {raw_err}"
            )
        return _parse_gdbus_output(raw_out, raw_err)

    return eval_js


def _parse_gdbus_output(raw, stderr=""):
    m = re.match(r"\((true|false),\s*'(.*?)'\)\s*$", raw, re.DOTALL)
    if not m:
        m = re.match(r'\((true|false),\s*"(.*?)"\)\s*$', raw, re.DOTALL)
    if not m:
        raise ValueError(f"unexpected gdbus output: {raw!r}")
    success = m.group(1) == "true"
    value = m.group(2).replace("\\'", "'")
    if not success:
        raise RuntimeError(
            f"Shell.Eval JS error: {value!r} (raw: {raw!r}, stderr: {stderr!r})"
        )
    try:
        return json.loads(value)
    except (json.JSONDecodeError, ValueError):
        return value
