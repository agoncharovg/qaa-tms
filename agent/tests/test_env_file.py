from __future__ import annotations

from pathlib import Path

from app.core.env_file import upsert_env_values


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def test_upsert_env_values_replaces_existing_line_in_place(tmp_path: Path) -> None:
    env_path = tmp_path / ".env"
    env_path.write_text("FIRST=1\nSECOND=2\n", encoding="utf-8")

    upsert_env_values(env_path, {"SECOND": "updated"})

    assert read_text(env_path) == "FIRST=1\nSECOND=updated\n"


def test_upsert_env_values_appends_missing_key_and_preserves_comments(tmp_path: Path) -> None:
    env_path = tmp_path / ".env"
    env_path.write_text("# comment\nFIRST=1\n\n", encoding="utf-8")

    upsert_env_values(env_path, {"SECOND": "two words"})

    assert read_text(env_path) == '# comment\nFIRST=1\n\nSECOND="two words"\n'


def test_upsert_env_values_creates_file_when_missing(tmp_path: Path) -> None:
    env_path = tmp_path / ".env"

    upsert_env_values(env_path, {"FIRST": "value"})

    assert read_text(env_path) == "FIRST=value\n"


def test_upsert_env_values_quotes_hash_values(tmp_path: Path) -> None:
    env_path = tmp_path / ".env"
    env_path.write_text("FIRST=1\n", encoding="utf-8")

    upsert_env_values(env_path, {"SECOND": "abc#123"})

    assert read_text(env_path) == 'FIRST=1\n\nSECOND="abc#123"\n'
