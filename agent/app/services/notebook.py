"""Filesystem-backed personal notebook service."""

from __future__ import annotations

import json
import os
import shutil
import tempfile
from datetime import datetime
from pathlib import Path
from typing import TypedDict

from app.core.config import Settings
from app.schemas import (
    NotebookBookmarkNode,
    NotebookContentsResponse,
    NotebookNoteReadResponse,
    NotebookNotesResponse,
    NotebookNoteSummary,
    NotebookReminder,
    NotebookSearchMatch,
    NotebookSearchResponse,
)

type NotebookFlags = dict[str, object]
CONTENTS_FILE_NAME = "__contents__"
PREVIEW_LINE_LIMIT = 3
GENERATED_NOTE_NAME_FORMAT = "%Y-%m-%d-%H-%M-%S"
TEMP_FILE_PREFIX = ".notebook-"
BOOKMARK_KIND = "Bookmark"
NOTE_KIND = "Note"


class NotebookContentsNode(TypedDict, total=False):
    name: str
    children: list[NotebookContentsNode]
    flags: NotebookFlags
    notes: dict[str, NotebookFlags]


type NotebookContentsTree = list[NotebookContentsNode]


class NotebookRootMissingError(RuntimeError):
    pass


class NotebookPathValidationError(ValueError):
    pass


class NotebookBookmarkNotFoundError(FileNotFoundError):
    pass


class NotebookNoteNotFoundError(FileNotFoundError):
    pass


class NotebookConflictError(RuntimeError):
    pass


def read_contents(settings: Settings) -> NotebookContentsTree:
    root = _resolve_root(settings)
    return _read_contents_from_root(root)


def list_bookmarks(settings: Settings) -> NotebookContentsResponse:
    root = _resolve_root(settings)
    contents = _read_contents_from_root(root)
    existing = _existing_bookmark_paths(root)
    seen_names: set[str] = set()
    bookmarks = _build_bookmark_tree(contents, existing, seen_names)
    for name, path in existing.items():
        if name in seen_names:
            continue
        bookmarks.append(
            NotebookBookmarkNode(name=name, note_count=_count_notes(path), flags={}, children=[])
        )
    return NotebookContentsResponse(bookmarks=bookmarks)


def list_notes(settings: Settings, bookmark: str) -> NotebookNotesResponse:
    root = _resolve_root(settings)
    bookmark_name, bookmark_path = _require_bookmark(root, bookmark)
    contents = _read_contents_from_root(root)
    note_flags = _note_flags_for_bookmark(contents, bookmark_name)
    notes = [
        NotebookNoteSummary(
            name=note_path.name,
            preview_lines=_preview_lines(_read_text(note_path)),
            flags=dict(note_flags.get(note_path.name, {})),
        )
        for note_path in _note_paths(bookmark_path)
    ]
    return NotebookNotesResponse(bookmark=bookmark_name, notes=notes)


def list_active_reminders(settings: Settings) -> list[NotebookReminder]:
    root = _resolve_root(settings)
    contents = _read_contents_from_root(root)
    reminders: list[NotebookReminder] = []
    _collect_active_reminders(root, contents, reminders)
    return reminders


def read_note(settings: Settings, bookmark: str, name: str) -> NotebookNoteReadResponse:
    root = _resolve_root(settings)
    bookmark_name, bookmark_path = _require_bookmark(root, bookmark)
    note_name, note_path = _require_note(root, bookmark_path, name)
    contents = _read_contents_from_root(root)
    text = _read_text(note_path)
    note_flags = _note_flags_for_bookmark(contents, bookmark_name)
    return NotebookNoteReadResponse(
        bookmark=bookmark_name,
        name=note_name,
        text=text,
        preview_lines=_preview_lines(text),
        flags=dict(note_flags.get(note_name, {})),
    )


def write_note(settings: Settings, bookmark: str, name: str | None, text: str) -> str:
    root = _resolve_root(settings, create=True)
    _, bookmark_path = _require_bookmark(root, bookmark)
    if name is None:
        note_name = _generate_note_name(bookmark_path)
    else:
        note_name = _validate_name(root, name, NOTE_KIND)
    note_path = _note_path(root, bookmark_path, note_name)
    _write_text_atomically(note_path, text)
    return note_name


