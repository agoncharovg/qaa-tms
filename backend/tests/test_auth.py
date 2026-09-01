from __future__ import annotations

import jwt
from fastapi.testclient import TestClient

from app.core.constants import (
    DevPassword,
    DevUsername,
    JwtAlgorithm,
    JwtClaim,
    PluginId,
    RoutePath,
    TokenType,
)

DEFAULT_OPTIONAL_PLUGIN_IDS = [
    PluginId.STAGINGS.value,
    PluginId.KUBER.value,
    PluginId.QAA_GENERATOR.value,
    PluginId.JENKINS.value,
    PluginId.STATISTICS.value,
    PluginId.LEONID.value,
    PluginId.NOTIFICATOR.value,
]


def test_login_supports_admin_and_test_users(client: TestClient) -> None:
    admin_response = client.post(
        f"/api/v1{RoutePath.AUTH.value}{RoutePath.LOGIN.value}",
        json={"username": DevUsername.ADMIN.value, "password": DevPassword.ADMIN.value},
    )
    assert admin_response.status_code == 200
    admin_body = admin_response.json()
    assert admin_body["token_type"] == TokenType.BEARER.value
    assert admin_body["user"]["username"] == DevUsername.ADMIN.value
    assert admin_body["user"]["is_admin"] is True
    assert admin_body["user"]["enabled_plugins"] == DEFAULT_OPTIONAL_PLUGIN_IDS

    test_response = client.post(
        f"/api/v1{RoutePath.AUTH.value}{RoutePath.LOGIN.value}",
        json={"username": DevUsername.TEST.value, "password": DevPassword.EMPTY.value},
    )
    assert test_response.status_code == 200
    test_body = test_response.json()
    assert test_body["token_type"] == TokenType.BEARER.value
    assert test_body["user"]["username"] == DevUsername.TEST.value
    assert test_body["user"]["is_admin"] is False
    assert test_body["user"]["enabled_plugins"] == DEFAULT_OPTIONAL_PLUGIN_IDS


def test_login_emits_non_expiring_tokens_when_jwt_expiry_is_disabled(client: TestClient) -> None:
    client.app.state.settings.jwt_expire_minutes = 0

    response = client.post(
        f"/api/v1{RoutePath.AUTH.value}{RoutePath.LOGIN.value}",
        json={"username": DevUsername.ADMIN.value, "password": DevPassword.ADMIN.value},
    )

    assert response.status_code == 200
    token = response.json()["access_token"]
    payload = jwt.decode(
        token,
        client.app.state.settings.jwt_secret,
        algorithms=[JwtAlgorithm.HS256.value],
        options={"verify_exp": False},
    )
    assert payload[JwtClaim.SUBJECT.value] == DevUsername.ADMIN.value
    assert payload[JwtClaim.TOKEN_TYPE.value] == TokenType.BEARER.value
    assert JwtClaim.EXPIRES_AT.value not in payload


def test_me_requires_authentication(client: TestClient) -> None:
    response = client.get(f"/api/v1{RoutePath.ME.value}")
    assert response.status_code == 401


def test_me_returns_authenticated_user(client: TestClient) -> None:
    login_response = client.post(
        f"/api/v1{RoutePath.AUTH.value}{RoutePath.LOGIN.value}",
        json={"username": DevUsername.ADMIN.value, "password": DevPassword.ADMIN.value},
    )
    token = login_response.json()["access_token"]

    response = client.get(
        f"/api/v1{RoutePath.ME.value}",
        headers={"Authorization": f"{TokenType.BEARER.value.capitalize()} {token}"},
    )

    assert response.status_code == 200
    assert response.json()["username"] == DevUsername.ADMIN.value
    assert response.json()["enabled_plugins"] == DEFAULT_OPTIONAL_PLUGIN_IDS
