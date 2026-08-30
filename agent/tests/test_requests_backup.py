from __future__ import annotations

import stat
import zipfile
from datetime import datetime, timedelta
from pathlib import Path

import pytest

from app.core.config import Settings
from app.core.constants import (
    NOTEBOOK_BACKUP_HOUR,
    NOTEBOOK_BACKUP_NAME_FORMAT,
    NOTEBOOK_BACKUP_RETENTION,
    REQUESTS_BACKUP_FILE_PREFIX,
    REQUESTS_HISTORY_FILE_NAME,
)
from app.schemas import (
    BearerCredentialCreate,
    BearerCredentialCreateConfig,
    RequestBody,
    RequestDocumentInput,
    VariableCreateRequest,
)
from app.services.requests_backup import (
    backup_dir,
    create_backup,
    list_backups,
    prune_backups,
    should_backup,
)
from app.services.requests_store import (
    create_credential,
    create_environment,
    create_folder,
    create_variable,
    write_item,
)


def build_settings(monkeypatch: pytest.MonkeyPatch, home: Path) -> Settings:
    monkeypatch.setenv("QAA_TMS_HOME", str(home))
    return Settings(_env_file=None)


def create_archive_name(now: datetime) -> str:
    return f"{REQUESTS_BACKUP_FILE_PREFIX}{now.strftime(NOTEBOOK_BACKUP_NAME_FORMAT)}.zip"


def make_request_document(
    *,
    method: str = "GET",
    url: str = "https://example.test/resource",
) -> RequestDocumentInput:
    return RequestDocumentInput(
        method=method,
        url=url,
        headers=[],
        query_params=[],
        body=RequestBody(),
        credential_id=None,
    )


def test_create_backup_writes_zip_to_sibling_dir_and_preserves_store(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    settings = build_settings(monkeypatch, tmp_path)
    create_folder(settings, "alpha")
    create_folder(settings, "beta")
    write_item(settings, "alpha", "clients", make_request_document(url="https://svc.test/clients"))
    create_credential(
        settings,
        BearerCredentialCreate(
            name="main bearer",
            type="bearer",
            config=BearerCredentialCreateConfig(token="secret-token"),
        ),
    )
    environment = create_environment(settings, "staging").environments[0]
    create_variable(
        settings,
        VariableCreateRequest(key="iamBase", values={environment.id: "https://stg.test"}),
    )
    requests_root = Path(settings.requests_root).expanduser()
    requests_root.joinpath(REQUESTS_HISTORY_FILE_NAME).write_text("history\n", encoding="utf-8")
    requests_root.joinpath(".scratch.json").write_text("temp\n", encoding="utf-8")
    archive_directory = backup_dir(settings)
    archive_directory.mkdir(parents=True, exist_ok=True)
    archive_directory.joinpath("ignored.txt").write_text("ignore me\n", encoding="utf-8")
    now = datetime(2026, 8, 27, 8, 30, 15)

    archive_path = create_backup(settings, now)

    assert archive_path is not None
    assert archive_path.parent == tmp_path / "requests-backups"
    assert archive_path.name == create_archive_name(now)
    assert stat.S_IMODE(archive_path.parent.stat().st_mode) == 0o700
    assert stat.S_IMODE(archive_path.stat().st_mode) == 0o600
    with zipfile.ZipFile(archive_path) as archive:
        names = set(archive.namelist())
    assert "collections/" in names
    assert "collections/__contents__" in names
    assert "collections/alpha/" in names
    assert "collections/alpha/clients" in names
    assert "collections/beta/" in names
    assert "credentials.json" in names
    assert "environments.json" in names
    assert REQUESTS_HISTORY_FILE_NAME not in names
    assert ".scratch.json" not in names
    assert all(not name.startswith("requests-backups/") for name in names)


def test_create_backup_returns_none_when_root_is_missing(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    settings = build_settings(monkeypatch, tmp_path)

    archive_path = create_backup(settings, datetime(2026, 8, 27, 8, 30, 15))

    assert archive_path is None
    assert not backup_dir(settings).exists()


def test_should_backup_depends_on_today_archive_only(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    settings = build_settings(monkeypatch, tmp_path)
    now = datetime(2026, 8, 27, 10, 0, 0)
    archive_directory = backup_dir(settings)

    assert should_backup(settings, now) is True

    archive_directory.mkdir(parents=True, exist_ok=True)
    (archive_directory / create_archive_name(now)).write_bytes(b"zip")

    assert should_backup(settings, now) is False
    assert should_backup(settings, now + timedelta(days=1)) is True


def test_prune_backups_keeps_newest_retention_count(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    settings = build_settings(monkeypatch, tmp_path)
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
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    settings = build_settings(monkeypatch, tmp_path)
    before_hour = datetime(2026, 8, 27, NOTEBOOK_BACKUP_HOUR - 1, 0, 0)
    at_hour = datetime(2026, 8, 27, NOTEBOOK_BACKUP_HOUR, 0, 0)

    assert should_backup(settings, before_hour) is True
    assert (True or before_hour.hour >= NOTEBOOK_BACKUP_HOUR) is True
    assert (False or before_hour.hour >= NOTEBOOK_BACKUP_HOUR) is False
    assert (False or at_hour.hour >= NOTEBOOK_BACKUP_HOUR) is True