def move_note(settings: Settings, source_bookmark: str, target_bookmark: str, name: str) -> None:
    root = _resolve_root(settings)
    source_bookmark_name, source_bookmark_path = _require_bookmark(root, source_bookmark)
    target_bookmark_name, target_bookmark_path = _require_bookmark(root, target_bookmark)
    note_name, source_note_path = _require_note(root, source_bookmark_path, name)
    if source_bookmark_name == target_bookmark_name:
        return
    target_note_path = _note_path(root, target_bookmark_path, note_name)
    if target_note_path.exists():
        raise NotebookConflictError(
            f"Note already exists in bookmark {target_bookmark_name}: {note_name}"
        )
    source_note_path.rename(target_note_path)
    contents = _read_contents_from_root(root)
    if _move_note_flags(contents, source_bookmark_name, target_bookmark_name, note_name):
        _write_contents_atomically(root, contents)


def delete_note(settings: Settings, bookmark: str, name: str) -> None:
    root = _resolve_root(settings)
    bookmark_name, bookmark_path = _require_bookmark(root, bookmark)
    note_name, note_path = _require_note(root, bookmark_path, name)
    note_path.unlink()
    contents = _read_contents_from_root(root)
    if _clear_note_flags(contents, bookmark_name, note_name):
        _write_contents_atomically(root, contents)


def create_bookmark(settings: Settings, name: str) -> None:
    root = _resolve_root(settings, create=True)
    bookmark_name = _validate_name(root, name, BOOKMARK_KIND)
    bookmark_path = _bookmark_path(root, bookmark_name)
    if bookmark_path.exists():
        raise NotebookConflictError(f"Bookmark already exists: {bookmark_name}")
    bookmark_path.mkdir()
    contents = _read_contents_from_root(root)
    if _find_node(contents, bookmark_name) is None:
        contents.append({"name": bookmark_name})
    _write_contents_atomically(root, contents)


def rename_bookmark(settings: Settings, bookmark: str, new_name: str) -> None:
    root = _resolve_root(settings)
    bookmark_name, bookmark_path = _require_bookmark(root, bookmark)
    target_name = _validate_name(root, new_name, BOOKMARK_KIND)
    target_path = _bookmark_path(root, target_name)
    if bookmark_name != target_name and target_path.exists():
        raise NotebookConflictError(f"Bookmark already exists: {target_name}")
    if bookmark_name != target_name:
        bookmark_path.rename(target_path)
    contents = _read_contents_from_root(root)
    changed = _rename_node(contents, bookmark_name, target_name)
    if not changed and bookmark_name != target_name and _find_node(contents, target_name) is None:
        contents.append({"name": target_name})
        changed = True
    if changed:
        _write_contents_atomically(root, contents)


def delete_bookmark(settings: Settings, bookmark: str) -> None:
    root = _resolve_root(settings)
    bookmark_name, bookmark_path = _require_bookmark(root, bookmark)
    shutil.rmtree(bookmark_path)
    contents = _read_contents_from_root(root)
    if _remove_node(contents, bookmark_name):
        _write_contents_atomically(root, contents)


def write_contents(settings: Settings, contents: object) -> None:
    root = _resolve_root(settings, create=True)
    _write_contents_atomically(root, _normalize_contents_tree(contents, root))


def reorder_bookmarks(settings: Settings, names: list[str]) -> None:
    root = _resolve_root(settings)
    contents = _read_contents_from_root(root)
    by_name: dict[str, NotebookContentsNode] = {}
    for node in contents:
        by_name[node["name"]] = node
    reordered: NotebookContentsTree = []
    for name in names:
        if name in by_name:
            reordered.append(by_name.pop(name))
    for node in contents:
        if node["name"] in by_name:
            reordered.append(node)
            del by_name[node["name"]]
    _write_contents_atomically(root, reordered)


def set_flags(
    settings: Settings,
    bookmark: str,
    note: str | None,
    flags: dict[str, object],
) -> None:
    root = _resolve_root(settings)
    bookmark_name, bookmark_path = _require_bookmark(root, bookmark)
    note_name: str | None = None
    if note is not None:
        note_name, _ = _require_note(root, bookmark_path, note)
    contents = _read_contents_from_root(root)
    normalized_flags = _normalize_flags(flags)
    node = _find_node(contents, bookmark_name)
    if note_name is None:
        if node is None:
            if not normalized_flags:
                return
            node = {"name": bookmark_name}
            contents.append(node)
        if normalized_flags:
            node["flags"] = normalized_flags
        else:
            node.pop("flags", None)
        _write_contents_atomically(root, contents)
        return
    if node is None:
        if not normalized_flags:
            return
        node = {"name": bookmark_name}
        contents.append(node)
    note_flags = dict(node.get("notes", {}))
    if normalized_flags:
        note_flags[note_name] = normalized_flags
        node["notes"] = note_flags
    else:
        if note_name not in note_flags:
            return
        note_flags.pop(note_name)
        if note_flags:
            node["notes"] = note_flags
        else:
            node.pop("notes", None)
    _write_contents_atomically(root, contents)


