"""Filesystem-backed saved requests and credentials store."""

from __future__ import annotations

import json
import os
import shutil
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, TypedDict
from uuid import NAMESPACE_URL, uuid4, uuid5

from pydantic import ValidationError

from app.core.config import Settings
from app.schemas import (
    ApiKeyPermanentCredentialCreate,
    ApiKeyPermanentCredentialPublic,
    ApiKeyPermanentCredentialPublicConfig,
    ApiKeyPermanentCredentialUpdate,
    BearerCredentialCreate,
    BearerCredentialPublic,
    BearerCredentialPublicConfig,
    BearerCredentialUpdate,
    ClientAdminCredentialCreate,
    ClientAdminCredentialPublic,
    ClientAdminCredentialPublicConfig,
    ClientAdminCredentialUpdate,
    EnvironmentColumn,
    EnvironmentsStateResponse,
    EnvironmentVariableRow,
    LoginPasswordCredentialCreate,
    LoginPasswordCredentialPublic,
    LoginPasswordCredentialPublicConfig,
    LoginPasswordCredentialUpdate,
    RequestDocument,
    RequestDocumentInput,
    RequestItemReadResponse,
    RequestItemSummary,
    RequestsFolderNode,
    RequestsItemsResponse,
    RequestsTreeResponse,
    VariableCreateRequest,
    VariableUpdateRequest,
)

type RequestsFlags = dict[str, object]
CONTENTS_FILE_NAME = "__contents__"
GENERATED_ITEM_NAME_FORMAT = "%Y-%m-%d-%H-%M-%S"
TEMP_FILE_PREFIX = ".requests-"
FOLDER_KIND = "Folder"
ITEM_KIND = "Item"
VARIABLE_ROW_ID_NAMESPACE = uuid5(NAMESPACE_URL, "qaa-tms/requests/variable")

type CredentialCreateModel = (
    BearerCredentialCreate
    | ApiKeyPermanentCredentialCreate
    | LoginPasswordCredentialCreate
    | ClientAdminCredentialCreate
)
type CredentialUpdateModel = (
    BearerCredentialUpdate
    | ApiKeyPermanentCredentialUpdate
    | LoginPasswordCredentialUpdate
    | ClientAdminCredentialUpdate
)
type CredentialPublicModel = (
    BearerCredentialPublic
    | ApiKeyPermanentCredentialPublic
    | LoginPasswordCredentialPublic
    | ClientAdminCredentialPublic
)
type VariableCreateModel = VariableCreateRequest
type VariableUpdateModel = VariableUpdateRequest


class RequestsEnvironmentsState(TypedDict):
    active_id: str | None
    environments: list[dict[str, Any]]
    variables: list[dict[str, Any]]


class RequestsContentsNode(TypedDict, total=False):
    name: str
    children: list[RequestsContentsNode]
    flags: RequestsFlags
    items: dict[str, RequestsFlags]


type RequestsContentsTree = list[RequestsContentsNode]


class RequestsRootMissingError(RuntimeError):
    pass


class RequestsPathValidationError(ValueError):
    pass


class RequestsFolderNotFoundError(FileNotFoundError):
    pass


class RequestsItemNotFoundError(FileNotFoundError):
    pass


class RequestsCredentialNotFoundError(FileNotFoundError):
    pass


class RequestsCredentialValidationError(ValueError):
    pass


class RequestsEnvironmentNotFoundError(FileNotFoundError):
    pass


class RequestsEnvironmentValidationError(ValueError):
    pass


class RequestsVariableNotFoundError(FileNotFoundError):
    pass


class RequestsVariableValidationError(ValueError):
    pass


class RequestsConflictError(RuntimeError):
    pass


def read_contents(settings: Settings) -> RequestsContentsTree:
    root = _resolve_root(settings)
    return _read_contents_from_root(root)


def list_tree(settings: Settings) -> RequestsTreeResponse:
    if not Path(settings.requests_collections_root).expanduser().exists():
        # A store that has never been written to is empty, not broken: return an
        # empty tree so the UI can render (and offer folder/preset creation, which
        # lazily creates the root) instead of surfacing a hard error.
        return RequestsTreeResponse(folders=[])
    root = _resolve_root(settings)
    contents = _read_contents_from_root(root)
    existing = _existing_folder_paths(root)
    seen_names: set[str] = set()
    folders = _build_folder_tree(contents, existing, seen_names)
    for name, path in existing.items():
        if name in seen_names:
            continue
        folders.append(
            RequestsFolderNode(name=name, item_count=_count_items(path), flags={}, children=[])
        )
    return RequestsTreeResponse(folders=folders)


def write_tree(settings: Settings, tree: object) -> None:
    root = _resolve_root(settings, create=True)
    _write_contents_atomically(root, _normalize_contents_tree(tree, root))


def reorder(settings: Settings, names: list[str]) -> None:
    root = _resolve_root(settings)
    contents = _read_contents_from_root(root)
    by_name: dict[str, RequestsContentsNode] = {}
    for node in contents:
        by_name[node["name"]] = node
    reordered: RequestsContentsTree = []
    for name in names:
        if name in by_name:
            reordered.append(by_name.pop(name))
    for node in contents:
        if node["name"] in by_name:
            reordered.append(node)
            del by_name[node["name"]]
    _write_contents_atomically(root, reordered)


def create_folder(settings: Settings, name: str) -> None:
    root = _resolve_root(settings, create=True)
    folder_name = _validate_name(root, name, FOLDER_KIND)
    folder_path = _folder_path(root, folder_name)
    if folder_path.exists():
        raise RequestsConflictError(f"Folder already exists: {folder_name}")
    folder_path.mkdir()
    contents = _read_contents_from_root(root)
    if _find_node(contents, folder_name) is None:
        contents.append({"name": folder_name})
    _write_contents_atomically(root, contents)


def rename_folder(settings: Settings, folder: str, new_name: str) -> None:
    root = _resolve_root(settings)
    folder_name, folder_path = _require_folder(root, folder)
    target_name = _validate_name(root, new_name, FOLDER_KIND)
    target_path = _folder_path(root, target_name)
    if folder_name != target_name and target_path.exists():
        raise RequestsConflictError(f"Folder already exists: {target_name}")
    if folder_name != target_name:
        folder_path.rename(target_path)
    contents = _read_contents_from_root(root)
    changed = _rename_node(contents, folder_name, target_name)
    if not changed and folder_name != target_name and _find_node(contents, target_name) is None:
        contents.append({"name": target_name})
        changed = True
    if changed:
        _write_contents_atomically(root, contents)


