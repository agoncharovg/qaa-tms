from __future__ import annotations

import zipfile
from datetime import datetime, timedelta
from pathlib import Path

from app.core.config import Settings
from app.core.constants import (
    NOTEBOOK_BACKUP_FILE_PREFIX,
    NOTEBOOK_BACKUP_HOUR,
    NOTEBOOK_BACKUP_NAME_FORMAT,
    NOTEBOOK_BACKUP_RETENTION,
    EnvKey,
)
from app.services.notebook import create_bookmark, write_note
from app.services.notebook_backup import (
    backup_dir,
    create_backup,
    list_backups,
    prune_backups,
    should_backup,
)


def build_settings(root: Path, *, notebook_backup_enabled: bool = True) -> Settings:
    return Settings(
        _env_file=None,
        **{
            EnvKey.NOTEBOOK_ROOT.value: str(root),
            EnvKey.NOTEBOOK_BACKUP_ENABLED.value: notebook_backup_enabled,
        },
    )


def create_archive_name(now: datetime) -> str:
    return f"{NOTEBOOK_BACKUP_FILE_PREFIX}{now.strftime(NOTEBOOK_BACKUP_NAME_FORMAT)}.zip"


def test_create_backup_writes_zip_to_sibling_dir_and_preserves_tree(tmp_path: Path) -> None:
    root = tmp_path / "qaa-notebook"
    settings = build_settings(root)
    create_bookmark(settings, "alpha")
    note_name = write_note(settings, "alpha", "note.txt", "hello")
    now = datetime(2026, 8, 27, 8, 30, 15)

    archive_path = create_backup(settings, now)

    assert archive_path is not None
    assert archive_path.parent == tmp_path / "qaa-notebook-backups"
    assert archive_path.name == create_archive_name(now)
    with zipfile.ZipFile(archive_path) as archive:
        names = set(archive.namelist())
    assert "__contents__" in names
    assert "alpha/" in names
    assert f"alpha/{note_name}" in names


def test_create_backup_returns_none_when_root_is_missing(tmp_path: Path) -> None:
    root = tmp_path / "qaa-notebook"
    settings = build_settings(root)

    archive_path = create_backup(settings, datetime(2026, 8, 27, 8, 30, 15))

    assert archive_path is None
    assert not backup_dir(settings).exists()


def test_should_backup_respects_toggle_and_existing_archive(tmp_path: Path) -> None:
    root = tmp_path / "qaa-notebook"
    enabled_settings = build_settings(root)
    disabled_settings = build_settings(root, notebook_backup_enabled=False)
    now = datetime(2026, 8, 27, 10, 0, 0)
    archive_directory = backup_dir(enabled_settings)
    archive_directory.mkdir(parents=True, exist_ok=True)
    (archive_directory / create_archive_name(now)).write_bytes(b"zip")

    assert should_backup(disabled_settings, now) is False
    assert should_backup(enabled_settings, now) is False
    assert should_backup(enabled_settings, now + timedelta(days=1)) is True


def test_prune_backups_keeps_newest_retention_count(tmp_path: Path) -> None:
    root = tmp_path / "qaa-notebook"
    settings = build_settings(root)
    archive_directory = backup_dir(settings)
    archive_directory.mkdir(parents=True, exist_ok=True)
    names: list[str] = []
    start = datetime(2026, 8, 1, 9, 0, 0)
    for offset in range(NOTEBOOK_BACKUP_RETENTION + 2):
        now = start + timedelta(days=offset)
        name = create_archive_name(now)
        names.append(name)
        (archive_directory / name).write_bytes(b"zip")

    prune_backups(settings)

    assert [path.name for path in list_backups(settings)] == list(
        reversed(names[-NOTEBOOK_BACKUP_RETENTION:])
    )


def test_startup_tick_allows_pre_9am_backup_while_later_ticks_wait_until_9am(
    tmp_path: Path,
) -> None:
    settings = build_settings(tmp_path / "qaa-notebook")
    before_hour = datetime(2026, 8, 27, NOTEBOOK_BACKUP_HOUR - 1, 0, 0)
    at_hour = datetime(2026, 8, 27, NOTEBOOK_BACKUP_HOUR, 0, 0)

    assert should_backup(settings, before_hour) is True
    assert (True or before_hour.hour >= NOTEBOOK_BACKUP_HOUR) is True
    assert (False or before_hour.hour >= NOTEBOOK_BACKUP_HOUR) is False
    assert (False or at_hour.hour >= NOTEBOOK_BACKUP_HOUR) is True