def search(settings: Settings, query: str) -> NotebookSearchResponse:
    root = _resolve_root(settings)
    normalized_query = query.strip()
    if not normalized_query:
        return NotebookSearchResponse(query="", matches=[])
    contents = _read_contents_from_root(root)
    existing = _existing_bookmark_paths(root)
    lowered_query = normalized_query.lower()
    matches: list[NotebookSearchMatch] = []
    for bookmark_name in _ordered_bookmark_names(existing, contents):
        for note_path in _note_paths(existing[bookmark_name]):
            text = _read_text(note_path)
            if lowered_query not in text.lower():
                continue
            matches.append(
                NotebookSearchMatch(
                    bookmark=bookmark_name,
                    name=note_path.name,
                    preview_lines=_preview_lines(text),
                )
            )
    return NotebookSearchResponse(query=normalized_query, matches=matches)


def _resolve_root(settings: Settings, create: bool = False) -> Path:
    root = Path(settings.notebook_root).expanduser()
    if root.exists():
        if not root.is_dir():
            raise NotebookRootMissingError(f"The notebook root is not a directory: {root}")
        return root.resolve()
    if not create:
        raise NotebookRootMissingError(f"The notebook root does not exist: {root}")
    root.mkdir(parents=True, exist_ok=True)
    return root.resolve()


def _read_contents_from_root(root: Path) -> NotebookContentsTree:
    contents_path = root / CONTENTS_FILE_NAME
    if not contents_path.exists():
        return []
    text = _read_text(contents_path)
    if not text.strip():
        return []
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        return []
    return _normalize_contents_tree(payload, root)


def _normalize_contents_tree(payload: object, root: Path) -> NotebookContentsTree:
    if isinstance(payload, list):
        raw_nodes = payload
    elif isinstance(payload, dict):
        raw_nodes = payload.get("bookmarks", [])
    else:
        return []
    return _normalize_contents_nodes(raw_nodes, root, set())


def _normalize_contents_nodes(
    raw_nodes: object,
    root: Path,
    seen_names: set[str],
) -> NotebookContentsTree:
    if not isinstance(raw_nodes, list):
        return []
    nodes: NotebookContentsTree = []
    for raw_node in raw_nodes:
        if not isinstance(raw_node, dict):
            continue
        raw_name = raw_node.get("name")
        if not isinstance(raw_name, str):
            continue
        try:
            name = _validate_name(root, raw_name, BOOKMARK_KIND)
        except NotebookPathValidationError:
            continue
        if name in seen_names:
            continue
        seen_names.add(name)
        node: NotebookContentsNode = {"name": name}
        children = _normalize_contents_nodes(raw_node.get("children"), root, seen_names)
        flags = _normalize_flags(raw_node.get("flags"))
        notes = _normalize_note_flags(raw_node.get("notes"), root)
        if children:
            node["children"] = children
        if flags:
            node["flags"] = flags
        if notes:
            node["notes"] = notes
        nodes.append(node)
    return nodes


def _normalize_note_flags(raw_notes: object, root: Path) -> dict[str, NotebookFlags]:
    if not isinstance(raw_notes, dict):
        return {}
    notes: dict[str, NotebookFlags] = {}
    for raw_name, raw_flags in raw_notes.items():
        if not isinstance(raw_name, str):
            continue
        try:
            name = _validate_name(root, raw_name, NOTE_KIND)
        except NotebookPathValidationError:
            continue
        flags = _normalize_flags(raw_flags)
        if flags:
            notes[name] = flags
    return notes


def _normalize_flags(raw_flags: object) -> NotebookFlags:
    if not isinstance(raw_flags, dict):
        return {}
    return {key: value for key, value in raw_flags.items() if isinstance(key, str)}