def delete_folder(settings: Settings, folder: str) -> None:
    root = _resolve_root(settings)
    folder_name, folder_path = _require_folder(root, folder)
    shutil.rmtree(folder_path)
    contents = _read_contents_from_root(root)
    if _remove_node(contents, folder_name):
        _write_contents_atomically(root, contents)


def set_folder_flags(settings: Settings, folder: str, flags: dict[str, object]) -> None:
    root = _resolve_root(settings)
    folder_name, _ = _require_folder(root, folder)
    contents = _read_contents_from_root(root)
    normalized_flags = _normalize_flags(flags)
    node = _find_node(contents, folder_name)
    if node is None:
        if not normalized_flags:
            return
        node = {"name": folder_name}
        contents.append(node)
    if normalized_flags:
        node["flags"] = normalized_flags
    else:
        node.pop("flags", None)
    _write_contents_atomically(root, contents)


def list_items(settings: Settings, folder: str) -> RequestsItemsResponse:
    root = _resolve_root(settings)
    folder_name, folder_path = _require_folder(root, folder)
    items: list[RequestItemSummary] = []
    for item_path in _item_paths(folder_path):
        document = _read_request_document(item_path)
        if document is None:
            continue
        items.append(
            RequestItemSummary(
                name=item_path.name,
                method=document.method,
                url=document.url,
                credential_id=document.credential_id,
                created_at=document.created_at,
                updated_at=document.updated_at,
            )
        )
    return RequestsItemsResponse(folder=folder_name, items=items)


def read_item(settings: Settings, folder: str, name: str) -> RequestItemReadResponse:
    root = _resolve_root(settings)
    folder_name, folder_path = _require_folder(root, folder)
    item_name, item_path = _require_item(root, folder_path, name)
    document = _read_request_document(item_path)
    if document is None:
        raise RequestsItemNotFoundError(f"Item not found: {item_name}")
    return RequestItemReadResponse(
        folder=folder_name, name=item_name, **document.model_dump(mode="python")
    )


def write_item(
    settings: Settings, folder: str, name: str | None, document: RequestDocumentInput
) -> RequestItemReadResponse:
    root = _resolve_root(settings, create=True)
    folder_name, folder_path = _require_folder(root, folder)
    item_name = (
        _generate_item_name(folder_path) if name is None else _validate_name(root, name, ITEM_KIND)
    )
    item_path = _item_path(root, folder_path, item_name)
    if item_path.exists():
        raise RequestsConflictError(f"Item already exists: {item_name}")
    now = _now_iso()
    stored = RequestDocument(
        method=document.method,
        url=document.url,
        headers=[header.model_copy(deep=True) for header in document.headers],
        query_params=[param.model_copy(deep=True) for param in document.query_params],
        body=document.body.model_copy(deep=True),
        credential_id=document.credential_id,
        created_at=now,
        updated_at=now,
    )
    _write_request_document(item_path, stored)
    return RequestItemReadResponse(
        folder=folder_name, name=item_name, **stored.model_dump(mode="python")
    )


def update_item(
    settings: Settings, folder: str, name: str, document: RequestDocumentInput
) -> RequestItemReadResponse:
    root = _resolve_root(settings)
    folder_name, folder_path = _require_folder(root, folder)
    item_name, item_path = _require_item(root, folder_path, name)
    current = _read_request_document(item_path)
    if current is None:
        raise RequestsItemNotFoundError(f"Item not found: {item_name}")
    stored = RequestDocument(
        method=document.method,
        url=document.url,
        headers=[header.model_copy(deep=True) for header in document.headers],
        query_params=[param.model_copy(deep=True) for param in document.query_params],
        body=document.body.model_copy(deep=True),
        credential_id=document.credential_id,
        created_at=current.created_at,
        updated_at=_now_iso(),
    )
    _write_request_document(item_path, stored)
    return RequestItemReadResponse(
        folder=folder_name, name=item_name, **stored.model_dump(mode="python")
    )


def delete_item(settings: Settings, folder: str, name: str) -> None:
    root = _resolve_root(settings)
    folder_name, folder_path = _require_folder(root, folder)
    item_name, item_path = _require_item(root, folder_path, name)
    item_path.unlink()
    contents = _read_contents_from_root(root)
    if _clear_item_flags(contents, folder_name, item_name):
        _write_contents_atomically(root, contents)


def move_item(settings: Settings, source_folder: str, target_folder: str, name: str) -> None:
    root = _resolve_root(settings)
    source_folder_name, source_folder_path = _require_folder(root, source_folder)
    target_folder_name, target_folder_path = _require_folder(root, target_folder)
    item_name, source_item_path = _require_item(root, source_folder_path, name)
    if source_folder_name == target_folder_name:
        return
    target_item_path = _item_path(root, target_folder_path, item_name)
    if target_item_path.exists():
        raise RequestsConflictError(
            f"Item already exists in folder {target_folder_name}: {item_name}"
        )
    source_item_path.rename(target_item_path)
    contents = _read_contents_from_root(root)
    if _move_item_flags(contents, source_folder_name, target_folder_name, item_name):
        _write_contents_atomically(root, contents)


def list_credentials(settings: Settings) -> list[CredentialPublicModel]:
    credentials: list[CredentialPublicModel] = []
    for credential in _load_credentials(settings):
        try:
            credentials.append(_credential_to_public(credential))
        except RequestsCredentialValidationError:
            continue
    return credentials


def read_credential(settings: Settings, credential_id: str) -> CredentialPublicModel:
    credential = get_credential_raw(settings, credential_id)
    return _credential_to_public(credential)


def create_credential(
    settings: Settings, credential: CredentialCreateModel
) -> CredentialPublicModel:
    credentials = _load_credentials(settings)
    now = _now_iso()
    entry = _credential_create_to_raw(credential, now)
    credentials.append(entry)
    _save_credentials(settings, credentials)
    return _credential_to_public(entry)


