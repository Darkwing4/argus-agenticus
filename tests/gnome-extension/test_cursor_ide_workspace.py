import asyncio

import pytest

from conftest import agent
from ext_helper import PREAMBLE


async def test_extract_session_key_cursor_ide_three_part_title(ext, view):
    js = (
        f"(async () => {{ {PREAMBLE}"
        "return _view._windowTracker.extractSessionKey("
        "'main.py \u2014 my-project \u2014 Cursor'"
        ");"
        "})()"
    )
    result = await view.raw(js)
    assert result == "my-project", (
        f"extractSessionKey should return 'my-project' for "
        f"'main.py \u2014 my-project \u2014 Cursor', got {result!r}"
    )


async def test_extract_session_key_cursor_ide_two_part_title(ext, view):
    js = (
        f"(async () => {{ {PREAMBLE}"
        "return _view._windowTracker.extractSessionKey("
        "'my-project \u2014 Cursor'"
        ");"
        "})()"
    )
    result = await view.raw(js)
    assert result == "my-project", (
        f"extractSessionKey should return 'my-project' for "
        f"'my-project \u2014 Cursor', got {result!r}"
    )


async def test_extract_session_key_cursor_ide_nested_path(ext, view):
    js = (
        f"(async () => {{ {PREAMBLE}"
        "return _view._windowTracker.extractSessionKey("
        "'src/utils/helper.ts \u2014 argus-agenticus \u2014 Cursor'"
        ");"
        "})()"
    )
    result = await view.raw(js)
    assert result == "argus-agenticus", (
        f"extractSessionKey should return 'argus-agenticus' for "
        f"Cursor IDE title with nested path, got {result!r}"
    )


async def test_extract_session_key_existing_formats_unchanged(ext, view):
    cases = [
        ("Argus (proj#1)", "proj#1"),
        ("Zellij (work#2)", "work#2"),
        ("proj#1 | file.py", "proj#1"),
    ]
    for title, expected in cases:
        js = (
            f"(async () => {{ {PREAMBLE}"
            f"return _view._windowTracker.extractSessionKey('{title}');"
            "})()"
        )
        result = await view.raw(js)
        assert result == expected, (
            f"extractSessionKey('{title}') should return '{expected}', got {result!r}"
        )


async def test_workspace_message_uses_project_name_for_cursor_ide(ext, view):
    await ext.render([
        agent("my-project#1", state="working", group="my-project", agent_type="cursor"),
    ])
    await view.wait_dot_count(1)

    ext.messages.clear()

    js = (
        f"(async () => {{ {PREAMBLE}"
        "var key = _view._windowTracker.extractSessionKey("
        "'main.py \u2014 my-project \u2014 Cursor'"
        ");"
        "var group = key ? (key.split('#')[0] || key) : null;"
        "return group;"
        "})()"
    )
    result = await view.raw(js)
    assert result == "my-project", (
        f"groupName for session_workspace should be 'my-project', got {result!r}"
    )
