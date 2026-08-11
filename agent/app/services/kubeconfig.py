"""Local staging kubeconfig inspection, refresh, activation, and audit."""

from __future__ import annotations

import base64
import contextlib
import json
import os
import tempfile
from datetime import UTC, datetime
from enum import StrEnum
from pathlib import Path
from uuid import uuid4

import httpx

from app.core.config import Settings
from app.core.constants import (
    DEFAULT_BACKEND_TIMEOUT_SECONDS,
    KUBECONFIG_REFRESH_GRACE_SECONDS,
    ErrorMessage,
    KubeconfigAction,
    KubeconfigReason,
    OperationStatus,
    OperationType,
)
from app.schemas import KubeconfigStatus
from app.services.backend import build_operation_payload, push_operation


class KubeconfigDownloadFailedError(RuntimeError):
    """Raised when the kubeconfig download request fails."""


class KubeconfigDownloadInvalidError(RuntimeError):
    """Raised when the downloaded body is not a kubeconfig."""


class KubeconfigActivePathConflictError(RuntimeError):
    """Raised when activation would overwrite a regular file."""


class KubeconfigValue(StrEnum):
    DOT = "."
    EMPTY = ""
    JSON_START = "{"
    TEMP_FILE_PREFIX = ".staging-kubeconfig-"
    TEMP_LINK_SUFFIX = ".link"
    TOKEN_FIELD_PREFIX = "token:"


class KubeconfigIndicator(StrEnum):
    HTML_PREFIX = "<html"
    HTML_DOCTYPE_PREFIX = "<!doctype html"
    FORBIDDEN = "403 forbidden"
    NOT_FOUND = "404 not found"


class KubeconfigJsonField(StrEnum):
    CLUSTERS = "clusters"
    CONTEXTS = "contexts"
    CURRENT_CONTEXT = "current-context"
    EXP = "exp"
    TOKEN = "token"
    USERS = "users"


class KubeconfigYamlMarker(StrEnum):
    API_VERSION = "apiVersion:"
    CLUSTERS = "clusters:"
    CONTEXTS = "contexts:"
    CURRENT_CONTEXT = "current-context:"
    KIND = "kind:"
    USERS = "users:"


class KubeconfigAuditField(StrEnum):
    ACTION = "action"
    URL = "url"


class KubeconfigMessage(StrEnum):
    SOURCE_MISSING = "The staging kubeconfig does not exist and cannot be activated."


FILE_MODE_USER_ONLY = 0o600
SECONDS_PER_HOUR = 60 * 60
BASE64_PADDING_BLOCK_SIZE = 4
JWT_PART_COUNT = 3
TOKEN_EXPIRY_SOURCES_MIN_COUNT = 1

VALID_JSON_FIELDS = (
    KubeconfigJsonField.CLUSTERS.value,
    KubeconfigJsonField.CONTEXTS.value,
    KubeconfigJsonField.USERS.value,
    KubeconfigJsonField.CURRENT_CONTEXT.value,
)
VALID_YAML_MARKERS = (
    KubeconfigYamlMarker.KIND.value,
    KubeconfigYamlMarker.CLUSTERS.value,
    KubeconfigYamlMarker.CONTEXTS.value,
    KubeconfigYamlMarker.USERS.value,
    KubeconfigYamlMarker.CURRENT_CONTEXT.value,
)
INVALID_CONTENT_INDICATORS = (
    KubeconfigIndicator.FORBIDDEN.value,
    KubeconfigIndicator.NOT_FOUND.value,
)
QUOTED_TOKEN_DELIMITERS = frozenset({"'", '"'})
STATUS_REASON_ORDER = (
    KubeconfigReason.MISSING,
    KubeconfigReason.CONTENT_INVALID,
    KubeconfigReason.TOKEN_EXPIRED,
    KubeconfigReason.STALE,
    KubeconfigReason.NOT_ACTIVE,
)


def kubeconfig_looks_valid(text: str) -> bool:
    """Return whether the provided text looks like a real kubeconfig."""

    stripped = text.lstrip()
    if not stripped:
        return False

    lowered = stripped.lower()
    if lowered.startswith(KubeconfigIndicator.HTML_PREFIX.value) or lowered.startswith(
        KubeconfigIndicator.HTML_DOCTYPE_PREFIX.value
    ):
        return False
    if any(indicator in lowered for indicator in INVALID_CONTENT_INDICATORS):
        return False

    if stripped.startswith(KubeconfigValue.JSON_START.value):
        try:
            data = json.loads(stripped)
        except json.JSONDecodeError:
            return False
        if not isinstance(data, dict):
            return False
        return any(field in data for field in VALID_JSON_FIELDS)

    if KubeconfigYamlMarker.API_VERSION.value not in text:
        return False
    return any(marker in text for marker in VALID_YAML_MARKERS)


