from __future__ import annotations

import base64
import json
import stat
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import httpx
import pytest

from app.core.config import Settings
from app.core.constants import AgentPath, BackendPath
from app.main import create_app
from app.schemas import (
    ApiKeyPermanentCredentialCreate,
    ApiKeyPermanentCredentialCreateConfig,
    BearerCredentialCreate,
    BearerCredentialCreateConfig,
    BearerCredentialUpdate,
    BearerCredentialUpdateConfig,
    ClientAdminCredentialCreate,
    ClientAdminCredentialCreateConfig,
    ClientAdminCredentialUpdate,
    CredentialResolveRequest,
    LoginPasswordCredentialCreate,
    LoginPasswordCredentialCreateConfig,
    RequestBody,
    RequestDocumentInput,
    RequestExecuteRequest,
    RequestExecuteResponse,
    RequestHeaderField,
    RequestHeaderValue,
    RequestQueryParam,
    RequestSummary,
    VariableCreateRequest,
    VariableUpdateRequest,
)
from app.services import requests_exec
from app.services.requests_exec import (
    RequestsCredentialResolutionError,
    clear_history,
    delete_history_entry,
    execute,
    list_history,
    resolve_authorization,
)
from app.services.requests_store import (
    RequestsConflictError,
    RequestsEnvironmentNotFoundError,
    RequestsPathValidationError,
    _rename_variable_reference_text,
    create_credential,
    create_environment,
    create_folder,
    create_variable,
    delete_environment,
    delete_folder,
    delete_item,
    delete_variable,
    get_credential_raw,
    list_credentials,
    list_items,
    list_state,
    list_tree,
    move_item,
    read_item,
    reorder,
    resolve_variable_map,
    set_active_environment,
    update_credential,
    update_item,
    update_variable,
    write_item,
)

AUTH_HEADERS = {"Authorization": "Bearer valid-token", "X-QAA-TMS": "1"}


def build_settings(monkeypatch: pytest.MonkeyPatch, home: Path) -> Settings:
    monkeypatch.setenv("QAA_TMS_HOME", str(home))
    return Settings(_env_file=None)


def make_request_document(
    *,
    method: str = "GET",
    url: str = "https://example.test/resource",
    headers: list[RequestHeaderField] | None = None,
    query_params: list[RequestQueryParam] | None = None,
    body: RequestBody | None = None,
    credential_id: str | None = None,
) -> RequestDocumentInput:
    return RequestDocumentInput(
        method=method,
        url=url,
        headers=headers or [],
        query_params=query_params or [],
        body=body or RequestBody(),
        credential_id=credential_id,
    )


def make_jwt(exp: int) -> str:
    header = base64.urlsafe_b64encode(b'{"alg":"none","typ":"JWT"}').decode("utf-8").rstrip("=")
    payload = (
        base64.urlsafe_b64encode(json.dumps({"exp": exp}).encode("utf-8"))
        .decode("utf-8")
        .rstrip("=")
    )
    return f"{header}.{payload}.signature"


def make_app_state() -> SimpleNamespace:
    return SimpleNamespace(state=SimpleNamespace(requests_token_cache={}))


def build_backend_transport(denied_permissions: set[str]) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        auth = request.headers.get("Authorization")
        if request.url.path == BackendPath.ME.value:
            if auth == "Bearer valid-token":
                return httpx.Response(200, json={"id": 1, "username": "tester"})
            return httpx.Response(401, json={"detail": "Unauthorized"})
        if request.url.path == BackendPath.AUTHZ_CHECK.value:
            if auth != "Bearer valid-token":
                return httpx.Response(401, json={"detail": "Unauthorized"})
            payload = json.loads(request.content.decode("utf-8"))
            checks = payload.get("checks") if isinstance(payload, dict) else []
            results = []
            for check in checks if isinstance(checks, list) else []:
                if not isinstance(check, dict):
                    continue
                permission = check.get("permission")
                results.append(
                    {
                        "permission": permission,
                        "allowed": isinstance(permission, str)
                        and permission not in denied_permissions,
                    }
                )
            return httpx.Response(200, json={"results": results})
        return httpx.Response(404, json={"detail": "Not found"})

    return httpx.MockTransport(handler)


@asynccontextmanager
async def route_client(
    fake_staging_repo: dict[str, Path],
    denied_permissions: set[str],
) -> AsyncIterator[httpx.AsyncClient]:
    settings = Settings(
        AGENT_HOST="127.0.0.1",
        AGENT_PORT=47600,
        AGENT_BACKEND_URL="http://backend.test",
        AGENT_CORS_ORIGINS="http://localhost:3000,http://127.0.0.1:3000",
        AGENT_STAGING_BIN=str(fake_staging_repo["staging_bin"]),
        AGENT_STAGINGS_REPO=str(fake_staging_repo["repo_root"]),
    )
    application = create_app(
        settings, backend_transport=build_backend_transport(denied_permissions)
    )
    async with application.router.lifespan_context(application):
        transport = httpx.ASGITransport(app=application)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            yield client


class FakeAsyncClient:
    def __init__(self, responder: Any, calls: list[dict[str, Any]], **_: Any) -> None:
        self._responder = responder
        self._calls = calls

    async def __aenter__(self) -> FakeAsyncClient:
        return self

    async def __aexit__(self, exc_type: object, exc: object, tb: object) -> None:
        return None

    async def get(self, url: str, **kwargs: Any) -> httpx.Response:
        return await self.request("GET", url, **kwargs)

    async def post(self, url: str, **kwargs: Any) -> httpx.Response:
        return await self.request("POST", url, **kwargs)

    async def request(self, method: str, url: str, **kwargs: Any) -> httpx.Response:
        self._calls.append({"method": method, "url": url, "kwargs": kwargs})
        result = self._responder(method, url, kwargs)
        if isinstance(result, Exception):
            raise result
        return result


def patch_async_client(
    monkeypatch: pytest.MonkeyPatch,
    responder: Any,
) -> list[dict[str, Any]]:
    calls: list[dict[str, Any]] = []

    def factory(**kwargs: Any) -> FakeAsyncClient:
        return FakeAsyncClient(responder, calls, **kwargs)

    monkeypatch.setattr(requests_exec.httpx, "AsyncClient", factory)
    return calls


