from __future__ import annotations

import base64
import json
import os
import textwrap
import time
from pathlib import Path
from typing import Any

import httpx
import pytest
from conftest import BackendRecorder

from app.core.config import Settings
from app.core.constants import (
    EnvKey,
    ErrorMessage,
    KubeconfigAction,
    KubeconfigReason,
    StagingEnvKey,
)
from app.services import kubeconfig as kubeconfig_service
from app.services.kubeconfig import (
    KubeconfigActivePathConflictError,
    KubeconfigDownloadFailedError,
    KubeconfigDownloadInvalidError,
    activate,
    jwt_token_expiry,
    kubeconfig_looks_valid,
    read_status,
    refresh,
)

KUBE_DIRECTORY_NAME = ".kube"
ACTIVE_KUBECONFIG_FILE_NAME = "config"
STAGING_KUBECONFIG_FILE_NAME = "ai-staging.yaml"
SECONDS_PER_HOUR = 60 * 60
STATUS_STALE_EXTRA_SECONDS = 1
JWT_HEADER = {"alg": "none", "typ": "JWT"}
JWT_SIGNATURE = "signature"
JSON_MEDIA_TYPE = "application/json"
VALID_KUBECONFIG_JSON = json.dumps(
    {
        "clusters": [],
        "contexts": [],
        "users": [],
        "current-context": "staging",
    }
)
INVALID_HTML_KUBECONFIG = "<html><body>403 Forbidden</body></html>"
VALID_KUBECONFIG_TEMPLATE = textwrap.dedent(
    """\
    apiVersion: v1
    kind: Config
    current-context: staging
    clusters:
    - name: staging
      cluster:
        server: https://staging.example
    contexts:
    - name: staging
      context:
        cluster: staging
        user: staging-user
    users:
    - name: staging-user
      user:
        token: {token}
    """
)
TOKEN_EXPIRED_OFFSET_SECONDS = 0
TOKEN_FRESH_OFFSET_SECONDS = 4 * SECONDS_PER_HOUR
TOKEN_GRACE_SECONDS = 299


def build_settings(home_path: Path) -> Settings:
    return Settings(
        **{
            StagingEnvKey.KUBECONFIG.value: str(
                Path("~") / KUBE_DIRECTORY_NAME / STAGING_KUBECONFIG_FILE_NAME
            ),
            EnvKey.KUBECONFIG_ACTIVE_PATH.value: str(
                Path("~") / KUBE_DIRECTORY_NAME / ACTIVE_KUBECONFIG_FILE_NAME
            ),
            EnvKey.STAGING_KUBECONFIG_URL.value: "https://kube.example/config",
            EnvKey.STAGING_KUBECONFIG_MAX_AGE_HOURS.value: 48,
        }
    )


def build_kube_paths(home_path: Path) -> tuple[Path, Path]:
    kube_directory = home_path / KUBE_DIRECTORY_NAME
    return (
        kube_directory / STAGING_KUBECONFIG_FILE_NAME,
        kube_directory / ACTIVE_KUBECONFIG_FILE_NAME,
    )


def encode_jwt(payload: dict[str, Any]) -> str:
    return ".".join(
        (
            _base64url_encode_json(JWT_HEADER),
            _base64url_encode_json(payload),
            JWT_SIGNATURE,
        )
    )


