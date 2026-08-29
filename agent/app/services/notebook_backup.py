"""Filesystem notebook backup service and scheduler."""

from __future__ import annotations

import asyncio
import logging
import os
import tempfile
import zipfile
from datetime import date, datetime
from pathlib import Path

from fastapi import FastAPI

from app.core.config import Settings
from app.core.constants import (
    NOTEBOOK_BACKUP_DIR_SUFFIX,
    NOTEBOOK_BACKUP_FILE_PREFIX,
    NOTEBOOK_BACKUP_HOUR,
    NOTEBOOK_BACKUP_NAME_FORMAT,
    NOTEBOOK_BACKUP_POLL_SECONDS,
    NOTEBOOK_BACKUP_RETENTION,
)
from app.services.notebook import NotebookRootMissingError, _resolve_root

logger = logging.getLogger(__name__)

ZIP_EXTENSION = ".zip"
TEMP_FILE_PREFIX = ".notebook-backup-"
TIMESTAMP_SAMPLE = datetime(2000, 1, 2, 3, 4, 5)
BACKUP_TIMESTAMP_LENGTH = len(TIMESTAMP_SAMPLE.strftime(NOTEBOOK_BACKUP_NAME_FORMAT))


def backup_dir(settings: Settings) -> Path:
    root = Path(settings.notebook_root).expanduser()
    return root.parent / f"{root.name}{NOTEBOOK_BACKUP_DIR_SUFFIX}"


def list_backups(settings: Settings) -> list[Path]:
    directory = backup_dir(settings)
    if not directory.is_dir():
        return []
    return sorted(
        (
            path
            for path in directory.glob(f"*{ZIP_EXTENSION}")
            if path.is_file() and path.name.startswith(NOTEBOOK_BACKUP_FILE_PREFIX)
        ),
        key=_backup_sort_key,
        reverse=True,
    )


def latest_backup_date(settings: Settings) -> date | None:
    for path in list_backups(settings):
        parsed = _parse_backup_name(path.name)
        if parsed is None:
            continue
        created_at, _ = parsed
        return created_at.date()
    return None


def should_backup(settings: Settings, now: datetime) -> bool:
    return latest_backup_date(settings) != now.date()


def create_backup(settings: Settings, now: datetime) -> Path | None:
    configured_root = Path(settings.notebook_root).expanduser()
    try:
        root = _resolve_root(settings)
    except NotebookRootMissingError:
        if configured_root.exists():
            raise
        return None

    directory = backup_dir(settings)
    directory.mkdir(parents=True, exist_ok=True)
    target = _build_backup_path(directory, now)
    temp_handle, temp_name = tempfile.mkstemp(
        dir=directory,
        prefix=TEMP_FILE_PREFIX,
        suffix=".tmp",
    )
    os.close(temp_handle)
    temp_path = Path(temp_name)
    try:
        with zipfile.ZipFile(temp_path, mode="w", compression=zipfile.ZIP_DEFLATED) as archive:
            for current_root, dirnames, filenames in os.walk(root):
                dirnames.sort()
                filenames.sort()
                current_path = Path(current_root)
                relative_root = current_path.relative_to(root)
                if relative_root != Path("."):
                    archive.writestr(f"{relative_root.as_posix()}/", "")
                for filename in filenames:
                    file_path = current_path / filename
                    archive.write(file_path, arcname=file_path.relative_to(root).as_posix())
        os.replace(temp_path, target)
    except Exception:
        try:
            temp_path.unlink()
        except FileNotFoundError:
            pass
        raise

    prune_backups(settings)
    return target


def prune_backups(settings: Settings) -> None:
    for path in list_backups(settings)[NOTEBOOK_BACKUP_RETENTION:]:
        try:
            path.unlink()
        except FileNotFoundError:
            continue


def seconds_until_poll() -> float:
    return NOTEBOOK_BACKUP_POLL_SECONDS


async def run_backup_loop(app: FastAPI) -> None:
    first_tick = True
    while True:
        try:
            settings = app.state.settings
            now = datetime.now()
            if should_backup(settings, now):
                if first_tick or now.hour >= NOTEBOOK_BACKUP_HOUR:
                    create_backup(settings, now)
        except Exception:
            logger.exception("Notebook auto-backup tick failed")
        first_tick = False
        await asyncio.sleep(seconds_until_poll())


def _build_backup_path(directory: Path, now: datetime) -> Path:
    stem = f"{NOTEBOOK_BACKUP_FILE_PREFIX}{now.strftime(NOTEBOOK_BACKUP_NAME_FORMAT)}"
    candidate = directory / f"{stem}{ZIP_EXTENSION}"
    if not candidate.exists():
        return candidate
    suffix = 1
    while True:
        candidate = directory / f"{stem}-{suffix}{ZIP_EXTENSION}"
        if not candidate.exists():
            return candidate
        suffix += 1


def _backup_sort_key(path: Path) -> tuple[int, datetime, int, str]:
    parsed = _parse_backup_name(path.name)
    if parsed is None:
        return (0, datetime.min, -1, path.name)
    created_at, suffix = parsed
    return (1, created_at, suffix, path.name)


def _parse_backup_name(name: str) -> tuple[datetime, int] | None:
    if not name.startswith(NOTEBOOK_BACKUP_FILE_PREFIX) or not name.endswith(ZIP_EXTENSION):
        return None
    suffix_text = name.removeprefix(NOTEBOOK_BACKUP_FILE_PREFIX).removesuffix(ZIP_EXTENSION)
    timestamp = suffix_text[:BACKUP_TIMESTAMP_LENGTH]
    if len(timestamp) != BACKUP_TIMESTAMP_LENGTH:
        return None
    remainder = suffix_text[BACKUP_TIMESTAMP_LENGTH:]
    if remainder:
        if not remainder.startswith("-") or not remainder[1:].isdigit():
            return None
        collision_suffix = int(remainder[1:])
    else:
        collision_suffix = 0
    try:
        created_at = datetime.strptime(timestamp, NOTEBOOK_BACKUP_NAME_FORMAT)
    except ValueError:
        return None
    return created_at, collision_suffix