def make_response(
    method: str,
    url: str,
    *,
    headers: dict[str, str] | None = None,
    json_body: dict[str, Any] | None = None,
    text: str = "",
    status_code: int = 200,
) -> httpx.Response:
    request = httpx.Request(method, url)
    if json_body is not None:
        return httpx.Response(status_code, json=json_body, headers=headers, request=request)
    return httpx.Response(status_code, text=text, headers=headers, request=request)


def test_requests_paths_follow_qaa_tms_home(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    settings = build_settings(monkeypatch, tmp_path)

    assert settings.requests_root == str(tmp_path / "requests")
    assert settings.requests_collections_root == str(tmp_path / "requests" / "collections")
    assert settings.requests_credentials_path == str(tmp_path / "requests" / "credentials.json")
    assert settings.requests_environments_path == str(tmp_path / "requests" / "environments.json")
    assert settings.requests_history_path == str(tmp_path / "requests" / "history.jsonl")


def test_requests_collection_and_item_crud(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    settings = build_settings(monkeypatch, tmp_path)
    create_folder(settings, "alpha")
    create_folder(settings, "beta")
    create_folder(settings, "gamma")
    monkeypatch.setattr(
        "app.services.requests_store._current_item_base_name", lambda: "2026-08-25-14-30-05"
    )

    first = write_item(settings, "alpha", None, make_request_document(url="https://svc.test/one"))
    second = write_item(settings, "alpha", None, make_request_document(url="https://svc.test/two"))
    explicit = write_item(
        settings, "alpha", "clients", make_request_document(url="https://svc.test/clients")
    )

    assert first.name == "2026-08-25-14-30-05"
    assert second.name == "2026-08-25-14-30-05-1"
    assert explicit.name == "clients"

    items = list_items(settings, "alpha")
    assert {item.name for item in items.items} == {first.name, second.name, explicit.name}

    updated = update_item(
        settings,
        "alpha",
        explicit.name,
        make_request_document(method="POST", url="https://svc.test/clients/update"),
    )
    assert updated.method == "POST"
    assert updated.url == "https://svc.test/clients/update"

    move_item(settings, "alpha", "beta", explicit.name)
    moved = read_item(settings, "beta", explicit.name)
    assert moved.method == "POST"

    reorder(settings, ["gamma", "alpha"])
    tree = list_tree(settings)
    assert [folder.name for folder in tree.folders] == ["gamma", "alpha", "beta"]

    contents = json.loads(
        (tmp_path / "requests" / "collections" / "__contents__").read_text(encoding="utf-8")
    )
    assert contents[0]["name"] == "gamma"

    delete_item(settings, "beta", explicit.name)
    delete_folder(settings, "gamma")
    assert [folder.name for folder in list_tree(settings).folders] == ["alpha", "beta"]


def test_list_tree_returns_empty_when_store_never_initialized(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    settings = build_settings(monkeypatch, tmp_path)

    # No requests dir has been created yet: reading collections must be an empty
    # tree, not a hard error, so the UI can render and offer creation actions.
    assert list_tree(settings).folders == []


@pytest.mark.parametrize("folder_name", ["..", "nested/name", "nested\\name", "/tmp/evil"])
def test_requests_folder_path_traversal_is_rejected(
    folder_name: str,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    settings = build_settings(monkeypatch, tmp_path)

    with pytest.raises(RequestsPathValidationError):
        create_folder(settings, folder_name)


@pytest.mark.parametrize("item_name", ["..", "nested/name", "nested\\name", "/tmp/evil"])
def test_requests_item_path_traversal_is_rejected(
    item_name: str,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    settings = build_settings(monkeypatch, tmp_path)
    create_folder(settings, "alpha")

    with pytest.raises(RequestsPathValidationError):
        write_item(settings, "alpha", item_name, make_request_document())


def test_credentials_crud_returns_values_and_keeps_file_mode(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    settings = build_settings(monkeypatch, tmp_path)
    bearer = create_credential(
        settings,
        BearerCredentialCreate(
            name="raw bearer", type="bearer", config=BearerCredentialCreateConfig(token="raw-token")
        ),
    )
    create_credential(
        settings,
        ApiKeyPermanentCredentialCreate(
            name="perm",
            type="api_key_permanent",
            config=ApiKeyPermanentCredentialCreateConfig(
                permanent_token="permanent",
                verify_url="https://iam.test/auth/verify",
                scheme="APIKey",
            ),
        ),
    )
    create_credential(
        settings,
        LoginPasswordCredentialCreate(
            name="login",
            type="login_password",
            config=LoginPasswordCredentialCreateConfig(
                login_url="https://iam.test/login",
                username="user",
                password="secret",
                referer="https://iam.test",
            ),
        ),
    )
    create_credential(
        settings,
        ClientAdminCredentialCreate(
            name="client",
            type="client_admin",
            config=ClientAdminCredentialCreateConfig(
                admin_credential_id=bearer.id,
                admin_token_url="https://iam.test/token/{client_id}",
                client_id=42,
                issue_by_current_user=True,
            ),
        ),
    )

    public_credentials = [
        credential.model_dump(mode="python") for credential in list_credentials(settings)
    ]
    assert len(public_credentials) == 4
    assert any(
        credential["config"].get("token") == "raw-token" for credential in public_credentials
    )
    assert any(
        credential["config"].get("permanent_token") == "permanent"
        for credential in public_credentials
    )
    assert any(
        credential["config"].get("password") == "secret" for credential in public_credentials
    )

    updated_name_only = update_credential(
        settings,
        bearer.id,
        BearerCredentialUpdate(
            name="renamed",
            type="bearer",
            config=BearerCredentialUpdateConfig(),
        ),
    )
    assert updated_name_only.name == "renamed"
    assert get_credential_raw(settings, bearer.id)["config"]["token"] == "raw-token"

    updated_bearer = update_credential(
        settings,
        bearer.id,
        BearerCredentialUpdate(
            type="bearer",
            config=BearerCredentialUpdateConfig(token=""),
        ),
    )
    assert updated_bearer.config.token == ""
    assert get_credential_raw(settings, bearer.id)["config"]["token"] == ""

    mode = stat.S_IMODE(Path(settings.requests_credentials_path).stat().st_mode)
    assert mode == 0o600


def test_rename_variable_reference_text_matches_frontend_template_semantics() -> None:
    assert _rename_variable_reference_text(
        "{{ base }} {{base}} {{Base}} {{base_url}}",
        "base",
        "host",
    ) == ("{{host}} {{host}} {{Base}} {{base_url}}")
    assert _rename_variable_reference_text(
        "prefix {{ base }}/{{base}} suffix",
        "base",
        "host",
    ) == ("prefix {{host}}/{{host}} suffix")


def test_resolve_variable_map_uses_active_environment_and_ignores_empty_values(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    settings = build_settings(monkeypatch, tmp_path)
    staging = create_environment(settings, "staging").environments[0]
    prod = create_environment(settings, "prod").environments[1]
    create_variable(
        settings,
        VariableCreateRequest(
            key="systemadmin_token",
            secret=True,
            values={
                staging.id: "staging-token",
                prod.id: "prod-token",
            },
        ),
    )
    create_variable(
        settings,
        VariableCreateRequest(
            key="disabled",
            enabled=False,
            values={staging.id: "ignored"},
        ),
    )
    create_variable(
        settings,
        VariableCreateRequest(
            key="blank",
            values={staging.id: ""},
        ),
    )

    set_active_environment(settings, staging.id)

    assert resolve_variable_map(settings, None) == {"systemadmin_token": "staging-token"}
    assert resolve_variable_map(settings, prod.id) == {"systemadmin_token": "prod-token"}
    assert resolve_variable_map(settings, "missing-env") == {}


def test_requests_state_crud_persists_active_and_drops_deleted_env_cells(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    settings = build_settings(monkeypatch, tmp_path)

    created = create_environment(settings, " staging ")
    assert created.active_id is None
    assert len(created.environments) == 1
    staging_environment = created.environments[0]
    assert staging_environment.name == "staging"

    with_variable = create_variable(
        settings,
        VariableCreateRequest(
            key=" iamBase ",
            values={
                staging_environment.id: "https://stg.test",
                "missing-env": "https://ignored.test",
            },
        ),
    )
    assert with_variable.variables[0].key == "iamBase"
    assert with_variable.variables[0].secret is False
    assert with_variable.variables[0].enabled is True
    assert with_variable.variables[0].values == {
        staging_environment.id: "https://stg.test",
    }

    with_prod = create_environment(settings, "prod")
    prod_environment = with_prod.environments[1]
    variable_id = with_prod.variables[0].id

    updated_variable = update_variable(
        settings,
        variable_id,
        VariableUpdateRequest(
            secret=True,
            values={
                staging_environment.id: "https://stg.test",
                prod_environment.id: "https://prod.test",
            },
        ),
    )
    assert updated_variable.variables[0].secret is True
    assert updated_variable.variables[0].values == {
        staging_environment.id: "https://stg.test",
        prod_environment.id: "https://prod.test",
    }

    activated = set_active_environment(settings, prod_environment.id)
    assert activated.active_id == prod_environment.id

    deleted_environment = delete_environment(settings, prod_environment.id)
    assert deleted_environment.active_id is None
    assert [environment.name for environment in deleted_environment.environments] == ["staging"]
    assert deleted_environment.variables[0].values == {
        staging_environment.id: "https://stg.test",
    }

    deleted_variable = delete_variable(settings, variable_id)
    assert deleted_variable.variables == []

    mode = stat.S_IMODE(Path(settings.requests_environments_path).stat().st_mode)
    assert mode == 0o600

    payload = json.loads(Path(settings.requests_environments_path).read_text(encoding="utf-8"))
    assert payload["activeId"] is None
    assert payload["variables"] == []
    assert payload["environments"][0]["id"] == staging_environment.id
    assert payload["environments"][0]["name"] == "staging"


def test_requests_state_migrates_legacy_environment_shape(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    settings = build_settings(monkeypatch, tmp_path)
    path = Path(settings.requests_environments_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "activeId": "env-preprod",
                "environments": [
                    {
                        "id": "env-staging",
                        "name": "staging",
                        "variables": [
                            {"key": "iamBase", "value": "https://stg.old", "enabled": False},
                            {"key": "iamBase", "value": "https://stg.new", "enabled": True},
                            {"key": "verifyBase", "value": "https://verify.stg", "enabled": False},
                        ],
                        "createdAt": "2026-08-29T08:00:00Z",
                        "updatedAt": "2026-08-29T09:00:00Z",
                    },
                    {
                        "id": "env-preprod",
                        "name": "preprod",
                        "variables": [
                            {"key": "iamBase", "value": "https://preprod.test", "enabled": True},
                            {"key": "token", "value": "secret", "enabled": False},
                        ],
                        "createdAt": "2026-08-29T10:00:00Z",
                        "updatedAt": "2026-08-29T11:00:00Z",
                    },
                ],
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    state = list_state(settings)

    assert state.active_id == "env-preprod"
    assert [environment.name for environment in state.environments] == ["staging", "preprod"]
    assert [variable.key for variable in state.variables] == ["iamBase", "verifyBase", "token"]
    assert state.variables[0].enabled is True
    assert state.variables[0].secret is False
    assert state.variables[0].values == {
        "env-staging": "https://stg.new",
        "env-preprod": "https://preprod.test",
    }
    assert state.variables[1].enabled is False
    assert state.variables[1].values == {"env-staging": "https://verify.stg"}
    assert state.variables[2].enabled is False
    assert state.variables[2].values == {"env-preprod": "secret"}
    migrated_variable_ids = [variable.id for variable in state.variables]
    reloaded_state = list_state(settings)

    assert [variable.id for variable in reloaded_state.variables] == migrated_variable_ids

    updated_state = update_variable(
        settings,
        migrated_variable_ids[0],
        VariableUpdateRequest(
            values={
                "env-staging": "https://stg.updated",
                "env-preprod": "https://preprod.updated",
            },
        ),
    )
    assert next(
        variable.values
        for variable in updated_state.variables
        if variable.id == migrated_variable_ids[0]
    ) == {
        "env-staging": "https://stg.updated",
        "env-preprod": "https://preprod.updated",
    }

    deleted_state = delete_variable(settings, migrated_variable_ids[1])
    assert [variable.id for variable in deleted_state.variables] == [
        migrated_variable_ids[0],
        migrated_variable_ids[2],
    ]


def test_create_variable_rejects_duplicate_keys(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    settings = build_settings(monkeypatch, tmp_path)
    environment = create_environment(settings, "staging").environments[0]

    create_variable(
        settings,
        VariableCreateRequest(
            key="iamBase",
            values={environment.id: "https://stg.test"},
        ),
    )

    with pytest.raises(RequestsConflictError):
        create_variable(
            settings,
            VariableCreateRequest(
                key=" iamBase ",
                values={environment.id: "https://duplicate.test"},
            ),
        )

    second_state = create_variable(
        settings,
        VariableCreateRequest(key="verifyBase"),
    )
    verify_variable_id = next(
        variable.id for variable in second_state.variables if variable.key == "verifyBase"
    )

    with pytest.raises(RequestsConflictError):
        update_variable(
            settings,
            verify_variable_id,
            VariableUpdateRequest(key="iamBase"),
        )


def test_update_variable_renames_request_and_credential_references(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    settings = build_settings(monkeypatch, tmp_path)
    environment = create_environment(settings, "staging").environments[0]
    variable_id = (
        create_variable(
            settings,
            VariableCreateRequest(
                key="base",
                values={environment.id: "https://stg.test"},
            ),
        )
        .variables[0]
        .id
    )
    create_folder(settings, "Alpha")
    write_item(
        settings,
        "Alpha",
        "Request",
        make_request_document(
            url="{{ base }}/users/{{base_url}}",
            headers=[
                RequestHeaderField(
                    enabled=True,
                    name="X-{{ base }}",
                    value="Bearer {{base}} {{Base}}",
                ),
            ],
            query_params=[
                RequestQueryParam(
                    enabled=True,
                    name="{{ base }}",
                    value="next={{base}}&keep={{base_url}}",
                ),
            ],
            body=RequestBody(
                mode="raw",
                content='{"host":"{{ base }}","keep":"{{base_url}}","case":"{{Base}}"}',
            ),
        ),
    )
    credential = create_credential(
        settings,
        BearerCredentialCreate(
            name="Bearer {{base}}",
            type="bearer",
            config=BearerCredentialCreateConfig(token="token {{base}} {{Base}}"),
        ),
    )

    updated_state = update_variable(settings, variable_id, VariableUpdateRequest(key="host"))

    assert updated_state.renamed_references == 2
    assert (
        next(variable.key for variable in updated_state.variables if variable.id == variable_id)
        == "host"
    )

    saved_request = read_item(settings, "Alpha", "Request")
    assert saved_request.url == "{{host}}/users/{{base_url}}"
    assert saved_request.headers == [
        RequestHeaderField(enabled=True, name="X-{{host}}", value="Bearer {{host}} {{Base}}")
    ]
    assert saved_request.query_params == [
        RequestQueryParam(enabled=True, name="{{host}}", value="next={{host}}&keep={{base_url}}")
    ]
    assert (
        saved_request.body.content == '{"host":"{{host}}","keep":"{{base_url}}","case":"{{Base}}"}'
    )

    saved_credential = get_credential_raw(settings, credential.id)
    assert saved_credential["name"] == "Bearer {{host}}"
    assert saved_credential["config"]["token"] == "token {{host}} {{Base}}"


def test_update_variable_rejects_existing_key_before_rewriting_references(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    settings = build_settings(monkeypatch, tmp_path)
    environment = create_environment(settings, "staging").environments[0]
    base_variable_id = (
        create_variable(
            settings,
            VariableCreateRequest(
                key="base",
                values={environment.id: "https://stg.test"},
            ),
        )
        .variables[0]
        .id
    )
    create_variable(settings, VariableCreateRequest(key="host"))
    create_folder(settings, "Alpha")
    write_item(
        settings,
        "Alpha",
        "Request",
        make_request_document(
            url="{{base}}/users",
            headers=[RequestHeaderField(enabled=True, name="X-Test", value="{{ base }}")],
            body=RequestBody(mode="raw", content='{"host":"{{base}}"}'),
        ),
    )
    credential = create_credential(
        settings,
        BearerCredentialCreate(
            name="Bearer",
            type="bearer",
            config=BearerCredentialCreateConfig(token="{{base}}"),
        ),
    )

    with pytest.raises(RequestsConflictError, match="Variable already exists: host"):
        update_variable(settings, base_variable_id, VariableUpdateRequest(key="host"))

    saved_request = read_item(settings, "Alpha", "Request")
    assert saved_request.url == "{{base}}/users"
    assert saved_request.headers == [
        RequestHeaderField(enabled=True, name="X-Test", value="{{ base }}")
    ]
    assert saved_request.body.content == '{"host":"{{base}}"}'
    assert get_credential_raw(settings, credential.id)["config"]["token"] == "{{base}}"
    assert [variable.key for variable in list_state(settings).variables] == ["base", "host"]


def test_set_active_environment_rejects_unknown_and_can_clear(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    settings = build_settings(monkeypatch, tmp_path)
    created = create_environment(settings, "prod")
    environment_id = created.environments[0].id

    active = set_active_environment(settings, environment_id)
    assert active.active_id == environment_id

    cleared = set_active_environment(settings, None)
    assert cleared.active_id is None

    with pytest.raises(RequestsEnvironmentNotFoundError):
        set_active_environment(settings, "missing-env")

    listed = list_state(settings)
    assert listed.active_id is None
    assert [environment.name for environment in listed.environments] == ["prod"]


def test_requests_execute_and_resolve_payloads_accept_environment_id() -> None:
    resolve_request = CredentialResolveRequest.model_validate(
        {"credentialId": "cred-1", "environmentId": "env-prod", "force": True}
    )
    execute_request = RequestExecuteRequest.model_validate(
        {
            "method": "GET",
            "url": "https://svc.test",
            "headers": [],
            "queryParams": [],
            "body": {"mode": "none", "content": ""},
            "credentialId": None,
            "environmentId": "env-prod",
        }
    )

    assert resolve_request.environment_id == "env-prod"
    assert resolve_request.force is True
    assert execute_request.environment_id == "env-prod"


@pytest.mark.asyncio
async def test_resolve_authorization_resolves_templates_per_environment_and_cache(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    settings = build_settings(monkeypatch, tmp_path)
    staging = create_environment(settings, "staging").environments[0]
    prod = create_environment(settings, "prod").environments[1]
    set_active_environment(settings, staging.id)

    create_variable(
        settings,
        VariableCreateRequest(
            key="systemadmin_token",
            secret=True,
            values={staging.id: "staging-admin", prod.id: "prod-admin"},
        ),
    )
    create_variable(
        settings,
        VariableCreateRequest(
            key="iamBase",
            values={
                staging.id: "https://staging.iam.test",
                prod.id: "https://prod.iam.test",
            },
        ),
    )
    create_variable(
        settings,
        VariableCreateRequest(
            key="iamUser",
            values={staging.id: "stage-user", prod.id: "prod-user"},
        ),
    )
    create_variable(
        settings,
        VariableCreateRequest(
            key="iamPassword",
            secret=True,
            values={staging.id: "stage-pass", prod.id: "prod-pass"},
        ),
    )

    admin = create_credential(
        settings,
        BearerCredentialCreate(
            name="admin",
            type="bearer",
            config=BearerCredentialCreateConfig(token="{{systemadmin_token}}"),
        ),
    )
    login = create_credential(
        settings,
        LoginPasswordCredentialCreate(
            name="login",
            type="login_password",
            config=LoginPasswordCredentialCreateConfig(
                login_url="{{iamBase}}/login",
                username="{{ iamUser }}",
                password="{{iamPassword}}",
                referer="{{iamBase}}/portal",
            ),
        ),
    )
    client_admin = create_credential(
        settings,
        ClientAdminCredentialCreate(
            name="client",
            type="client_admin",
            config=ClientAdminCredentialCreateConfig(
                admin_credential_id=admin.id,
                admin_token_url="{{iamBase}}/admin/{client_id}",
                client_id=77,
                issue_by_current_user=False,
            ),
        ),
    )

    now = int(time.time())
    stage_login_token = make_jwt(now + 3600)
    prod_login_token = make_jwt(now + 3600)
    prod_client_token = make_jwt(now + 3600)

    def responder(method: str, url: str, kwargs: dict[str, Any]) -> httpx.Response:
        if method == "POST" and url == "https://staging.iam.test/login":
            assert kwargs["headers"]["Referer"] == "https://staging.iam.test/portal"
            assert kwargs["json"] == {"username": "stage-user", "password": "stage-pass"}
            return make_response(method, url, json_body={"access": stage_login_token})
        if method == "POST" and url == "https://prod.iam.test/login":
            assert kwargs["headers"]["Referer"] == "https://prod.iam.test/portal"
            assert kwargs["json"] == {"username": "prod-user", "password": "prod-pass"}
            return make_response(method, url, json_body={"access": prod_login_token})
        if method == "GET" and url == "https://prod.iam.test/admin/77":
            assert kwargs["headers"]["Authorization"] == "Bearer prod-admin"
            assert kwargs["params"]["issue_by_current_user"] == "false"
            return make_response(method, url, json_body={"access": prod_client_token})
        raise AssertionError(f"Unexpected request: {method} {url}")

    calls = patch_async_client(monkeypatch, responder)
    app = make_app_state()

    assert await resolve_authorization(app, settings, admin.id) == "Bearer staging-admin"
    prod_admin = await resolve_authorization(app, settings, admin.id, environment_id=prod.id)
    assert prod_admin == "Bearer prod-admin"

    first_stage_login = await resolve_authorization(
        app, settings, login.id, environment_id=staging.id
    )
    first_prod_login = await resolve_authorization(app, settings, login.id, environment_id=prod.id)
    second_stage_login = await resolve_authorization(
        app, settings, login.id, environment_id=staging.id
    )
    client_auth = await resolve_authorization(
        app, settings, client_admin.id, environment_id=prod.id
    )

    assert first_stage_login == second_stage_login == f"Bearer {stage_login_token}"
    assert first_prod_login == f"Bearer {prod_login_token}"
    assert client_auth == f"Bearer {prod_client_token}"
    assert sum(1 for call in calls if call["url"] == "https://staging.iam.test/login") == 1
    assert sum(1 for call in calls if call["url"] == "https://prod.iam.test/login") == 1
    assert sum(1 for call in calls if call["url"] == "https://prod.iam.test/admin/77") == 1


@pytest.mark.asyncio
async def test_resolve_authorization_flows_and_cache(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    settings = build_settings(monkeypatch, tmp_path)
    now = int(time.time())
    verify_token = make_jwt(now + 3600)
    login_token = make_jwt(now + 3600)
    client_token = make_jwt(now + 3600)
    near_exp_token = make_jwt(now + 10)

    admin = create_credential(
        settings,
        BearerCredentialCreate(
            name="admin", type="bearer", config=BearerCredentialCreateConfig(token="admin-token")
        ),
    )
    api_key = create_credential(
        settings,
        ApiKeyPermanentCredentialCreate(
            name="perm",
            type="api_key_permanent",
            config=ApiKeyPermanentCredentialCreateConfig(
                permanent_token="perm-token",
                verify_url="https://iam.test/verify",
                scheme="APIKey",
            ),
        ),
    )
    near_exp = create_credential(
        settings,
        ApiKeyPermanentCredentialCreate(
            name="near",
            type="api_key_permanent",
            config=ApiKeyPermanentCredentialCreateConfig(
                permanent_token="near-token",
                verify_url="https://iam.test/near",
                scheme="APIKey",
            ),
        ),
    )
    login = create_credential(
        settings,
        LoginPasswordCredentialCreate(
            name="login",
            type="login_password",
            config=LoginPasswordCredentialCreateConfig(
                login_url="https://iam.test/login",
                username="user",
                password="secret",
                referer="https://iam.test",
            ),
        ),
    )
    client_admin = create_credential(
        settings,
        ClientAdminCredentialCreate(
            name="client",
            type="client_admin",
            config=ClientAdminCredentialCreateConfig(
                admin_credential_id=admin.id,
                admin_token_url="https://iam.test/admin/{client_id}",
                client_id=77,
                issue_by_current_user=True,
            ),
        ),
    )

    def responder(method: str, url: str, kwargs: dict[str, Any]) -> httpx.Response:
        if method == "GET" and url == "https://iam.test/verify":
            assert kwargs["headers"]["Authorization"] == "APIKey perm-token"
            return make_response(method, url, headers={"authorization": f"Bearer {verify_token}"})
        if method == "GET" and url == "https://iam.test/near":
            return make_response(method, url, headers={"authorization": f"Bearer {near_exp_token}"})
        if method == "POST" and url == "https://iam.test/login":
            assert kwargs["headers"]["Referer"] == "https://iam.test"
            return make_response(method, url, json_body={"access": login_token})
        if method == "GET" and url == "https://iam.test/admin/77":
            assert kwargs["headers"]["Authorization"] == "Bearer admin-token"
            assert kwargs["params"]["issue_by_current_user"] == "true"
            return make_response(method, url, json_body={"access": client_token})
        raise AssertionError(f"Unexpected request: {method} {url}")

    calls = patch_async_client(monkeypatch, responder)
    app = make_app_state()

    first = await resolve_authorization(app, settings, api_key.id)
    second = await resolve_authorization(app, settings, api_key.id)
    forced = await resolve_authorization(app, settings, api_key.id, force=True)
    login_auth = await resolve_authorization(app, settings, login.id)
    client_auth = await resolve_authorization(app, settings, client_admin.id)
    near_first = await resolve_authorization(app, settings, near_exp.id)
    near_second = await resolve_authorization(app, settings, near_exp.id)

    assert first == second == forced == f"Bearer {verify_token}"
    assert login_auth == f"Bearer {login_token}"
    assert client_auth == f"Bearer {client_token}"
    assert near_first == near_second == f"Bearer {near_exp_token}"
    assert sum(1 for call in calls if call["url"] == "https://iam.test/verify") == 2
    assert sum(1 for call in calls if call["url"] == "https://iam.test/near") == 2


@pytest.mark.asyncio
async def test_resolve_authorization_rejects_unresolved_credential_variables(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    settings = build_settings(monkeypatch, tmp_path)
    environment = create_environment(settings, "staging").environments[0]
    set_active_environment(settings, environment.id)
    create_variable(
        settings,
        VariableCreateRequest(
            key="iamBase",
            values={environment.id: "https://staging.iam.test"},
        ),
    )
    login = create_credential(
        settings,
        LoginPasswordCredentialCreate(
            name="login",
            type="login_password",
            config=LoginPasswordCredentialCreateConfig(
                login_url="{{iamBase}}/login",
                username="user",
                password="{{missing_password}}",
                referer="{{iamBase}}/portal",
            ),
        ),
    )

    calls = patch_async_client(monkeypatch, lambda method, url, kwargs: make_response(method, url))

    with pytest.raises(RequestsCredentialResolutionError, match="missing_password"):
        await resolve_authorization(make_app_state(), settings, login.id)

    assert calls == []


@pytest.mark.asyncio
async def test_resolve_authorization_reports_missing_admin_and_cycle(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    settings = build_settings(monkeypatch, tmp_path)
    missing_admin = create_credential(
        settings,
        ClientAdminCredentialCreate(
            name="missing",
            type="client_admin",
            config=ClientAdminCredentialCreateConfig(
                admin_credential_id="missing-id",
                admin_token_url="https://iam.test/admin/{client_id}",
                client_id=1,
                issue_by_current_user=True,
            ),
        ),
    )
    first = create_credential(
        settings,
        ClientAdminCredentialCreate(
            name="first",
            type="client_admin",
            config=ClientAdminCredentialCreateConfig(
                admin_credential_id="placeholder",
                admin_token_url="https://iam.test/admin/{client_id}",
                client_id=2,
                issue_by_current_user=True,
            ),
        ),
    )
    second = create_credential(
        settings,
        ClientAdminCredentialCreate(
            name="second",
            type="client_admin",
            config=ClientAdminCredentialCreateConfig(
                admin_credential_id=first.id,
                admin_token_url="https://iam.test/admin/{client_id}",
                client_id=3,
                issue_by_current_user=True,
            ),
        ),
    )
    update_credential(
        settings,
        first.id,
        ClientAdminCredentialUpdate.model_validate(
            {
                "type": "client_admin",
                "config": {"admin_credential_id": second.id},
            }
        ),
    )
    patch_async_client(monkeypatch, lambda method, url, kwargs: make_response(method, url))
    app = make_app_state()

    with pytest.raises(RequestsCredentialResolutionError, match="Admin credential not found"):
        await resolve_authorization(app, settings, missing_admin.id)

    with pytest.raises(RequestsCredentialResolutionError, match="cycle"):
        await resolve_authorization(app, settings, first.id)


@pytest.mark.asyncio
async def test_execute_injects_headers_redacts_history_and_handles_network_error(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    settings = build_settings(monkeypatch, tmp_path)
    credential = create_credential(
        settings,
        BearerCredentialCreate(
            name="bearer", type="bearer", config=BearerCredentialCreateConfig(token="secret-token")
        ),
    )

    def responder(method: str, url: str, kwargs: dict[str, Any]) -> httpx.Response | Exception:
        if url == "https://svc.test/fail":
            return httpx.ReadTimeout("timeout", request=httpx.Request(method, url))
        return make_response(
            method,
            url,
            headers={"Content-Type": "application/json"},
            text='{"ok": true}',
        )

    calls = patch_async_client(monkeypatch, responder)
    app = make_app_state()

    result = await execute(
        app,
        settings,
        make_request_document(
            method="POST",
            url="https://svc.test/ok",
            headers=[
                RequestHeaderField(name="Accept", value="application/json", enabled=True),
                RequestHeaderField(name="Authorization", value="manual-secret", enabled=False),
                RequestHeaderField(name="X-Ignored", value="ignored", enabled=False),
            ],
            query_params=[
                RequestQueryParam(name="active", value="1", enabled=True),
                RequestQueryParam(name="ignored", value="0", enabled=False),
            ],
            body=RequestBody(mode="json", content='{"hello": true}'),
            credential_id=credential.id,
        ),
    )
    manual = await execute(
        app,
        settings,
        make_request_document(
            method="GET",
            url="https://svc.test/manual",
            headers=[RequestHeaderField(name="Authorization", value="Bearer manual", enabled=True)],
            credential_id=credential.id,
        ),
    )
    failed = await execute(
        app,
        settings,
        make_request_document(method="GET", url="https://svc.test/fail"),
    )

    sent_headers = dict(calls[0]["kwargs"]["headers"])
    assert sent_headers["Authorization"] == "Bearer secret-token"
    assert sent_headers["Content-Type"] == "application/json"
    assert "X-Request-ID" in sent_headers
    result_auth = next(
        header for header in result.request_summary.headers if header.name == "Authorization"
    )
    assert result_auth.value == "***"
    assert result.request_summary.query_params == [RequestHeaderValue(name="active", value="1")]

    manual_headers = dict(calls[1]["kwargs"]["headers"])
    assert manual_headers["Authorization"] == "Bearer manual"
    assert manual.request_summary.headers[0].value == "***"

    assert failed.status_code is None
    assert failed.error is not None

    history = list_history(settings)
    assert len(history.entries) == 3
    assert history.entries[0].request_summary.url == "https://svc.test/fail"
    assert all(
        header.value == "***"
        for entry in history.entries
        for header in entry.request_summary.headers
        if header.name == "Authorization"
    )


def test_history_is_capped_and_can_delete_and_clear(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    settings = build_settings(monkeypatch, tmp_path)
    monkeypatch.setattr(requests_exec, "REQUESTS_HISTORY_LIMIT", 3)

    for index in range(5):
        requests_exec._append_history(
            settings,
            RequestExecuteResponse(
                status_code=200,
                reason_phrase="OK",
                elapsed_ms=index,
                size_bytes=index,
                headers=[],
                body_text="",
                truncated=False,
                error=None,
                request_summary=RequestSummary(
                    method="GET",
                    url=f"https://svc.test/{index}",
                    headers=[],
                    query_params=[],
                ),
            ),
        )

    history = list_history(settings)
    assert [entry.request_summary.url for entry in history.entries] == [
        "https://svc.test/4",
        "https://svc.test/3",
        "https://svc.test/2",
    ]

    delete_history_entry(settings, history.entries[1].id)
    assert len(list_history(settings).entries) == 2

    clear_history(settings)
    assert list_history(settings).entries == []


READ_ROUTE_CASES = [
    ("get", AgentPath.REQUESTS_COLLECTIONS.value, {}),
    ("get", AgentPath.REQUESTS_ITEM.value, {"params": {"folder": "alpha"}}),
    ("get", f"{AgentPath.REQUESTS_ITEM.value}/item", {"params": {"folder": "alpha"}}),
    ("get", AgentPath.REQUESTS_ENVIRONMENTS.value, {}),
    ("get", AgentPath.REQUESTS_CREDENTIALS.value, {}),
    ("get", f"{AgentPath.REQUESTS_CREDENTIALS.value}/cred", {}),
    ("get", AgentPath.REQUESTS_HISTORY.value, {}),
]

WRITE_ROUTE_CASES = [
    (
        "put",
        AgentPath.REQUESTS_COLLECTIONS.value,
        {"json": {"folders": [{"name": "alpha", "children": [], "flags": {}, "items": {}}]}},
    ),
    ("patch", AgentPath.REQUESTS_COLLECTIONS.value, {"json": {"folders": ["alpha"]}}),
    ("post", AgentPath.REQUESTS_FOLDER.value, {"json": {"name": "alpha", "flags": {}}}),
    ("put", AgentPath.REQUESTS_FOLDER.value, {"json": {"folder": "alpha", "name": "beta"}}),
    ("delete", AgentPath.REQUESTS_FOLDER.value, {"params": {"folder": "alpha"}}),
    (
        "post",
        AgentPath.REQUESTS_ITEM.value,
        {
            "json": {
                "folder": "alpha",
                "method": "GET",
                "url": "https://svc.test",
                "headers": [],
                "query_params": [],
                "body": {"mode": "none", "content": ""},
                "credential_id": None,
            }
        },
    ),
    (
        "put",
        f"{AgentPath.REQUESTS_ITEM.value}/item",
        {
            "params": {"folder": "alpha"},
            "json": {"folder": "alpha", "url": "https://svc.test/updated"},
        },
    ),
    ("delete", f"{AgentPath.REQUESTS_ITEM.value}/item", {"params": {"folder": "alpha"}}),
    ("post", AgentPath.REQUESTS_ENVIRONMENTS.value, {"json": {"name": "staging"}}),
    (
        "post",
        AgentPath.REQUESTS_VARIABLES.value,
        {
            "json": {
                "key": "iamBase",
                "enabled": True,
                "secret": False,
                "values": {"env": "https://stg"},
            }
        },
    ),
    ("put", AgentPath.REQUESTS_ENVIRONMENT_ACTIVE.value, {"json": {"environmentId": None}}),
    ("put", f"{AgentPath.REQUESTS_ENVIRONMENTS.value}/env", {"json": {"name": "prod"}}),
    ("put", f"{AgentPath.REQUESTS_VARIABLES.value}/var", {"json": {"enabled": False}}),
    ("delete", f"{AgentPath.REQUESTS_ENVIRONMENTS.value}/env", {}),
    ("delete", f"{AgentPath.REQUESTS_VARIABLES.value}/var", {}),
    (
        "post",
        AgentPath.REQUESTS_CREDENTIALS.value,
        {"json": {"name": "cred", "type": "bearer", "config": {"token": "secret"}}},
    ),
    (
        "put",
        f"{AgentPath.REQUESTS_CREDENTIALS.value}/cred",
        {"json": {"type": "bearer", "config": {"token": "updated"}}},
    ),
    ("delete", f"{AgentPath.REQUESTS_CREDENTIALS.value}/cred", {}),
    (
        "post",
        AgentPath.REQUESTS_CREDENTIAL_RESOLVE.value,
        {"json": {"credential_id": "cred", "force": False}},
    ),
    (
        "post",
        AgentPath.REQUESTS_EXECUTE.value,
        {
            "json": {
                "method": "GET",
                "url": "https://svc.test",
                "headers": [],
                "query_params": [],
                "body": {"mode": "none", "content": ""},
                "credential_id": None,
            }
        },
    ),
    ("delete", AgentPath.REQUESTS_HISTORY.value, {}),
    ("delete", f"{AgentPath.REQUESTS_HISTORY.value}/entry", {}),
]


@pytest.mark.asyncio
@pytest.mark.parametrize(("method", "path", "kwargs"), READ_ROUTE_CASES)
async def test_requests_read_routes_require_auth(
    fake_staging_repo: dict[str, Path],
    method: str,
    path: str,
    kwargs: dict[str, Any],
) -> None:
    async with route_client(fake_staging_repo, denied_permissions=set()) as client:
        response = await getattr(client, method)(path, **kwargs)
        assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.parametrize(("method", "path", "kwargs"), WRITE_ROUTE_CASES)
async def test_requests_write_routes_require_auth(
    fake_staging_repo: dict[str, Path],
    method: str,
    path: str,
    kwargs: dict[str, Any],
) -> None:
    async with route_client(fake_staging_repo, denied_permissions=set()) as client:
        response = await getattr(client, method)(path, **kwargs)
        assert response.status_code == 401


@pytest.mark.asyncio
async def test_requests_credentials_unknown_type_returns_400(
    fake_staging_repo: dict[str, Path],
) -> None:
    async with route_client(fake_staging_repo, denied_permissions=set()) as client:
        response = await client.post(
            AgentPath.REQUESTS_CREDENTIALS.value,
            headers=AUTH_HEADERS,
            json={"name": "bad", "type": "unknown", "config": {}},
        )

    assert response.status_code == 400


@pytest.mark.asyncio
async def test_requests_state_routes_crud_and_active(
    fake_staging_repo: dict[str, Path],
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("QAA_TMS_HOME", str(tmp_path))

    async with route_client(fake_staging_repo, denied_permissions=set()) as client:
        create_staging_response = await client.post(
            AgentPath.REQUESTS_ENVIRONMENTS.value,
            headers=AUTH_HEADERS,
            json={"name": "staging"},
        )
        assert create_staging_response.status_code == 200
        staging_payload = create_staging_response.json()
        staging_id = staging_payload["environments"][0]["id"]
        assert staging_payload["activeId"] is None
        assert len(staging_payload["environments"]) == 1
        assert staging_payload["variables"] == []

        create_prod_response = await client.post(
            AgentPath.REQUESTS_ENVIRONMENTS.value,
            headers=AUTH_HEADERS,
            json={"name": "prod"},
        )
        assert create_prod_response.status_code == 200
        prod_payload = create_prod_response.json()
        prod_id = prod_payload["environments"][1]["id"]

        create_variable_response = await client.post(
            AgentPath.REQUESTS_VARIABLES.value,
            headers=AUTH_HEADERS,
            json={
                "key": "iamBase",
                "values": {
                    staging_id: "https://stg.test",
                    prod_id: "https://prod.test",
                },
            },
        )
        assert create_variable_response.status_code == 200
        variable_payload = create_variable_response.json()
        variable_id = variable_payload["variables"][0]["id"]
        assert variable_payload["variables"][0]["values"] == {
            staging_id: "https://stg.test",
            prod_id: "https://prod.test",
        }

        get_state_response = await client.get(
            AgentPath.REQUESTS_ENVIRONMENTS.value,
            headers=AUTH_HEADERS,
        )
        assert get_state_response.status_code == 200
        state_payload = get_state_response.json()
        assert [environment["name"] for environment in state_payload["environments"]] == [
            "staging",
            "prod",
        ]
        assert state_payload["variables"][0]["key"] == "iamBase"

        duplicate_response = await client.post(
            AgentPath.REQUESTS_VARIABLES.value,
            headers=AUTH_HEADERS,
            json={"key": " iamBase "},
        )
        assert duplicate_response.status_code == 409

        active_response = await client.put(
            AgentPath.REQUESTS_ENVIRONMENT_ACTIVE.value,
            headers=AUTH_HEADERS,
            json={"environmentId": staging_id},
        )
        assert active_response.status_code == 200
        assert active_response.json()["activeId"] == staging_id

        update_environment_response = await client.put(
            f"{AgentPath.REQUESTS_ENVIRONMENTS.value}/{staging_id}",
            headers=AUTH_HEADERS,
            json={"name": "preprod"},
        )
        assert update_environment_response.status_code == 200
        assert update_environment_response.json()["environments"][0]["name"] == "preprod"

        update_variable_response = await client.put(
            f"{AgentPath.REQUESTS_VARIABLES.value}/{variable_id}",
            headers=AUTH_HEADERS,
            json={
                "enabled": False,
                "secret": True,
                "values": {prod_id: "https://prod-only.test"},
            },
        )
        assert update_variable_response.status_code == 200
        updated_variable = update_variable_response.json()["variables"][0]
        assert updated_variable["enabled"] is False
        assert updated_variable["secret"] is True
        assert updated_variable["values"] == {prod_id: "https://prod-only.test"}

        clear_response = await client.put(
            AgentPath.REQUESTS_ENVIRONMENT_ACTIVE.value,
            headers=AUTH_HEADERS,
            json={"environmentId": None},
        )
        assert clear_response.status_code == 200
        assert clear_response.json()["activeId"] is None

        missing_response = await client.put(
            AgentPath.REQUESTS_ENVIRONMENT_ACTIVE.value,
            headers=AUTH_HEADERS,
            json={"environmentId": "missing-env"},
        )
        assert missing_response.status_code == 404

        delete_environment_response = await client.delete(
            f"{AgentPath.REQUESTS_ENVIRONMENTS.value}/{prod_id}",
            headers=AUTH_HEADERS,
        )
        assert delete_environment_response.status_code == 200
        deleted_environment_payload = delete_environment_response.json()
        assert [
            environment["name"] for environment in deleted_environment_payload["environments"]
        ] == ["preprod"]
        assert deleted_environment_payload["variables"][0]["values"] == {}

        delete_variable_response = await client.delete(
            f"{AgentPath.REQUESTS_VARIABLES.value}/{variable_id}",
            headers=AUTH_HEADERS,
        )
        assert delete_variable_response.status_code == 200
        deleted_variable_payload = delete_variable_response.json()
        assert deleted_variable_payload["activeId"] is None
        assert [
            environment["name"] for environment in deleted_variable_payload["environments"]
        ] == ["preprod"]
        assert deleted_variable_payload["variables"] == []
