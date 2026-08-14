"""Helpers for operational `.env` updates.

`Profile -> Settings` is one place to edit operational config in the UI, but the
values still persist to the backend `.env` because that is the real consumer for
server-side qaa-generator settings.
"""

from __future__ import annotations

from pathlib import Path
from tempfile import NamedTemporaryFile

from app.core.constants import EnvFile

BACKEND_PACKAGE_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ENV_FILE = BACKEND_PACKAGE_ROOT / EnvFile.DOT_ENV.value
COMMENT_MARKER = "#"
QUOTE_CHAR = '"'
ASSIGNMENT_SEPARATOR = "="
LINE_SEPARATOR = "\n"


def _serialize_env_value(value: str) -> str:
    if any(character.isspace() for character in value) or COMMENT_MARKER in value:
        escaped = value.replace("\\", "\\\\").replace(QUOTE_CHAR, f"\\{QUOTE_CHAR}")
        return f"{QUOTE_CHAR}{escaped}{QUOTE_CHAR}"
    return value


def _render_env_line(key: str, value: str) -> str:
    return f"{key}{ASSIGNMENT_SEPARATOR}{_serialize_env_value(value)}"


def upsert_env_values(path: Path, values: dict[str, str]) -> None:
    """Replace or append `KEY=value` pairs while preserving unrelated file layout."""

    existing_lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    remaining = dict(values)
    rewritten_lines: list[str] = []

    for line in existing_lines:
        replaced = False
        for key, value in list(remaining.items()):
            if line.startswith(f"{key}{ASSIGNMENT_SEPARATOR}"):
                rewritten_lines.append(_render_env_line(key, value))
                remaining.pop(key)
                replaced = True
                break
        if not replaced:
            rewritten_lines.append(line)

    if remaining:
        if rewritten_lines and rewritten_lines[-1] != "":
            rewritten_lines.append("")
        for key, value in remaining.items():
            rewritten_lines.append(_render_env_line(key, value))

    serialized = LINE_SEPARATOR.join(rewritten_lines)
    if rewritten_lines:
        serialized = f"{serialized}{LINE_SEPARATOR}"

    path.parent.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile(
        "w",
        encoding="utf-8",
        dir=path.parent,
        delete=False,
    ) as handle:
        handle.write(serialized)
        temp_path = Path(handle.name)
    temp_path.replace(path)
