"""Saved request execution, authorization resolution, and history."""

from __future__ import annotations

import base64
import json
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, TypedDict
from urllib.parse import parse_qsl, urlencode
from uuid import uuid4

import httpx

from app.core.config import Settings
from app.core.constants import (
    DEFAULT_REQUESTS_TIMEOUT_SECONDS,
    DEFAULT_REQUESTS_TOKEN_TTL_SECONDS,
    REDACTED_VALUE,
    REQUESTS_HISTORY_LIMIT,
    REQUESTS_TOKEN_EXPIRY_SKEW_SECONDS,
    HeaderName,
    HeaderValue,
)
from app.schemas import (
    HistoryEntry,
    HistoryListResponse,
    HistoryResponseSummary,
    RequestDocumentInput,
    RequestExecuteResponse,
    RequestHeaderField,
    RequestHeaderValue,
    RequestQueryParam,
    RequestSummary,
)
from app.services.requests_store import (
    RequestsCredentialNotFoundError,
    _write_text_atomically,
    get_credential_raw,
)

MAX_RESPONSE_BODY_BYTES = 2 * 1024 * 1024
FORM_CONTENT_TYPE = "application/x-www-form-urlencoded"


class CachedAuthorization(TypedDict):
    value: str
    expires_at: float


class RequestsCredentialResolutionError(RuntimeError):
    pass


async def resolve_authorization(
    app: Any,
    settings: Settings,
    credential_id: str | None,
    *,
    force: bool = False,
    _seen: set[str] | None = None,
) -> str | None:
    if credential_id is None:
        return None
    seen = set() if _seen is None else set(_seen)
    if credential_id in seen:
        raise RequestsCredentialResolutionError("Credential resolution cycle detected.")
    seen.add(credential_id)
    if not force:
        cached = _read_cached_authorization(app, credential_id)
        if cached is not None:
            return cached

    credential = get_credential_raw(settings, credential_id)
    credential_type = credential["type"]
    config = credential["config"]

    if credential_type == "bearer":
        authorization = "{} {}".format(HeaderValue.BEARER.value, config["token"])
        _cache_authorization(app, credential_id, authorization)
        return authorization

    try:
        async with httpx.AsyncClient(
            timeout=DEFAULT_REQUESTS_TIMEOUT_SECONDS, follow_redirects=True, verify=True
        ) as client:
            if credential_type == "api_key_permanent":
                scheme = str(config.get("scheme") or "APIKey")
                response = await client.get(
                    config["verify_url"],
                    headers={
                        HeaderName.AUTHORIZATION.value: "{} {}".format(
                            scheme, config["permanent_token"]
                        )
                    },
                )
                _raise_for_status(response, "Permanent token verification failed")
                authorization = response.headers.get("authorization")
                if not authorization:
                    raise RequestsCredentialResolutionError(
                        "Verify response did not include an authorization header."
                    )
            elif credential_type == "login_password":
                response = await client.post(
                    config["login_url"],
                    headers={"Referer": config["referer"]},
                    json={"username": config["username"], "password": config["password"]},
                )
                _raise_for_status(response, "Login request failed")
                payload = _response_json(response, "Login response")
                access = payload.get("access")
                if not isinstance(access, str) or not access.strip():
                    raise RequestsCredentialResolutionError(
                        "Login response did not include an access token."
                    )
                authorization = f"{HeaderValue.BEARER.value} {access.strip()}"
            elif credential_type == "client_admin":
                admin_credential_id = config["admin_credential_id"]
                try:
                    admin_authorization = await resolve_authorization(
                        app,
                        settings,
                        admin_credential_id,
                        force=force,
                        _seen=seen,
                    )
                except RequestsCredentialNotFoundError as exc:
                    raise RequestsCredentialResolutionError(
                        f"Admin credential not found: {admin_credential_id}"
                    ) from exc
                if admin_authorization is None:
                    raise RequestsCredentialResolutionError(
                        "Admin credential could not be resolved."
                    )
                token_url = str(config["admin_token_url"])
                if "{client_id}" in token_url:
                    token_url = token_url.format(client_id=config["client_id"])
                response = await client.get(
                    token_url,
                    headers={HeaderName.AUTHORIZATION.value: admin_authorization},
                    params={
                        "issue_by_current_user": "true"
                        if config["issue_by_current_user"]
                        else "false"
                    },
                )
                _raise_for_status(response, "Client token request failed")
                payload = _response_json(response, "Client token response")
                access = payload.get("access")
                if not isinstance(access, str) or not access.strip():
                    raise RequestsCredentialResolutionError(
                        "Client token response did not include an access token."
                    )
                authorization = f"{HeaderValue.BEARER.value} {access.strip()}"
            else:
                raise RequestsCredentialResolutionError(
                    f"Unknown credential type: {credential_type}"
                )
    except httpx.HTTPError as exc:
        raise RequestsCredentialResolutionError(str(exc)) from exc

    _cache_authorization(app, credential_id, authorization)
    return authorization