def update_credential(
    settings: Settings,
    credential_id: str,
    credential: CredentialUpdateModel,
) -> CredentialPublicModel:
    credentials = _load_credentials(settings)
    for index, existing in enumerate(credentials):
        try:
            normalized = _normalize_raw_credential(existing)
        except RequestsCredentialValidationError:
            continue
        if normalized["id"] != credential_id:
            continue
        updated = _apply_credential_update(normalized, credential)
        credentials[index] = updated
        _save_credentials(settings, credentials)
        return _credential_to_public(updated)
    raise RequestsCredentialNotFoundError(f"Credential not found: {credential_id}")


def delete_credential(settings: Settings, credential_id: str) -> None:
    credentials = _load_credentials(settings)
    kept = [credential for credential in credentials if credential.get("id") != credential_id]
    if len(kept) == len(credentials):
        raise RequestsCredentialNotFoundError(f"Credential not found: {credential_id}")
    _save_credentials(settings, kept)


def get_credential_raw(settings: Settings, credential_id: str) -> dict[str, Any]:
    for credential in _load_credentials(settings):
        try:
            normalized = _normalize_raw_credential(credential)
        except RequestsCredentialValidationError:
            continue
        if normalized["id"] == credential_id:
            return normalized
    raise RequestsCredentialNotFoundError(f"Credential not found: {credential_id}")


def list_state(settings: Settings) -> EnvironmentsStateResponse:
    return _environment_state_to_response(_load_environments_state(settings))


def list_environments(settings: Settings) -> EnvironmentsStateResponse:
    return list_state(settings)



def resolve_variable_map(settings: Settings, environment_id: str | None) -> dict[str, str]:
    state = _load_environments_state(settings)
    resolved_environment_id = _resolve_environment_id(state, environment_id)
    if resolved_environment_id is None:
        return {}

    values: dict[str, str] = {}
    valid_environment_ids = _environment_ids_from_state(state)
    for raw_variable in state["variables"]:
        try:
            variable = _normalize_raw_variable_row(raw_variable, valid_environment_ids)
        except RequestsVariableValidationError:
            continue
        if not variable["enabled"]:
            continue
        value = variable["values"].get(resolved_environment_id)
        if isinstance(value, str) and value != "":
            values[variable["key"]] = value
    return values


def create_environment(settings: Settings, name: str) -> EnvironmentsStateResponse:
    state = _load_environments_state(settings)
    state["environments"].append(_environment_create_to_raw(name, _now_iso()))
    _save_environments_state(settings, state)
    return _environment_state_to_response(state)


def update_environment(
    settings: Settings,
    environment_id: str,
    name: str,
) -> EnvironmentsStateResponse:
    state = _load_environments_state(settings)
    for index, existing in enumerate(state["environments"]):
        try:
            normalized = _normalize_raw_environment_column(existing)
        except RequestsEnvironmentValidationError:
            continue
        if normalized["id"] != environment_id:
            continue
        state["environments"][index] = _apply_environment_update(normalized, name)
        _save_environments_state(settings, state)
        return _environment_state_to_response(state)
    raise RequestsEnvironmentNotFoundError(f"Environment not found: {environment_id}")


def delete_environment(settings: Settings, environment_id: str) -> EnvironmentsStateResponse:
    state = _load_environments_state(settings)
    kept: list[dict[str, Any]] = []
    found = False
    for environment in state["environments"]:
        if _normalize_raw_environment_id(environment) == environment_id:
            found = True
            continue
        kept.append(environment)
    if not found:
        raise RequestsEnvironmentNotFoundError(f"Environment not found: {environment_id}")
    state["environments"] = kept
    state["variables"] = _drop_environment_from_variables(
        state["variables"],
        environment_id,
        _now_iso(),
    )
    if state["active_id"] == environment_id:
        state["active_id"] = None
    _save_environments_state(settings, state)
    return _environment_state_to_response(state)


def set_active_environment(
    settings: Settings, environment_id: str | None
) -> EnvironmentsStateResponse:
    state = _load_environments_state(settings)
    if environment_id is not None and not _environment_exists(
        state["environments"], environment_id
    ):
        raise RequestsEnvironmentNotFoundError(f"Environment not found: {environment_id}")
    state["active_id"] = environment_id
    _save_environments_state(settings, state)
    return _environment_state_to_response(state)


def create_variable(
    settings: Settings,
    variable: VariableCreateModel,
) -> EnvironmentsStateResponse:
    state = _load_environments_state(settings)
    state["variables"].append(
        _variable_create_to_raw(
            variable,
            _environment_ids_from_state(state),
            state["variables"],
            _now_iso(),
        )
    )
    _save_environments_state(settings, state)
    return _environment_state_to_response(state)


def update_variable(
    settings: Settings,
    variable_id: str,
    variable: VariableUpdateModel,
) -> EnvironmentsStateResponse:
    state = _load_environments_state(settings)
    for index, existing in enumerate(state["variables"]):
        try:
            normalized = _normalize_raw_variable_row(
                existing,
                _environment_ids_from_state(state),
            )
        except RequestsVariableValidationError:
            continue
        if normalized["id"] != variable_id:
            continue
        state["variables"][index] = _apply_variable_update(
            normalized,
            variable,
            _environment_ids_from_state(state),
            [row for row in state["variables"] if _normalize_raw_variable_id(row) != variable_id],
        )
        _save_environments_state(settings, state)
        return _environment_state_to_response(state)
    raise RequestsVariableNotFoundError(f"Variable not found: {variable_id}")


def delete_variable(settings: Settings, variable_id: str) -> EnvironmentsStateResponse:
    state = _load_environments_state(settings)
    kept = [
        variable
        for variable in state["variables"]
        if _normalize_raw_variable_id(variable) != variable_id
    ]
    if len(kept) == len(state["variables"]):
        raise RequestsVariableNotFoundError(f"Variable not found: {variable_id}")
    state["variables"] = kept
    _save_environments_state(settings, state)
    return _environment_state_to_response(state)


def _resolve_root(settings: Settings, create: bool = False) -> Path:
    root = Path(settings.requests_collections_root).expanduser()
    if root.exists():
        if not root.is_dir():
            raise RequestsRootMissingError(f"The requests root is not a directory: {root}")
        return root.resolve()
    if not create:
        raise RequestsRootMissingError(f"The requests root does not exist: {root}")
    root.mkdir(parents=True, exist_ok=True)
    return root.resolve()


def _read_contents_from_root(root: Path) -> RequestsContentsTree:
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


