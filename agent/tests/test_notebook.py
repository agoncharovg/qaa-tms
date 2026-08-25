from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.core.config import Settings
from app.core.constants import EnvKey
from app.services import notebook as notebook_service
from app.services.notebook import (
    NotebookPathValidationError,
    NotebookRootMissingError,
    create_bookmark,
    delete_bookmark,
    delete_note,
    list_bookmarks,
    list_notes,
    read_note,
    rename_bookmark,
    search,
    set_flags,
    write_note,
)


def build_settings(root: Path) -> Settings:
    return Settings(_env_file=None, **{EnvKey.NOTEBOOK_ROOT.value: str(root)})


def read_contents_json(root: Path) -> object:
    return json.loads((root / "__contents__").read_text(encoding="utf-8"))


def test_bookmark_and_note_crud(tmp_path: Path) -> None:
    root = tmp_path / "notebook"
    settings = build_settings(root)

    create_bookmark(settings, "alpha")
    note_name = write_note(settings, "alpha", None, "line1\nline2\nline3\nline4")

    tree = list_bookmarks(settings)
    assert [bookmark.name for bookmark in tree.bookmarks] == ["alpha"]
    assert tree.bookmarks[0].note_count == 1

    notes = list_notes(settings, "alpha")
    assert [note.name for note in notes.notes] == [note_name]
    assert notes.notes[0].preview_lines == ["line1", "line2", "line3"]

    note = read_note(settings, "alpha", note_name)
    assert note.text == "line1\nline2\nline3\nline4"

    rename_bookmark(settings, "alpha", "beta")
    assert [bookmark.name for bookmark in list_bookmarks(settings).bookmarks] == ["beta"]

    delete_note(settings, "beta", note_name)
    assert list_notes(settings, "beta").notes == []

    delete_bookmark(settings, "beta")
    assert list_bookmarks(settings).bookmarks == []


def test_write_note_generates_collision_suffix(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    root = tmp_path / "notebook"
    settings = build_settings(root)
    create_bookmark(settings, "alpha")
    monkeypatch.setattr(
        notebook_service,
        "_current_note_base_name",
        lambda: "2026-08-25-14-30-05",
    )

    first = write_note(settings, "alpha", None, "one")
    second = write_note(settings, "alpha", None, "two")
    third = write_note(settings, "alpha", None, "three")

    assert first == "2026-08-25-14-30-05"
    assert second == "2026-08-25-14-30-05-1"
    assert third == "2026-08-25-14-30-05-2"


def test_sparse_flags_overlay_set_and_clear(tmp_path: Path) -> None:
    root = tmp_path / "notebook"
    settings = build_settings(root)
    create_bookmark(settings, "alpha")
    note_name = write_note(settings, "alpha", None, "body")

    set_flags(settings, "alpha", None, {"star": True})
    set_flags(settings, "alpha", note_name, {"important": True})

    stored = read_contents_json(root)
    assert stored[0]["flags"] == {"star": True}
    assert stored[0]["notes"][note_name] == {"important": True}

    set_flags(settings, "alpha", note_name, {})
    set_flags(settings, "alpha", None, {})

    stored = read_contents_json(root)
    assert "flags" not in stored[0]
    assert "notes" not in stored[0]


def test_self_heal_uses_filesystem_truth(tmp_path: Path) -> None:
    root = tmp_path / "notebook"
    root.mkdir()
    (root / "alpha").mkdir()
    (root / "beta").mkdir()
    (root / "__contents__").write_text(
        json.dumps([{"name": "alpha"}, {"name": "ghost"}]),
        encoding="utf-8",
    )

    tree = list_bookmarks(build_settings(root))

    assert [bookmark.name for bookmark in tree.bookmarks] == ["alpha", "beta"]


def test_search_returns_matching_notes(tmp_path: Path) -> None:
    root = tmp_path / "notebook"
    settings = build_settings(root)
    create_bookmark(settings, "alpha")
    create_bookmark(settings, "beta")
    first = write_note(settings, "alpha", None, "Needle\nfirst\nsecond")
    write_note(settings, "alpha", None, "nothing here")
    second = write_note(settings, "beta", None, "prefix needle suffix")

    result = search(settings, "needle")

    assert [(match.bookmark, match.name) for match in result.matches] == [
        ("alpha", first),
        ("beta", second),
    ]
    assert result.matches[0].preview_lines == ["Needle", "first", "second"]


@pytest.mark.parametrize(
    "bookmark_name",
    ["..", "nested/name", "nested\\name", "/tmp/evil"],
)
def test_bookmark_path_traversal_is_rejected(
    bookmark_name: str,
    tmp_path: Path,
) -> None:
    settings = build_settings(tmp_path / "notebook")

    with pytest.raises(NotebookPathValidationError):
        create_bookmark(settings, bookmark_name)


@pytest.mark.parametrize(
    "note_name",
    ["..", "nested/name", "nested\\name", "/tmp/evil"],
)
def test_note_path_traversal_is_rejected(note_name: str, tmp_path: Path) -> None:
    root = tmp_path / "notebook"
    settings = build_settings(root)
    create_bookmark(settings, "alpha")

    with pytest.raises(NotebookPathValidationError):
        write_note(settings, "alpha", note_name, "body")


def test_missing_root_raises_until_first_write(tmp_path: Path) -> None:
    root = tmp_path / "notebook"
    settings = build_settings(root)

    with pytest.raises(NotebookRootMissingError):
        list_bookmarks(settings)

    with pytest.raises(NotebookRootMissingError):
        search(settings, "anything")

    create_bookmark(settings, "alpha")

    assert root.exists()
    assert [bookmark.name for bookmark in list_bookmarks(settings).bookmarks] == ["alpha"]


def test_malformed_contents_is_treated_as_empty(tmp_path: Path) -> None:
    root = tmp_path / "notebook"
    root.mkdir()
    (root / "alpha").mkdir()
    (root / "__contents__").write_text("{not-json", encoding="utf-8")

    tree = list_bookmarks(build_settings(root))

    assert [bookmark.name for bookmark in tree.bookmarks] == ["alpha"]