async def execute(
    app: Any,
    settings: Settings,
    spec: RequestDocumentInput,
    *,
    record: bool = True,
) -> RequestExecuteResponse:
    headers = _enabled_headers(spec.headers)
    query_params = _enabled_query_params(spec.query_params)
    has_manual_authorization = any(
        header.name.lower() == HeaderName.AUTHORIZATION.value.lower() for header in headers
    )

    try:
        if not has_manual_authorization and spec.credential_id is not None:
            authorization = await resolve_authorization(app, settings, spec.credential_id)
            if authorization is not None:
                headers.append(
                    RequestHeaderValue(name=HeaderName.AUTHORIZATION.value, value=authorization)
                )
        if not any(
            header.name.lower() == HeaderName.X_REQUEST_ID.value.lower() for header in headers
        ):
            headers.append(
                RequestHeaderValue(name=HeaderName.X_REQUEST_ID.value, value=str(uuid4()))
            )
        lowered_header_names = {header.name.lower() for header in headers}
        if (
            spec.body.mode == "json"
            and HeaderName.CONTENT_TYPE.value.lower() not in lowered_header_names
        ):
            headers.append(
                RequestHeaderValue(
                    name=HeaderName.CONTENT_TYPE.value,
                    value=HeaderValue.APPLICATION_JSON.value,
                )
            )
        if (
            spec.body.mode == "form"
            and HeaderName.CONTENT_TYPE.value.lower() not in lowered_header_names
        ):
            headers.append(
                RequestHeaderValue(name=HeaderName.CONTENT_TYPE.value, value=FORM_CONTENT_TYPE)
            )

        request_summary = RequestSummary(
            method=spec.method,
            url=spec.url,
            headers=_redact_headers(headers),
            query_params=list(query_params),
        )
        request_kwargs = _build_request_kwargs(spec)
        started_at = time.perf_counter()
        async with httpx.AsyncClient(
            timeout=DEFAULT_REQUESTS_TIMEOUT_SECONDS, follow_redirects=True, verify=True
        ) as client:
            response = await client.request(
                spec.method,
                spec.url,
                headers=[(header.name, header.value) for header in headers],
                params=[(param.name, param.value) for param in query_params],
                **request_kwargs,
            )
        elapsed_ms = int(round((time.perf_counter() - started_at) * 1000))
        size_bytes = len(response.content)
        body_text, truncated = _decode_response_body(response)
        result = RequestExecuteResponse(
            status_code=response.status_code,
            reason_phrase=response.reason_phrase,
            elapsed_ms=elapsed_ms,
            size_bytes=size_bytes,
            headers=[
                RequestHeaderValue(name=name, value=value)
                for name, value in response.headers.multi_items()
            ],
            body_text=body_text,
            truncated=truncated,
            error=None,
            request_summary=request_summary,
        )
    except (
        RequestsCredentialNotFoundError,
        RequestsCredentialResolutionError,
        httpx.HTTPError,
    ) as exc:
        request_summary = RequestSummary(
            method=spec.method,
            url=spec.url,
            headers=_redact_headers(headers),
            query_params=list(query_params),
        )
        result = RequestExecuteResponse(
            status_code=None,
            reason_phrase=None,
            elapsed_ms=None,
            size_bytes=0,
            headers=[],
            body_text="",
            truncated=False,
            error=str(exc),
            request_summary=request_summary,
        )

    if record:
        _append_history(settings, result)
    return result


def list_history(settings: Settings) -> HistoryListResponse:
    entries: list[HistoryEntry] = []
    for raw_entry in _read_history_entries(settings):
        try:
            entries.append(HistoryEntry.model_validate(raw_entry))
        except Exception:
            continue
    entries.reverse()
    return HistoryListResponse(entries=entries)


def delete_history_entry(settings: Settings, entry_id: str) -> None:
    entries = [entry for entry in _read_history_entries(settings) if entry.get("id") != entry_id]
    _write_history_entries(settings, entries)


def clear_history(settings: Settings) -> None:
    path = Path(settings.requests_history_path).expanduser()
    if path.exists():
        path.unlink()


def authorization_expires_at(value: str | None) -> str | None:
    if value is None:
        return None
    exp = _authorization_exp_epoch(value)
    if exp is None:
        return None
    return datetime.fromtimestamp(exp, tz=UTC).isoformat()


def _enabled_headers(headers: list[RequestHeaderField]) -> list[RequestHeaderValue]:
    return [
        RequestHeaderValue(name=header.name, value=header.value)
        for header in headers
        if header.enabled and header.name.strip()
    ]


def _enabled_query_params(query_params: list[RequestQueryParam]) -> list[RequestHeaderValue]:
    return [
        RequestHeaderValue(name=param.name, value=param.value)
        for param in query_params
        if param.enabled and param.name.strip()
    ]