def write_valid_kubeconfig(path: Path, *, token: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(VALID_KUBECONFIG_TEMPLATE.format(token=token), encoding="utf-8")


def activate_source(source_path: Path, active_path: Path) -> None:
    active_path.parent.mkdir(parents=True, exist_ok=True)
    if active_path.exists() or active_path.is_symlink():
        active_path.unlink()
    active_path.symlink_to(source_path)


def _base64url_encode_json(payload: dict[str, Any]) -> str:
    encoded = base64.urlsafe_b64encode(
        json.dumps(payload, separators=(",", ":")).encode("utf-8")
    ).decode("utf-8")
    return encoded.rstrip("=")


def test_kubeconfig_looks_valid_accepts_yaml_and_json_and_rejects_html() -> None:
    fresh_token = encode_jwt({"exp": int(time.time()) + TOKEN_FRESH_OFFSET_SECONDS})
    valid_yaml = VALID_KUBECONFIG_TEMPLATE.format(token=fresh_token)

    assert kubeconfig_looks_valid(valid_yaml) is True
    assert kubeconfig_looks_valid(VALID_KUBECONFIG_JSON) is True
    assert kubeconfig_looks_valid(INVALID_HTML_KUBECONFIG) is False


def test_jwt_token_expiry_parses_exp_and_supports_grace_window() -> None:
    expired_token = encode_jwt({"exp": int(time.time()) + TOKEN_EXPIRED_OFFSET_SECONDS})
    grace_window_token = encode_jwt({"exp": int(time.time()) + TOKEN_GRACE_SECONDS})
    fresh_token = encode_jwt({"exp": int(time.time()) + TOKEN_FRESH_OFFSET_SECONDS})

    expired_at = jwt_token_expiry(expired_token)
    grace_window_expiry = jwt_token_expiry(grace_window_token)
    fresh_expiry = jwt_token_expiry(fresh_token)

    assert expired_at is not None
    assert grace_window_expiry is not None
    assert fresh_expiry is not None
    assert expired_at <= grace_window_expiry < fresh_expiry


def test_read_status_missing(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    settings = build_settings(tmp_path)

    status = read_status(settings)

    assert status.exists is False
    assert status.healthy is False
    assert status.active is False
    assert status.recommended_action == KubeconfigAction.REFRESH_AND_ACTIVATE
    assert status.reasons == [KubeconfigReason.MISSING, KubeconfigReason.NOT_ACTIVE]


def test_read_status_stale(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    settings = build_settings(tmp_path)
    staging_path, active_path = build_kube_paths(tmp_path)
    fresh_token = encode_jwt({"exp": int(time.time()) + TOKEN_FRESH_OFFSET_SECONDS})
    write_valid_kubeconfig(staging_path, token=fresh_token)
    activate_source(staging_path, active_path)
    stale_mtime = (
        time.time()
        - (settings.staging_kubeconfig_max_age_hours * SECONDS_PER_HOUR)
        - STATUS_STALE_EXTRA_SECONDS
    )
    os.utime(staging_path, (stale_mtime, stale_mtime))

    status = read_status(settings)

    assert status.stale is True
    assert status.healthy is False
    assert status.active is True
    assert status.recommended_action == KubeconfigAction.REFRESH_AND_ACTIVATE
    assert status.reasons == [KubeconfigReason.STALE]


def test_read_status_token_expired(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    settings = build_settings(tmp_path)
    staging_path, active_path = build_kube_paths(tmp_path)
    expired_token = encode_jwt({"exp": int(time.time()) + TOKEN_EXPIRED_OFFSET_SECONDS})
    write_valid_kubeconfig(staging_path, token=expired_token)
    activate_source(staging_path, active_path)

    status = read_status(settings)

    assert status.token_expired is True
    assert status.healthy is False
    assert status.reasons == [KubeconfigReason.TOKEN_EXPIRED]


def test_read_status_invalid_content(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    settings = build_settings(tmp_path)
    staging_path, active_path = build_kube_paths(tmp_path)
    staging_path.parent.mkdir(parents=True, exist_ok=True)
    staging_path.write_text(INVALID_HTML_KUBECONFIG, encoding="utf-8")
    activate_source(staging_path, active_path)

    status = read_status(settings)

    assert status.content_valid is False
    assert status.healthy is False
    assert status.reasons == [KubeconfigReason.CONTENT_INVALID]


def test_read_status_healthy_but_inactive(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    settings = build_settings(tmp_path)
    staging_path, _ = build_kube_paths(tmp_path)
    fresh_token = encode_jwt({"exp": int(time.time()) + TOKEN_FRESH_OFFSET_SECONDS})
    write_valid_kubeconfig(staging_path, token=fresh_token)

    status = read_status(settings)

    assert status.healthy is True
    assert status.active is False
    assert status.recommended_action == KubeconfigAction.ACTIVATE
    assert status.reasons == [KubeconfigReason.NOT_ACTIVE]


def test_read_status_healthy_and_active(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    settings = build_settings(tmp_path)
    staging_path, active_path = build_kube_paths(tmp_path)
    fresh_token = encode_jwt({"exp": int(time.time()) + TOKEN_FRESH_OFFSET_SECONDS})
    write_valid_kubeconfig(staging_path, token=fresh_token)
    activate_source(staging_path, active_path)

    status = read_status(settings)

    assert status.healthy is True
    assert status.active is True
    assert status.recommended_action == KubeconfigAction.NONE
    assert status.reasons == [KubeconfigReason.HEALTHY]


@pytest.mark.asyncio
async def test_refresh_writes_valid_download(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    settings = build_settings(tmp_path)
    staging_path, _ = build_kube_paths(tmp_path)
    fresh_token = encode_jwt({"exp": int(time.time()) + TOKEN_FRESH_OFFSET_SECONDS})
    downloaded_body = VALID_KUBECONFIG_TEMPLATE.format(token=fresh_token)
    transport = httpx.MockTransport(
        lambda request: httpx.Response(
            status_code=200,
            headers={"Content-Type": JSON_MEDIA_TYPE},
            text=downloaded_body,
        )
    )

    async with httpx.AsyncClient(transport=transport, follow_redirects=True) as client:
        status = await refresh(settings, client=client)

    assert staging_path.read_text(encoding="utf-8") == downloaded_body
    assert status.exists is True
    assert status.healthy is True


@pytest.mark.asyncio
async def test_refresh_rejects_invalid_download_and_keeps_original_file(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    settings = build_settings(tmp_path)
    staging_path, _ = build_kube_paths(tmp_path)
    original_token = encode_jwt({"exp": int(time.time()) + TOKEN_FRESH_OFFSET_SECONDS})
    original_body = VALID_KUBECONFIG_TEMPLATE.format(token=original_token)
    write_valid_kubeconfig(staging_path, token=original_token)
    transport = httpx.MockTransport(
        lambda request: httpx.Response(
            status_code=200,
            headers={"Content-Type": JSON_MEDIA_TYPE},
            text=INVALID_HTML_KUBECONFIG,
        )
    )

    async with httpx.AsyncClient(transport=transport, follow_redirects=True) as client:
        with pytest.raises(KubeconfigDownloadInvalidError):
            await refresh(settings, client=client)

    assert staging_path.read_text(encoding="utf-8") == original_body


@pytest.mark.asyncio
async def test_refresh_raises_on_network_error(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    settings = build_settings(tmp_path)

    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("offline", request=request)

    transport = httpx.MockTransport(handler)

    async with httpx.AsyncClient(transport=transport, follow_redirects=True) as client:
        with pytest.raises(KubeconfigDownloadFailedError):
            await refresh(settings, client=client)


def test_activate_creates_symlink_when_active_path_missing(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    settings = build_settings(tmp_path)
    staging_path, active_path = build_kube_paths(tmp_path)
    fresh_token = encode_jwt({"exp": int(time.time()) + TOKEN_FRESH_OFFSET_SECONDS})
    write_valid_kubeconfig(staging_path, token=fresh_token)

    status = activate(settings)

    assert active_path.is_symlink() is True
    assert active_path.resolve() == staging_path.resolve()
    assert status.active is True


def test_activate_repoints_existing_symlink(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    settings = build_settings(tmp_path)
    staging_path, active_path = build_kube_paths(tmp_path)
    alternate_path = staging_path.parent / "alternate.yaml"
    fresh_token = encode_jwt({"exp": int(time.time()) + TOKEN_FRESH_OFFSET_SECONDS})
    write_valid_kubeconfig(staging_path, token=fresh_token)
    write_valid_kubeconfig(alternate_path, token=fresh_token)
    activate_source(alternate_path, active_path)

    status = activate(settings)

    assert active_path.resolve() == staging_path.resolve()
    assert status.active is True


def test_activate_refuses_regular_active_file(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    settings = build_settings(tmp_path)
    staging_path, active_path = build_kube_paths(tmp_path)
    fresh_token = encode_jwt({"exp": int(time.time()) + TOKEN_FRESH_OFFSET_SECONDS})
    write_valid_kubeconfig(staging_path, token=fresh_token)
    active_path.parent.mkdir(parents=True, exist_ok=True)
    active_path.write_text("real file\n", encoding="utf-8")

    with pytest.raises(KubeconfigActivePathConflictError) as exc_info:
        activate(settings)

    assert str(exc_info.value) == ErrorMessage.KUBECONFIG_ACTIVE_PATH_NOT_SYMLINK.value


@pytest.mark.asyncio
async def test_status_route_returns_status_payload(
    client: httpx.AsyncClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    staging_path, active_path = build_kube_paths(tmp_path)
    fresh_token = encode_jwt({"exp": int(time.time()) + TOKEN_FRESH_OFFSET_SECONDS})
    write_valid_kubeconfig(staging_path, token=fresh_token)
    activate_source(staging_path, active_path)
    client._transport.app.state.settings.staging_kubeconfig = str(staging_path)
    client._transport.app.state.settings.kubeconfig_active_path = str(active_path)

    response = await client.get("/staging/kubeconfig/status", headers=auth_headers)

    assert response.status_code == 200
    assert response.json()["healthy"] is True
    assert response.json()["active"] is True
    assert response.json()["recommendedAction"] == KubeconfigAction.NONE.value


@pytest.mark.asyncio
async def test_refresh_route_refreshes_activates_and_audits(
    client: httpx.AsyncClient,
    auth_headers: dict[str, str],
    backend_recorder: BackendRecorder,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    staging_path, active_path = build_kube_paths(tmp_path)
    fresh_token = encode_jwt({"exp": int(time.time()) + TOKEN_FRESH_OFFSET_SECONDS})
    downloaded_body = VALID_KUBECONFIG_TEMPLATE.format(token=fresh_token)
    client._transport.app.state.settings.staging_kubeconfig = str(staging_path)
    client._transport.app.state.settings.kubeconfig_active_path = str(active_path)

    async def fake_download(url: str, *, client: httpx.AsyncClient | None) -> str:
        del url, client
        return downloaded_body

    monkeypatch.setattr(kubeconfig_service, "_download_kubeconfig_body", fake_download)

    response = await client.post(
        "/staging/kubeconfig/refresh",
        headers=auth_headers,
        json={"activate": True},
    )

    assert response.status_code == 200
    assert response.json()["healthy"] is True
    assert response.json()["active"] is True
    assert response.json()["recommendedAction"] == KubeconfigAction.NONE.value
    assert len(backend_recorder.operations) == 1
    assert backend_recorder.operations[0]["type"] == "kubeconfig_refresh"
    assert backend_recorder.operations[0]["status"] == "success"
    assert backend_recorder.operations[0]["recipe"] == {
        "action": KubeconfigAction.REFRESH_AND_ACTIVATE.value,
        "url": client._transport.app.state.settings.staging_kubeconfig_url,
    }


@pytest.mark.asyncio
async def test_activate_route_activates_and_audits(
    client: httpx.AsyncClient,
    auth_headers: dict[str, str],
    backend_recorder: BackendRecorder,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    staging_path, active_path = build_kube_paths(tmp_path)
    fresh_token = encode_jwt({"exp": int(time.time()) + TOKEN_FRESH_OFFSET_SECONDS})
    write_valid_kubeconfig(staging_path, token=fresh_token)
    client._transport.app.state.settings.staging_kubeconfig = str(staging_path)
    client._transport.app.state.settings.kubeconfig_active_path = str(active_path)

    response = await client.post("/staging/kubeconfig/activate", headers=auth_headers)

    assert response.status_code == 200
    assert response.json()["active"] is True
    assert len(backend_recorder.operations) == 1
    assert backend_recorder.operations[0]["type"] == "kubeconfig_refresh"
    assert backend_recorder.operations[0]["recipe"] == {
        "action": KubeconfigAction.ACTIVATE.value,
    }


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("get", "/staging/kubeconfig/status", None),
        ("post", "/staging/kubeconfig/refresh", {"activate": True}),
        ("post", "/staging/kubeconfig/activate", None),
    ],
)
async def test_kubeconfig_routes_require_auth(
    client: httpx.AsyncClient,
    method: str,
    path: str,
    body: dict[str, Any] | None,
) -> None:
    response = await client.request(method.upper(), path, json=body)

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_activate_route_returns_conflict_for_regular_active_file(
    client: httpx.AsyncClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    staging_path, active_path = build_kube_paths(tmp_path)
    fresh_token = encode_jwt({"exp": int(time.time()) + TOKEN_FRESH_OFFSET_SECONDS})
    write_valid_kubeconfig(staging_path, token=fresh_token)
    active_path.parent.mkdir(parents=True, exist_ok=True)
    active_path.write_text("real file\n", encoding="utf-8")
    client._transport.app.state.settings.staging_kubeconfig = str(staging_path)
    client._transport.app.state.settings.kubeconfig_active_path = str(active_path)

    response = await client.post("/staging/kubeconfig/activate", headers=auth_headers)

    assert response.status_code == 409
    assert response.json() == {
        "detail": ErrorMessage.KUBECONFIG_ACTIVE_PATH_NOT_SYMLINK.value,
    }