def _normalize_contents_tree(payload: object, root: Path) -> RequestsContentsTree:
    if isinstance(payload, list):
        raw_nodes = payload
    elif isinstance(payload, dict):
        raw_nodes = payload.get("folders", [])
    else:
        return []
    return _normalize_contents_nodes(raw_nodes, root, set())


def _normalize_contents_nodes(
    raw_nodes: object,
    root: Path,
    seen_names: set[str],
) -> RequestsContentsTree:
    if not isinstance(raw_nodes, list):
        return []
    nodes: RequestsContentsTree = []
    for raw_node in raw_nodes:
        if not isinstance(raw_node, dict):
            continue
        raw_name = raw_node.get("name")
        if not isinstance(raw_name, str):
            continue
        try:
            name = _validate_name(root, raw_name, FOLDER_KIND)
        except RequestsPathValidationError:
            continue
        if name in seen_names:
            continue
        seen_names.add(name)
        node: RequestsContentsNode = {"name": name}
        children = _normalize_contents_nodes(raw_node.get("children"), root, seen_names)
        flags = _normalize_flags(raw_node.get("flags"))
        items = _normalize_item_flags(raw_node.get("items"), root)
        if children:
            node["children"] = children
        if flags:
            node["flags"] = flags
        if items:
            node["items"] = items
        nodes.append(node)
    return nodes


def _normalize_item_flags(raw_items: object, root: Path) -> dict[str, RequestsFlags]:
    if not isinstance(raw_items, dict):
        return {}
    items: dict[str, RequestsFlags] = {}
    for raw_name, raw_flags in raw_items.items():
        if not isinstance(raw_name, str):
            continue
        try:
            name = _validate_name(root, raw_name, ITEM_KIND)
        except RequestsPathValidationError:
            continue
        flags = _normalize_flags(raw_flags)
        if flags:
            items[name] = flags
    return items


def _normalize_flags(raw_flags: object) -> RequestsFlags:
    if not isinstance(raw_flags, dict):
        return {}
    return {key: value for key, value in raw_flags.items() if isinstance(key, str)}


def _existing_folder_paths(root: Path) -> dict[str, Path]:
    folders: dict[str, Path] = {}
    for path in sorted(root.iterdir(), key=lambda item: item.name):
        if path.name == CONTENTS_FILE_NAME or not path.is_dir():
            continue
        try:
            name = _validate_name(root, path.name, FOLDER_KIND)
        except RequestsPathValidationError:
            continue
        folders[name] = path.resolve()
    return folders


def _build_folder_tree(
    contents: RequestsContentsTree,
    existing: dict[str, Path],
    seen_names: set[str],
) -> list[RequestsFolderNode]:
    folders: list[RequestsFolderNode] = []
    for node in contents:
        name = node["name"]
        if name not in existing or name in seen_names:
            continue
        seen_names.add(name)
        folders.append(
            RequestsFolderNode(
                name=name,
                item_count=_count_items(existing[name]),
                flags=dict(node.get("flags", {})),
                children=_build_folder_tree(node.get("children", []), existing, seen_names),
            )
        )
    return folders


def _find_node(contents: RequestsContentsTree, folder: str) -> RequestsContentsNode | None:
    for node in contents:
        if node["name"] == folder:
            return node
        child_match = _find_node(node.get("children", []), folder)
        if child_match is not None:
            return child_match
    return None


def _rename_node(contents: RequestsContentsTree, folder: str, new_name: str) -> bool:
    node = _find_node(contents, folder)
    if node is None:
        return False
    node["name"] = new_name
    return True


def _remove_node(contents: RequestsContentsTree, folder: str) -> bool:
    for index, node in enumerate(contents):
        if node["name"] == folder:
            del contents[index]
            return True
        if _remove_node(node.get("children", []), folder):
            return True
    return False


def _clear_item_flags(contents: RequestsContentsTree, folder: str, item: str) -> bool:
    node = _find_node(contents, folder)
    if node is None:
        return False
    item_flags = dict(node.get("items", {}))
    if item not in item_flags:
        return False
    item_flags.pop(item)
    if item_flags:
        node["items"] = item_flags
    else:
        node.pop("items", None)
    return True


def _move_item_flags(
    contents: RequestsContentsTree,
    source_folder: str,
    target_folder: str,
    item: str,
) -> bool:
    source_node = _find_node(contents, source_folder)
    if source_node is None:
        return False
    source_item_flags = dict(source_node.get("items", {}))
    item_flags = source_item_flags.get(item)
    if item_flags is None:
        return False
    source_item_flags.pop(item)
    if source_item_flags:
        source_node["items"] = source_item_flags
    else:
        source_node.pop("items", None)
    target_node = _find_node(contents, target_folder)
    if target_node is None:
        target_node = {"name": target_folder}
        contents.append(target_node)
    target_item_flags = dict(target_node.get("items", {}))
    target_item_flags[item] = item_flags
    target_node["items"] = target_item_flags
    return True


def _folder_path(root: Path, folder: str) -> Path:
    return (root / folder).resolve(strict=False)


def _require_folder(root: Path, folder: str) -> tuple[str, Path]:
    folder_name = _validate_name(root, folder, FOLDER_KIND)
    folder_path = _folder_path(root, folder_name)
    if not folder_path.exists() or not folder_path.is_dir():
        raise RequestsFolderNotFoundError(f"Folder not found: {folder_name}")
    return folder_name, folder_path


def _item_path(root: Path, folder_path: Path, item: str) -> Path:
    item_name = _validate_name(root, item, ITEM_KIND)
    item_path = (folder_path / item_name).resolve(strict=False)
    _assert_inside_root(root, item_path, ITEM_KIND)
    return item_path


def _require_item(root: Path, folder_path: Path, item: str) -> tuple[str, Path]:
    item_name = _validate_name(root, item, ITEM_KIND)
    item_path = _item_path(root, folder_path, item_name)
    if not item_path.exists() or not item_path.is_file():
        raise RequestsItemNotFoundError(f"Item not found: {item_name}")
    return item_name, item_path


def _validate_name(root: Path, value: str, kind: str) -> str:
    name = value.strip()
    if not name:
        raise RequestsPathValidationError(f"{kind} name must not be empty.")
    if name in {".", ".."}:
        raise RequestsPathValidationError(f"{kind} name must not be . or ..")
    if Path(name).is_absolute():
        raise RequestsPathValidationError(f"{kind} name must be relative.")
    if "/" in name or "\\" in name:
        raise RequestsPathValidationError(f"{kind} name must not contain path separators.")
    _assert_inside_root(root, (root / name).resolve(strict=False), kind)
    return name