def jwt_token_expiry(token: str) -> datetime | None:
    """Return the JWT expiry timestamp if the token payload carries `exp`."""

    parts = token.split(KubeconfigValue.DOT.value)
    if len(parts) != JWT_PART_COUNT:
        return None
    payload = parts[TOKEN_EXPIRY_SOURCES_MIN_COUNT]
    padding = "=" * (-len(payload) % BASE64_PADDING_BLOCK_SIZE)
    try:
        decoded = base64.urlsafe_b64decode(payload + padding)
        data = json.loads(decoded)
    except (ValueError, json.JSONDecodeError):
        return None

    value = data.get(KubeconfigJsonField.EXP.value)
    if isinstance(value, int):
        return datetime.fromtimestamp(value, tz=UTC)
    if isinstance(value, float):
        return datetime.fromtimestamp(int(value), tz=UTC)
    if isinstance(value, str) and value.isdigit():
        return datetime.fromtimestamp(int(value), tz=UTC)
    return None


def kubeconfig_token_expiry(text: str) -> datetime | None:
    """Return the earliest JWT expiry timestamp found in the kubeconfig text."""

    expirations: list[datetime] = []
    stripped = text.lstrip()
    if stripped.startswith(KubeconfigValue.JSON_START.value):
        try:
            data = json.loads(stripped)
        except json.JSONDecodeError:
            return None
        _collect_json_token_expirations(data, expirations)
    else:
        for line in text.splitlines():
            token = _extract_yaml_token(line)
            if token is None:
                continue
            expiration = jwt_token_expiry(token)
            if expiration is not None:
                expirations.append(expiration)

    if len(expirations) < TOKEN_EXPIRY_SOURCES_MIN_COUNT:
        return None
    return min(expirations)


def read_status(settings: Settings) -> KubeconfigStatus:
    """Inspect the staging kubeconfig locally without touching the cluster."""

    path = Path(settings.staging_kubeconfig).expanduser()
    active_path = Path(settings.kubeconfig_active_path).expanduser()
    max_age_seconds = settings.staging_kubeconfig_max_age_hours * SECONDS_PER_HOUR

    exists = path.exists()
    text = _read_text(path) if exists else None
    content_valid = kubeconfig_looks_valid(text or KubeconfigValue.EMPTY.value)
    token_expires_at = kubeconfig_token_expiry(text or KubeconfigValue.EMPTY.value)
    token_expired = _token_is_expired(token_expires_at)
    modified_at, age_seconds = _read_mtime_and_age(path) if exists else (None, None)
    stale = age_seconds is not None and age_seconds > max_age_seconds
    active = _is_active_kubeconfig(active_path, path)
    healthy = exists and content_valid and not token_expired and not stale
    reasons = _build_status_reasons(
        exists=exists,
        content_valid=content_valid,
        token_expired=token_expired,
        stale=stale,
        active=active,
    )

    recommended_action = KubeconfigAction.NONE
    if not healthy:
        recommended_action = KubeconfigAction.REFRESH_AND_ACTIVATE
    elif not active:
        recommended_action = KubeconfigAction.ACTIVATE

    return KubeconfigStatus(
        path=str(path),
        active_path=str(active_path),
        exists=exists,
        content_valid=content_valid,
        token_expires_at=token_expires_at,
        token_expired=token_expired,
        modified_at=modified_at,
        age_seconds=age_seconds,
        max_age_seconds=max_age_seconds,
        stale=stale,
        active=active,
        healthy=healthy,
        recommended_action=recommended_action,
        reasons=reasons,
        url=settings.staging_kubeconfig_url,
    )


async def refresh(
    settings: Settings,
    *,
    client: httpx.AsyncClient | None = None,
) -> KubeconfigStatus:
    """Download a fresh staging kubeconfig and then re-inspect it."""

    url = settings.staging_kubeconfig_url
    path = Path(settings.staging_kubeconfig).expanduser()
    body = await _download_kubeconfig_body(url, client=client)
    if not kubeconfig_looks_valid(body):
        raise KubeconfigDownloadInvalidError(ErrorMessage.KUBECONFIG_DOWNLOAD_INVALID.value)

    _write_kubeconfig_atomically(path, body)
    return read_status(settings)


def activate(settings: Settings) -> KubeconfigStatus:
    """Make the staging kubeconfig the active kubeconfig via a symlink swap."""

    path = Path(settings.staging_kubeconfig).expanduser()
    active_path = Path(settings.kubeconfig_active_path).expanduser()
    if not path.exists():
        raise ValueError(KubeconfigMessage.SOURCE_MISSING.value)
    if active_path.exists() and not active_path.is_symlink():
        raise KubeconfigActivePathConflictError(
            ErrorMessage.KUBECONFIG_ACTIVE_PATH_NOT_SYMLINK.value
        )

    active_path.parent.mkdir(parents=True, exist_ok=True)
    temp_link_path = _build_temp_link_path(active_path)
    with contextlib.suppress(FileNotFoundError):
        temp_link_path.unlink()
    os.symlink(path, temp_link_path)
    os.replace(temp_link_path, active_path)
    return read_status(settings)