def _redact_headers(headers: list[RequestHeaderValue]) -> list[RequestHeaderValue]:
    redacted: list[RequestHeaderValue] = []
    for header in headers:
        value = (
            REDACTED_VALUE
            if header.name.lower() == HeaderName.AUTHORIZATION.value.lower()
            else header.value
        )
        redacted.append(RequestHeaderValue(name=header.name, value=value))
    return redacted


def _build_request_kwargs(spec: RequestDocumentInput) -> dict[str, Any]:
    if spec.body.mode == "none":
        return {}
    if spec.body.mode in {"json", "raw"}:
        return {"content": spec.body.content}
    encoded = urlencode(parse_qsl(spec.body.content, keep_blank_values=True), doseq=True)
    return {"content": encoded}


def _decode_response_body(response: httpx.Response) -> tuple[str, bool]:
    content = response.content
    truncated = len(content) > MAX_RESPONSE_BODY_BYTES
    if truncated:
        content = content[:MAX_RESPONSE_BODY_BYTES]
    encoding = response.encoding or "utf-8"
    return content.decode(encoding, errors="replace"), truncated


def _raise_for_status(response: httpx.Response, context: str) -> None:
    if response.status_code >= 400:
        raise RequestsCredentialResolutionError(f"{context}: HTTP {response.status_code}")


def _response_json(response: httpx.Response, context: str) -> dict[str, Any]:
    try:
        payload = response.json()
    except ValueError as exc:
        raise RequestsCredentialResolutionError(f"{context} was not valid JSON.") from exc
    if not isinstance(payload, dict):
        raise RequestsCredentialResolutionError(f"{context} was not a JSON object.")
    return payload


def _read_cached_authorization(app: Any, credential_id: str) -> str | None:
    cache: dict[str, CachedAuthorization] = app.state.requests_token_cache
    cached = cache.get(credential_id)
    if cached is None:
        return None
    if cached["expires_at"] <= time.monotonic():
        cache.pop(credential_id, None)
        return None
    return cached["value"]


def _cache_authorization(app: Any, credential_id: str, value: str) -> None:
    ttl_seconds = _authorization_ttl_seconds(value)
    if ttl_seconds is None:
        app.state.requests_token_cache.pop(credential_id, None)
        return
    cache: dict[str, CachedAuthorization] = app.state.requests_token_cache
    cache[credential_id] = {
        "value": value,
        "expires_at": time.monotonic() + ttl_seconds,
    }


def _authorization_ttl_seconds(value: str) -> float | None:
    exp = _authorization_exp_epoch(value)
    if exp is None:
        return float(DEFAULT_REQUESTS_TOKEN_TTL_SECONDS)
    ttl = float(exp) - float(REQUESTS_TOKEN_EXPIRY_SKEW_SECONDS) - time.time()
    if ttl <= 0:
        return None
    return ttl


def _authorization_exp_epoch(value: str) -> int | None:
    _, separator, token = value.partition(" ")
    raw_token = token if separator else value
    parts = raw_token.split(".")
    if len(parts) != 3:
        return None
    payload = parts[1]
    padding = "=" * (-len(payload) % 4)
    try:
        decoded = base64.urlsafe_b64decode(payload + padding)
        data = json.loads(decoded)
    except Exception:
        return None
    exp = data.get("exp") if isinstance(data, dict) else None
    if isinstance(exp, int):
        return exp
    if isinstance(exp, float):
        return int(exp)
    return None


def _append_history(settings: Settings, result: RequestExecuteResponse) -> None:
    entries = _read_history_entries(settings)
    entry = HistoryEntry(
        id=str(uuid4()),
        at=datetime.now(UTC).isoformat(),
        request_summary=result.request_summary,
        response_summary=HistoryResponseSummary(
            status_code=result.status_code,
            elapsed_ms=result.elapsed_ms,
            size_bytes=result.size_bytes,
            error=result.error,
        ),
    )
    entries.append(entry.model_dump(mode="json"))
    if len(entries) > REQUESTS_HISTORY_LIMIT:
        entries = entries[-REQUESTS_HISTORY_LIMIT:]
    _write_history_entries(settings, entries)


def _read_history_entries(settings: Settings) -> list[dict[str, Any]]:
    path = Path(settings.requests_history_path).expanduser()
    if not path.exists():
        return []
    entries: list[dict[str, Any]] = []
    try:
        lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
    except OSError:
        return []
    for line in lines:
        if not line.strip():
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            entries.append(payload)
    return entries


def _write_history_entries(settings: Settings, entries: list[dict[str, Any]]) -> None:
    path = Path(settings.requests_history_path).expanduser()
    body = ""
    if entries:
        body = "\n".join(json.dumps(entry, ensure_ascii=False) for entry in entries) + "\n"
    _write_text_atomically(path, body)