def _assert_inside_root(root: Path, path: Path, kind: str) -> None:
    root_resolved = root.resolve(strict=False)
    try:
        path.relative_to(root_resolved)
    except ValueError as exc:
        raise RequestsPathValidationError(
            f"{kind} path resolves outside the requests root."
        ) from exc
    if path == root_resolved:
        raise RequestsPathValidationError(f"{kind} path must stay inside the requests root.")


def _generate_item_name(folder_path: Path) -> str:
    base_name = _current_item_base_name()
    item_name = base_name
    suffix = 0
    while (folder_path / item_name).exists():
        suffix += 1
        item_name = f"{base_name}-{suffix}"
    return item_name


def _current_item_base_name() -> str:
    return datetime.now().strftime(GENERATED_ITEM_NAME_FORMAT)


def _count_items(folder_path: Path) -> int:
    return sum(1 for path in folder_path.iterdir() if path.is_file())


def _item_paths(folder_path: Path) -> list[Path]:
    return sorted((path for path in folder_path.iterdir() if path.is_file()), reverse=True)


def _read_request_document(path: Path) -> RequestDocument | None:
    try:
        payload = json.loads(_read_text(path))
    except json.JSONDecodeError:
        return None
    try:
        return RequestDocument.model_validate(payload)
    except ValidationError:
        return None


def _write_request_document(path: Path, document: RequestDocument) -> None:
    body = json.dumps(document.model_dump(mode="json"), ensure_ascii=False, indent=2) + "\n"
    _write_text_atomically(path, body)


def _read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return ""


def _write_contents_atomically(root: Path, contents: RequestsContentsTree) -> None:
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


def _load_credentials(settings: Settings) -> list[dict[str, Any]]:
    path = Path(settings.requests_credentials_path).expanduser()
    if not path.exists():
        return []
    text = _read_text(path)
    if not text.strip():
        return []
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        return []
    if not isinstance(payload, dict):
        return []
    raw_credentials = payload.get("credentials")
    if not isinstance(raw_credentials, list):
        return []
    return [credential for credential in raw_credentials if isinstance(credential, dict)]


def _save_credentials(settings: Settings, credentials: list[dict[str, Any]]) -> None:
    path = Path(settings.requests_credentials_path).expanduser()
    body = json.dumps({"credentials": credentials}, ensure_ascii=False, indent=2) + "\n"
    _write_text_atomically(path, body)
    os.chmod(path, 0o600)


def _load_environments_state(settings: Settings) -> RequestsEnvironmentsState:
    path = Path(settings.requests_environments_path).expanduser()
    empty_state: RequestsEnvironmentsState = {
        "active_id": None,
        "environments": [],
        "variables": [],
    }
    if not path.exists():
        return empty_state
    text = _read_text(path)
    if not text.strip():
        return empty_state
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        return empty_state
    if not isinstance(payload, dict):
        return empty_state

    raw_environments = payload.get("environments")
    if not isinstance(raw_environments, list):
        raw_environments = []
    if any(
        isinstance(raw_environment, dict) and isinstance(raw_environment.get("variables"), list)
        for raw_environment in raw_environments
    ):
        return _migrate_legacy_environments_state(payload)

    environments: list[dict[str, Any]] = []
    valid_ids: set[str] = set()
    for raw_environment in raw_environments:
        if not isinstance(raw_environment, dict):
            continue
        try:
            normalized = _normalize_raw_environment_column(raw_environment)
        except RequestsEnvironmentValidationError:
            continue
        environments.append(normalized)
        valid_ids.add(normalized["id"])

    raw_variables = payload.get("variables")
    if not isinstance(raw_variables, list):
        raw_variables = []

    variables: list[dict[str, Any]] = []
    for raw_variable in raw_variables:
        if not isinstance(raw_variable, dict):
            continue
        try:
            normalized = _normalize_raw_variable_row(raw_variable, valid_ids)
        except RequestsVariableValidationError:
            continue
        variables.append(normalized)

    active_id = _as_str(payload.get("activeId")) or _as_str(payload.get("active_id"))
    if active_id not in valid_ids:
        active_id = None

    return {
        "active_id": active_id,
        "environments": environments,
        "variables": _dedupe_variable_rows(variables),
    }


def _migrate_legacy_environments_state(payload: dict[str, Any]) -> RequestsEnvironmentsState:
    raw_environments = payload.get("environments")
    if not isinstance(raw_environments, list):
        raw_environments = []

    environments: list[dict[str, Any]] = []
    rows_by_key: dict[str, dict[str, Any]] = {}
    valid_ids: set[str] = set()
    for raw_environment in raw_environments:
        if not isinstance(raw_environment, dict):
            continue
        try:
            normalized = _normalize_raw_environment(raw_environment)
        except RequestsEnvironmentValidationError:
            continue
        environments.append(
            {
                "id": normalized["id"],
                "name": normalized["name"],
                "created_at": normalized["created_at"],
                "updated_at": normalized["updated_at"],
            }
        )
        valid_ids.add(normalized["id"])
        for variable in normalized["variables"]:
            row = rows_by_key.get(variable["key"])
            if row is None:
                row = {
                    "id": str(uuid5(VARIABLE_ROW_ID_NAMESPACE, variable["key"])),
                    "key": variable["key"],
                    "secret": False,
                    "enabled": variable["enabled"],
                    "values": {},
                    "created_at": normalized["created_at"],
                    "updated_at": normalized["updated_at"],
                }
                rows_by_key[variable["key"]] = row
            else:
                if normalized["created_at"] < row["created_at"]:
                    row["created_at"] = normalized["created_at"]
                if normalized["updated_at"] > row["updated_at"]:
                    row["updated_at"] = normalized["updated_at"]
            # Legacy per-environment enabled flags collapse into one row flag.
            row["enabled"] = row["enabled"] or variable["enabled"]
            if variable["value"] != "":
                row["values"][normalized["id"]] = variable["value"]

    active_id = _as_str(payload.get("activeId")) or _as_str(payload.get("active_id"))
    if active_id not in valid_ids:
        active_id = None

    return {
        "active_id": active_id,
        "environments": environments,
        "variables": _dedupe_variable_rows(list(rows_by_key.values())),
    }