def _existing_bookmark_paths(root: Path) -> dict[str, Path]:
    bookmarks: dict[str, Path] = {}
    for path in sorted(root.iterdir(), key=lambda item: item.name):
        if path.name == CONTENTS_FILE_NAME or not path.is_dir():
            continue
        try:
            name = _validate_name(root, path.name, BOOKMARK_KIND)
        except NotebookPathValidationError:
            continue
        bookmarks[name] = path.resolve()
    return bookmarks


def _build_bookmark_tree(
    contents: NotebookContentsTree,
    existing: dict[str, Path],
    seen_names: set[str],
) -> list[NotebookBookmarkNode]:
    bookmarks: list[NotebookBookmarkNode] = []
    for node in contents:
        name = node["name"]
        if name not in existing or name in seen_names:
            continue
        seen_names.add(name)
        bookmarks.append(
            NotebookBookmarkNode(
                name=name,
                note_count=_count_notes(existing[name]),
                flags=dict(node.get("flags", {})),
                children=_build_bookmark_tree(node.get("children", []), existing, seen_names),
            )
        )
    return bookmarks


def _ordered_bookmark_names(
    existing: dict[str, Path],
    contents: NotebookContentsTree,
) -> list[str]:
    ordered: list[str] = []
    _collect_ordered_names(contents, existing, set(), ordered)
    for name in existing:
        if name not in ordered:
            ordered.append(name)
    return ordered


def _collect_ordered_names(
    contents: NotebookContentsTree,
    existing: dict[str, Path],
    seen_names: set[str],
    ordered: list[str],
) -> None:
    for node in contents:
        name = node["name"]
        if name not in existing or name in seen_names:
            continue
        seen_names.add(name)
        ordered.append(name)
        _collect_ordered_names(node.get("children", []), existing, seen_names, ordered)


def _collect_active_reminders(
    root: Path,
    contents: NotebookContentsTree,
    reminders: list[NotebookReminder],
) -> None:
    for node in contents:
        bookmark_name = node["name"]
        for note_name, flags in node.get("notes", {}).items():
            raw_remind_at = flags.get("remindAt")
            if not isinstance(raw_remind_at, str) or not raw_remind_at.strip():
                continue
            if "remindDismissedAt" in flags:
                continue
            note_path = _bookmark_path(root, bookmark_name) / note_name
            if not note_path.is_file():
                continue
            reminders.append(
                NotebookReminder(
                    bookmark=bookmark_name,
                    name=note_name,
                    remind_at=raw_remind_at,
                    preview_lines=_preview_lines(_read_text(note_path)),
                )
            )
        _collect_active_reminders(root, node.get("children", []), reminders)


def _count_notes(bookmark_path: Path) -> int:
    return sum(1 for path in bookmark_path.iterdir() if path.is_file())


def _note_paths(bookmark_path: Path) -> list[Path]:
    return sorted((path for path in bookmark_path.iterdir() if path.is_file()), reverse=True)


def _note_flags_for_bookmark(
    contents: NotebookContentsTree,
    bookmark: str,
) -> dict[str, NotebookFlags]:
    node = _find_node(contents, bookmark)
    if node is None:
        return {}
    return dict(node.get("notes", {}))


def _find_node(contents: NotebookContentsTree, bookmark: str) -> NotebookContentsNode | None:
    for node in contents:
        if node["name"] == bookmark:
            return node
        child_match = _find_node(node.get("children", []), bookmark)
        if child_match is not None:
            return child_match
    return None


def _rename_node(contents: NotebookContentsTree, bookmark: str, new_name: str) -> bool:
    node = _find_node(contents, bookmark)
    if node is None:
        return False
    node["name"] = new_name
    return True


def _remove_node(contents: NotebookContentsTree, bookmark: str) -> bool:
    for index, node in enumerate(contents):
        if node["name"] == bookmark:
            del contents[index]
            return True
        if _remove_node(node.get("children", []), bookmark):
            return True
    return False


def _clear_note_flags(contents: NotebookContentsTree, bookmark: str, note: str) -> bool:
    node = _find_node(contents, bookmark)
    if node is None or "notes" not in node:
        return False
    note_flags = dict(node["notes"])
    if note not in note_flags:
        return False
    note_flags.pop(note)
    if note_flags:
        node["notes"] = note_flags
    else:
        node.pop("notes", None)
    return True