async def push_kubeconfig_operation(
    *,
    client: httpx.AsyncClient,
    token: str,
    action: KubeconfigAction,
    settings: Settings,
) -> None:
    """Push a best-effort kubeconfig audit record."""

    started_at = datetime.now(tz=UTC)
    recipe: dict[str, str] = {KubeconfigAuditField.ACTION.value: action.value}
    if action in (KubeconfigAction.REFRESH, KubeconfigAction.REFRESH_AND_ACTIVATE):
        recipe[KubeconfigAuditField.URL.value] = settings.staging_kubeconfig_url

    payload = build_operation_payload(
        op_id=uuid4(),
        type=OperationType.KUBECONFIG_REFRESH,
        ns=None,
        recipe=recipe,
        status=OperationStatus.SUCCESS,
        started_at=started_at,
        finished_at=started_at,
        log=None,
        exit_code=None,
        stagings_sha=None,
    )
    with contextlib.suppress(Exception):
        await push_operation(client=client, token=token, payload=payload)


async def _download_kubeconfig_body(
    url: str,
    *,
    client: httpx.AsyncClient | None,
) -> str:
    if client is not None:
        return await _read_download_body(client, url)

    async with httpx.AsyncClient(
        follow_redirects=True,
        timeout=DEFAULT_BACKEND_TIMEOUT_SECONDS,
    ) as transient_client:
        return await _read_download_body(transient_client, url)


async def _read_download_body(client: httpx.AsyncClient, url: str) -> str:
    try:
        response = await client.get(url)
        response.raise_for_status()
    except httpx.HTTPError as exc:
        raise KubeconfigDownloadFailedError(ErrorMessage.KUBECONFIG_DOWNLOAD_FAILED.value) from exc
    return response.text


def _build_status_reasons(
    *,
    exists: bool,
    content_valid: bool,
    token_expired: bool,
    stale: bool,
    active: bool,
) -> list[KubeconfigReason]:
    reasons: list[KubeconfigReason] = []
    if not exists:
        reasons.append(KubeconfigReason.MISSING)
    if exists and not content_valid:
        reasons.append(KubeconfigReason.CONTENT_INVALID)
    if token_expired:
        reasons.append(KubeconfigReason.TOKEN_EXPIRED)
    if stale:
        reasons.append(KubeconfigReason.STALE)
    if not active:
        reasons.append(KubeconfigReason.NOT_ACTIVE)
    if not reasons:
        return [KubeconfigReason.HEALTHY]
    return [reason for reason in STATUS_REASON_ORDER if reason in reasons]


def _collect_json_token_expirations(value: object, expirations: list[datetime]) -> None:
    if isinstance(value, dict):
        for key, nested in value.items():
            if key == KubeconfigJsonField.TOKEN.value and isinstance(nested, str):
                expiration = jwt_token_expiry(nested)
                if expiration is not None:
                    expirations.append(expiration)
                continue
            _collect_json_token_expirations(nested, expirations)
        return
    if isinstance(value, list):
        for item in value:
            _collect_json_token_expirations(item, expirations)


def _extract_yaml_token(line: str) -> str | None:
    stripped = line.strip()
    if not stripped.startswith(KubeconfigValue.TOKEN_FIELD_PREFIX.value):
        return None
    token = stripped.split(KubeconfigValue.TOKEN_FIELD_PREFIX.value, maxsplit=1)[1].strip()
    if not token:
        return None
    if token[0] in QUOTED_TOKEN_DELIMITERS and token[-1:] == token[0]:
        token = token[1:-1]
    return token or None


def _is_active_kubeconfig(active_path: Path, source_path: Path) -> bool:
    if active_path.is_symlink():
        target = Path(os.readlink(active_path))
        if not target.is_absolute():
            target = active_path.parent / target
        if target.expanduser() == source_path:
            return True
    if not active_path.exists() and not active_path.is_symlink():
        return False
    return os.path.realpath(active_path) == os.path.realpath(source_path)


def _read_mtime_and_age(path: Path) -> tuple[datetime | None, int | None]:
    try:
        modified_at = datetime.fromtimestamp(path.stat().st_mtime, tz=UTC)
    except OSError:
        return None, None
    age_seconds = int((datetime.now(tz=UTC) - modified_at).total_seconds())
    return modified_at, age_seconds


def _read_text(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return None


def _token_is_expired(expires_at: datetime | None) -> bool:
    if expires_at is None:
        return False
    grace_deadline = datetime.now(tz=UTC).timestamp() + KUBECONFIG_REFRESH_GRACE_SECONDS
    return expires_at.timestamp() <= grace_deadline


def _write_kubeconfig_atomically(path: Path, body: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_file = tempfile.NamedTemporaryFile(
        mode="w",
        dir=path.parent,
        encoding="utf-8",
        delete=False,
        prefix=KubeconfigValue.TEMP_FILE_PREFIX.value,
    )
    temp_path = Path(temp_file.name)
    try:
        with temp_file:
            temp_file.write(body)
            temp_file.flush()
            os.fchmod(temp_file.fileno(), FILE_MODE_USER_ONLY)
        os.replace(temp_path, path)
        os.chmod(path, FILE_MODE_USER_ONLY)
    except Exception:
        with contextlib.suppress(FileNotFoundError):
            temp_path.unlink()
        raise


def _build_temp_link_path(active_path: Path) -> Path:
    return active_path.with_name(f"{active_path.name}{KubeconfigValue.TEMP_LINK_SUFFIX.value}")