def _save_environments_state(settings: Settings, state: RequestsEnvironmentsState) -> None:
    path = Path(settings.requests_environments_path).expanduser()
    body = (
        json.dumps(
            {
                "activeId": state["active_id"],
                "environments": [
                    _environment_to_storage(environment) for environment in state["environments"]
                ],
                "variables": [_variable_to_storage(variable) for variable in state["variables"]],
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n"
    )
    _write_text_atomically(path, body)
    os.chmod(path, 0o600)


def _credential_create_to_raw(credential: CredentialCreateModel, now: str) -> dict[str, Any]:
    if isinstance(credential, BearerCredentialCreate):
        config: dict[str, Any] = {
            "token": _require_non_empty(credential.config.token, "Credential token")
        }
    elif isinstance(credential, ApiKeyPermanentCredentialCreate):
        config = {
            "permanent_token": _require_non_empty(
                credential.config.permanent_token, "Permanent token"
            ),
            "verify_url": _require_non_empty(credential.config.verify_url, "Verify URL"),
            "scheme": _require_non_empty(credential.config.scheme, "Authorization scheme"),
        }
    elif isinstance(credential, LoginPasswordCredentialCreate):
        config = {
            "login_url": _require_non_empty(credential.config.login_url, "Login URL"),
            "username": _require_non_empty(credential.config.username, "Username"),
            "password": _require_non_empty(credential.config.password, "Password"),
            "referer": _require_non_empty(credential.config.referer, "Referer"),
        }
    elif isinstance(credential, ClientAdminCredentialCreate):
        config = {
            "admin_credential_id": _require_non_empty(
                credential.config.admin_credential_id, "Admin credential ID"
            ),
            "admin_token_url": _require_non_empty(
                credential.config.admin_token_url, "Admin token URL"
            ),
            "client_id": credential.config.client_id,
            "issue_by_current_user": credential.config.issue_by_current_user,
        }
    else:
        raise RequestsCredentialValidationError("Unsupported credential type.")
    return {
        "id": str(uuid4()),
        "name": _require_non_empty(credential.name, "Credential name"),
        "type": credential.type,
        "created_at": now,
        "updated_at": now,
        "config": config,
    }


def _environment_state_to_response(state: RequestsEnvironmentsState) -> EnvironmentsStateResponse:
    return EnvironmentsStateResponse(
        active_id=state["active_id"],
        environments=[_environment_to_public(environment) for environment in state["environments"]],
        variables=[_variable_to_public(variable) for variable in state["variables"]],
    )


def _environment_create_to_raw(name: str, now: str) -> dict[str, Any]:
    return {
        "id": str(uuid4()),
        "name": _require_non_empty_environment(name, "Environment name"),
        "created_at": now,
        "updated_at": now,
    }


def _apply_environment_update(existing: dict[str, Any], name: str) -> dict[str, Any]:
    updated = dict(existing)
    updated["name"] = _require_non_empty_environment(name, "Environment name")
    updated["updated_at"] = _now_iso()
    return _normalize_raw_environment_column(_environment_to_storage(updated))


def _environment_to_public(environment: dict[str, Any]) -> EnvironmentColumn:
    normalized = _normalize_raw_environment_column(environment)
    return EnvironmentColumn(
        id=normalized["id"],
        name=normalized["name"],
        created_at=normalized["created_at"],
        updated_at=normalized["updated_at"],
    )


def _environment_to_storage(environment: dict[str, Any]) -> dict[str, Any]:
    normalized = _normalize_raw_environment_column(environment)
    return {
        "id": normalized["id"],
        "name": normalized["name"],
        "createdAt": normalized["created_at"],
        "updatedAt": normalized["updated_at"],
    }


def _normalize_raw_environment_id(environment: object) -> str | None:
    if not isinstance(environment, dict):
        return None
    return _as_str(environment.get("id"))


def _normalize_raw_environment_column(environment: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": _require_non_empty_environment(_as_str(environment.get("id")), "Environment ID"),
        "name": _require_non_empty_environment(
            _as_str(environment.get("name")),
            "Environment name",
        ),
        "created_at": _require_non_empty_environment(
            _as_str(environment.get("createdAt")) or _as_str(environment.get("created_at")),
            "Environment createdAt",
        ),
        "updated_at": _require_non_empty_environment(
            _as_str(environment.get("updatedAt")) or _as_str(environment.get("updated_at")),
            "Environment updatedAt",
        ),
    }


def _normalize_raw_environment(environment: dict[str, Any]) -> dict[str, Any]:
    normalized = _normalize_raw_environment_column(environment)
    normalized["variables"] = _normalize_raw_environment_variables(environment.get("variables"))
    return normalized


def _normalize_raw_environment_variables(raw_variables: object) -> list[dict[str, Any]]:
    if not isinstance(raw_variables, list):
        return []

    rows: list[dict[str, Any]] = []
    for raw_variable in raw_variables:
        if not isinstance(raw_variable, dict):
            continue
        key = (_as_str(raw_variable.get("key")) or "").strip()
        value = raw_variable.get("value")
        enabled = raw_variable.get("enabled")
        if not key or not isinstance(value, str):
            continue
        rows.append(
            {
                "key": key,
                "value": value,
                "enabled": enabled if isinstance(enabled, bool) else True,
            }
        )
    return _dedupe_environment_variables(rows)


def _dedupe_environment_variables(variables: list[dict[str, Any]]) -> list[dict[str, Any]]:
    deduped: list[dict[str, Any]] = []
    seen_keys: set[str] = set()
    for variable in reversed(variables):
        key = variable["key"]
        if key in seen_keys:
            continue
        seen_keys.add(key)
        deduped.append(variable)
    deduped.reverse()
    return deduped


def _environment_ids_from_state(state: RequestsEnvironmentsState) -> set[str]:
    ids: set[str] = set()
    for environment in state["environments"]:
        environment_id = _normalize_raw_environment_id(environment)
        if environment_id is not None:
            ids.add(environment_id)
    return ids



def _resolve_environment_id(
    state: RequestsEnvironmentsState,
    environment_id: str | None,
) -> str | None:
    resolved_environment_id = environment_id if environment_id is not None else state["active_id"]
    if resolved_environment_id is None:
        return None
    if not _environment_exists(state["environments"], resolved_environment_id):
        return None
    return resolved_environment_id


def _environment_exists(environments: list[dict[str, Any]], environment_id: str) -> bool:
    for environment in environments:
        if _normalize_raw_environment_id(environment) == environment_id:
            return True
    return False


def _variable_create_to_raw(
    variable: VariableCreateModel,
    valid_environment_ids: set[str],
    existing_variables: list[dict[str, Any]],
    now: str,
) -> dict[str, Any]:
    key = _normalize_variable_key(variable.key)
    _assert_unique_variable_key(key, existing_variables)
    return {
        "id": str(uuid4()),
        "key": key,
        "secret": variable.secret,
        "enabled": variable.enabled,
        "values": _normalize_variable_values(variable.values, valid_environment_ids),
        "created_at": now,
        "updated_at": now,
    }


def _apply_variable_update(
    existing: dict[str, Any],
    variable: VariableUpdateModel,
    valid_environment_ids: set[str],
    other_variables: list[dict[str, Any]],
) -> dict[str, Any]:
    updated = dict(existing)
    if variable.key is not None:
        key = _normalize_variable_key(variable.key)
        _assert_unique_variable_key(key, other_variables)
        updated["key"] = key
    if variable.secret is not None:
        updated["secret"] = variable.secret
    if variable.enabled is not None:
        updated["enabled"] = variable.enabled
    if variable.values is not None:
        updated["values"] = _normalize_variable_values(variable.values, valid_environment_ids)
    updated["updated_at"] = _now_iso()
    return _normalize_raw_variable_row(_variable_to_storage(updated), valid_environment_ids)


def _drop_environment_from_variables(
    variables: list[dict[str, Any]],
    environment_id: str,
    now: str,
) -> list[dict[str, Any]]:
    updated_rows: list[dict[str, Any]] = []
    for variable in variables:
        try:
            normalized = _normalize_raw_variable_row(variable)
        except RequestsVariableValidationError:
            continue
        values = dict(normalized["values"])
        changed = values.pop(environment_id, None) is not None
        updated_rows.append(
            {
                **normalized,
                "values": values,
                "updated_at": now if changed else normalized["updated_at"],
            }
        )
    return updated_rows


def _variable_to_public(variable: dict[str, Any]) -> EnvironmentVariableRow:
    normalized = _normalize_raw_variable_row(variable)
    return EnvironmentVariableRow(
        id=normalized["id"],
        key=normalized["key"],
        secret=normalized["secret"],
        enabled=normalized["enabled"],
        values=dict(normalized["values"]),
        created_at=normalized["created_at"],
        updated_at=normalized["updated_at"],
    )


def _variable_to_storage(variable: dict[str, Any]) -> dict[str, Any]:
    normalized = _normalize_raw_variable_row(variable)
    return {
        "id": normalized["id"],
        "key": normalized["key"],
        "secret": normalized["secret"],
        "enabled": normalized["enabled"],
        "values": dict(normalized["values"]),
        "createdAt": normalized["created_at"],
        "updatedAt": normalized["updated_at"],
    }


def _normalize_raw_variable_id(variable: object) -> str | None:
    if not isinstance(variable, dict):
        return None
    return _as_str(variable.get("id"))


def _normalize_raw_variable_row(
    variable: dict[str, Any],
    valid_environment_ids: set[str] | None = None,
) -> dict[str, Any]:
    return {
        "id": _require_non_empty_variable(_as_str(variable.get("id")), "Variable ID"),
        "key": _normalize_variable_key(_as_str(variable.get("key"))),
        "secret": variable.get("secret") if isinstance(variable.get("secret"), bool) else False,
        "enabled": variable.get("enabled") if isinstance(variable.get("enabled"), bool) else True,
        "values": _normalize_variable_values(variable.get("values"), valid_environment_ids),
        "created_at": _require_non_empty_variable(
            _as_str(variable.get("createdAt")) or _as_str(variable.get("created_at")),
            "Variable createdAt",
        ),
        "updated_at": _require_non_empty_variable(
            _as_str(variable.get("updatedAt")) or _as_str(variable.get("updated_at")),
            "Variable updatedAt",
        ),
    }


def _normalize_variable_values(
    raw_values: object,
    valid_environment_ids: set[str] | None,
) -> dict[str, str]:
    if not isinstance(raw_values, dict):
        return {}
    values: dict[str, str] = {}
    for raw_environment_id, raw_value in raw_values.items():
        environment_id = _as_str(raw_environment_id)
        if environment_id is None:
            continue
        if valid_environment_ids is not None and environment_id not in valid_environment_ids:
            continue
        if not isinstance(raw_value, str) or raw_value == "":
            continue
        values[environment_id] = raw_value
    return values


def _normalize_variable_key(value: str | None) -> str:
    return _require_non_empty_variable(value, "Variable key")


def _assert_unique_variable_key(key: str, variables: list[dict[str, Any]]) -> None:
    for variable in variables:
        if not isinstance(variable, dict):
            continue
        existing_key = _as_str(variable.get("key"))
        if existing_key is None:
            continue
        if existing_key.strip() == key:
            raise RequestsConflictError(f"Variable already exists: {key}")


def _dedupe_variable_rows(variables: list[dict[str, Any]]) -> list[dict[str, Any]]:
    deduped: list[dict[str, Any]] = []
    seen_keys: set[str] = set()
    for variable in reversed(variables):
        key = variable["key"]
        if key in seen_keys:
            continue
        seen_keys.add(key)
        deduped.append(variable)
    deduped.reverse()
    return deduped


def _apply_credential_update(
    existing: dict[str, Any],
    credential: CredentialUpdateModel,
) -> dict[str, Any]:
    if existing["type"] != credential.type:
        raise RequestsCredentialValidationError("Credential type cannot change.")
    updated = dict(existing)
    updated_config = dict(existing["config"])
    if credential.name is not None:
        updated["name"] = _require_non_empty(credential.name, "Credential name")
    if isinstance(credential, BearerCredentialUpdate):
        if credential.config.token is not None:
            updated_config["token"] = credential.config.token
    elif isinstance(credential, ApiKeyPermanentCredentialUpdate):
        if credential.config.permanent_token is not None:
            updated_config["permanent_token"] = credential.config.permanent_token
        if credential.config.verify_url is not None:
            updated_config["verify_url"] = credential.config.verify_url
        if credential.config.scheme is not None:
            updated_config["scheme"] = credential.config.scheme
    elif isinstance(credential, LoginPasswordCredentialUpdate):
        if credential.config.login_url is not None:
            updated_config["login_url"] = credential.config.login_url
        if credential.config.username is not None:
            updated_config["username"] = credential.config.username
        if credential.config.password is not None:
            updated_config["password"] = credential.config.password
        if credential.config.referer is not None:
            updated_config["referer"] = credential.config.referer
    elif isinstance(credential, ClientAdminCredentialUpdate):
        if credential.config.admin_credential_id is not None:
            updated_config["admin_credential_id"] = credential.config.admin_credential_id
        if credential.config.admin_token_url is not None:
            updated_config["admin_token_url"] = credential.config.admin_token_url
        if credential.config.client_id is not None:
            updated_config["client_id"] = credential.config.client_id
        if credential.config.issue_by_current_user is not None:
            updated_config["issue_by_current_user"] = credential.config.issue_by_current_user
    else:
        raise RequestsCredentialValidationError("Unsupported credential type.")
    updated["config"] = updated_config
    updated["updated_at"] = _now_iso()
    return _normalize_raw_credential(updated)


def _credential_to_public(credential: dict[str, Any]) -> CredentialPublicModel:
    normalized = _normalize_raw_credential(credential)
    credential_type = normalized["type"]
    if credential_type == "bearer":
        return BearerCredentialPublic(
            id=normalized["id"],
            name=normalized["name"],
            type=credential_type,
            created_at=normalized["created_at"],
            updated_at=normalized["updated_at"],
            config=BearerCredentialPublicConfig(token=normalized["config"]["token"]),
        )
    if credential_type == "api_key_permanent":
        return ApiKeyPermanentCredentialPublic(
            id=normalized["id"],
            name=normalized["name"],
            type=credential_type,
            created_at=normalized["created_at"],
            updated_at=normalized["updated_at"],
            config=ApiKeyPermanentCredentialPublicConfig(
                verify_url=normalized["config"]["verify_url"],
                scheme=normalized["config"]["scheme"],
                permanent_token=normalized["config"]["permanent_token"],
            ),
        )
    if credential_type == "login_password":
        return LoginPasswordCredentialPublic(
            id=normalized["id"],
            name=normalized["name"],
            type=credential_type,
            created_at=normalized["created_at"],
            updated_at=normalized["updated_at"],
            config=LoginPasswordCredentialPublicConfig(
                login_url=normalized["config"]["login_url"],
                username=normalized["config"]["username"],
                referer=normalized["config"]["referer"],
                password=normalized["config"]["password"],
            ),
        )
    return ClientAdminCredentialPublic(
        id=normalized["id"],
        name=normalized["name"],
        type="client_admin",
        created_at=normalized["created_at"],
        updated_at=normalized["updated_at"],
        config=ClientAdminCredentialPublicConfig(
            admin_credential_id=normalized["config"]["admin_credential_id"],
            admin_token_url=normalized["config"]["admin_token_url"],
            client_id=normalized["config"]["client_id"],
            issue_by_current_user=normalized["config"]["issue_by_current_user"],
        ),
    )


def _normalize_raw_credential(credential: dict[str, Any]) -> dict[str, Any]:
    credential_type = _require_non_empty(_as_str(credential.get("type")), "Credential type")
    normalized = {
        "id": _require_non_empty(_as_str(credential.get("id")), "Credential ID"),
        "name": _require_non_empty(_as_str(credential.get("name")), "Credential name"),
        "type": credential_type,
        "created_at": _require_non_empty(
            _as_str(credential.get("created_at")), "Credential created_at"
        ),
        "updated_at": _require_non_empty(
            _as_str(credential.get("updated_at")), "Credential updated_at"
        ),
        "config": _normalize_raw_credential_config(credential_type, credential.get("config")),
    }
    return normalized


def _normalize_raw_credential_config(credential_type: str, raw_config: object) -> dict[str, Any]:
    config = _require_mapping(raw_config, "Credential config")
    if credential_type == "bearer":
        return {"token": _require_string(config.get("token"), "Credential token")}
    if credential_type == "api_key_permanent":
        scheme = _as_str(config.get("scheme")) or "APIKey"
        return {
            "permanent_token": _require_string(config.get("permanent_token"), "Permanent token"),
            "verify_url": _require_string(config.get("verify_url"), "Verify URL"),
            "scheme": _require_non_empty(scheme, "Authorization scheme"),
        }
    if credential_type == "login_password":
        return {
            "login_url": _require_string(config.get("login_url"), "Login URL"),
            "username": _require_string(config.get("username"), "Username"),
            "password": _require_string(config.get("password"), "Password"),
            "referer": _require_string(config.get("referer"), "Referer"),
        }
    if credential_type == "client_admin":
        client_id = config.get("client_id")
        if not isinstance(client_id, int):
            raise RequestsCredentialValidationError("Client ID must be an integer.")
        issue_by_current_user = config.get("issue_by_current_user")
        if not isinstance(issue_by_current_user, bool):
            raise RequestsCredentialValidationError("issue_by_current_user must be a boolean.")
        return {
            "admin_credential_id": _require_string(
                config.get("admin_credential_id"), "Admin credential ID"
            ),
            "admin_token_url": _require_string(
                config.get("admin_token_url"), "Admin token URL"
            ),
            "client_id": client_id,
            "issue_by_current_user": issue_by_current_user,
        }
    raise RequestsCredentialValidationError(f"Unknown credential type: {credential_type}")


def _require_mapping(value: object, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise RequestsCredentialValidationError(f"{label} must be an object.")
    return {str(key): raw_value for key, raw_value in value.items() if isinstance(key, str)}


def _as_str(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    return value


def _require_string(value: object, label: str) -> str:
    normalized = _as_str(value)
    if normalized is None:
        raise RequestsCredentialValidationError(f"{label} must be a string.")
    return normalized


def _require_non_empty(value: str | None, label: str) -> str:
    normalized = (value or "").strip()
    if not normalized:
        raise RequestsCredentialValidationError(f"{label} must not be empty.")
    return normalized


def _require_non_empty_environment(value: str | None, label: str) -> str:
    normalized = (value or "").strip()
    if not normalized:
        raise RequestsEnvironmentValidationError(f"{label} must not be empty.")
    return normalized


def _require_non_empty_variable(value: str | None, label: str) -> str:
    normalized = (value or "").strip()
    if not normalized:
        raise RequestsVariableValidationError(f"{label} must not be empty.")
    return normalized


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()