def _move_note_flags(
    contents: NotebookContentsTree,
    source_bookmark: str,
    target_bookmark: str,
    note: str,
) -> bool:
    if source_bookmark == target_bookmark:
        return False
    source_node = _find_node(contents, source_bookmark)
    if source_node is None or "notes" not in source_node:
        return False
    source_note_flags = dict(source_node["notes"])
    note_flags = source_note_flags.pop(note, None)
    if note_flags is None:
        return False
    if source_note_flags:
        source_node["notes"] = source_note_flags
    else:
        source_node.pop("notes", None)
    target_node = _find_node(contents, target_bookmark)
    if target_node is None:
        target_node = {"name": target_bookmark}
        contents.append(target_node)
    target_note_flags = dict(target_node.get("notes", {}))
    target_note_flags[note] = note_flags
    target_node["notes"] = target_note_flags
    return True


def _bookmark_path(root: Path, bookmark: str) -> Path:
    return (root / bookmark).resolve(strict=False)


def _require_bookmark(root: Path, bookmark: str) -> tuple[str, Path]:
    bookmark_name = _validate_name(root, bookmark, BOOKMARK_KIND)
    bookmark_path = _bookmark_path(root, bookmark_name)
    if not bookmark_path.exists() or not bookmark_path.is_dir():
        raise NotebookBookmarkNotFoundError(f"Bookmark not found: {bookmark_name}")
    return bookmark_name, bookmark_path


def _note_path(root: Path, bookmark_path: Path, note: str) -> Path:
    note_name = _validate_name(root, note, NOTE_KIND)
    note_path = (bookmark_path / note_name).resolve(strict=False)
    _assert_inside_root(root, note_path, NOTE_KIND)
    return note_path


def _require_note(root: Path, bookmark_path: Path, note: str) -> tuple[str, Path]:
    note_name = _validate_name(root, note, NOTE_KIND)
    note_path = _note_path(root, bookmark_path, note_name)
    if not note_path.exists() or not note_path.is_file():
        raise NotebookNoteNotFoundError(f"Note not found: {note_name}")
    return note_name, note_path


def _validate_name(root: Path, value: str, kind: str) -> str:
    name = value.strip()
    if not name:
        raise NotebookPathValidationError(f"{kind} name must not be empty.")
    if name in {".", ".."}:
        raise NotebookPathValidationError(f"{kind} name must not be . or ..")
    if Path(name).is_absolute():
        raise NotebookPathValidationError(f"{kind} name must be relative.")
    if "/" in name or "\\" in name:
        raise NotebookPathValidationError(f"{kind} name must not contain path separators.")
    _assert_inside_root(root, (root / name).resolve(strict=False), kind)
    return name


def _assert_inside_root(root: Path, path: Path, kind: str) -> None:
    root_resolved = root.resolve(strict=False)
    try:
        path.relative_to(root_resolved)
    except ValueError as exc:
        raise NotebookPathValidationError(
            f"{kind} path resolves outside the notebook root."
        ) from exc
    if path == root_resolved:
        raise NotebookPathValidationError(f"{kind} path must stay inside the notebook root.")


def _generate_note_name(bookmark_path: Path) -> str:
    base_name = _current_note_base_name()
    note_name = base_name
    suffix = 0
    while (bookmark_path / note_name).exists():
        suffix += 1
        note_name = f"{base_name}-{suffix}"
    return note_name


def _current_note_base_name() -> str:
    return datetime.now().strftime(GENERATED_NOTE_NAME_FORMAT)


def _preview_lines(text: str) -> list[str]:
    return text.splitlines()[:PREVIEW_LINE_LIMIT]


def _read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return ""


def _write_contents_atomically(root: Path, contents: NotebookContentsTree) -> None:
    body = json.dumps(contents, ensure_ascii=False, indent=2) + "\n"
    _write_text_atomically(root / CONTENTS_FILE_NAME, body)


def _write_text_atomically(path: Path, body: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_file = tempfile.NamedTemporaryFile(
        mode="w",
        dir=path.parent,
        encoding="utf-8",
        delete=False,
        prefix=TEMP_FILE_PREFIX,
    )
    temp_path = Path(temp_file.name)
    try:
        with temp_file:
            temp_file.write(body)
            temp_file.flush()
        os.replace(temp_path, path)
    except Exception:
        if temp_path.exists():
            temp_path.unlink()
        raise
