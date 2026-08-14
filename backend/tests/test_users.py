from __future__ import annotations

from typing import Any, cast

from fastapi.testclient import TestClient

from app.core.constants import DevPassword, DevUsername, OperationStatus, OperationType, PluginId

DEFAULT_OPTIONAL_PLUGIN_IDS = [
    PluginId.STAGINGS.value,
    PluginId.KUBER.value,
    PluginId.QAA_GENERATOR.value,
    PluginId.JENKINS.value,
]
QAA_GENERATOR_TOKEN_FIELD = "qaa_generator_token"
QAA_GENERATOR_TOKEN_SET_FIELD = "qaa_generator_token_set"


def login(client: TestClient, username: str, password: str) -> tuple[str, dict[str, Any]]:
    response = client.post(
        "/api/v1/auth/login",
        json={"username": username, "password": password},
    )
    assert response.status_code == 200
    body = cast(dict[str, Any], response.json())
    return str(body["access_token"]), cast(dict[str, Any], body["user"])


def auth_header(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def create_user(
    client: TestClient,
    token: str,
    username: str,
    *,
    password: str = "secret",
    display_name: str = "Created User",
    is_admin: bool = False,
    auto_login: bool = False,
) -> dict[str, Any]:
    response = client.post(
        "/api/v1/users",
        headers=auth_header(token),
        json={
            "username": username,
            "password": password,
            "display_name": display_name,
            "is_admin": is_admin,
            "auto_login": auto_login,
        },
    )
    assert response.status_code == 201
    return cast(dict[str, Any], response.json())


def assert_qaa_generator_token_is_masked(payload: dict[str, Any], *, token_set: bool) -> None:
    assert payload[QAA_GENERATOR_TOKEN_SET_FIELD] is token_set
    assert QAA_GENERATOR_TOKEN_FIELD not in payload


def test_non_admin_user_admin_endpoints_return_403(client: TestClient) -> None:
    token, _ = login(client, DevUsername.TEST.value, DevPassword.EMPTY.value)
    admin_token, admin_user = login(client, DevUsername.ADMIN.value, DevPassword.ADMIN.value)
    created_user = create_user(client, admin_token, "member-403")

    list_response = client.get("/api/v1/users", headers=auth_header(token))
    create_response = client.post(
        "/api/v1/users",
        headers=auth_header(token),
        json={
            "username": "denied-user",
            "password": "secret",
            "display_name": "Denied User",
        },
    )
    get_response = client.get(f"/api/v1/users/{admin_user['id']}", headers=auth_header(token))
    patch_response = client.patch(
        f"/api/v1/users/{created_user['id']}",
        headers=auth_header(token),
        json={"display_name": "Blocked"},
    )
    delete_response = client.delete(
        f"/api/v1/users/{created_user['id']}",
        headers=auth_header(token),
    )

    assert list_response.status_code == 403
    assert create_response.status_code == 403
    assert get_response.status_code == 403
    assert patch_response.status_code == 403
    assert delete_response.status_code == 403


def test_admin_can_list_create_get_and_login_as_created_user(client: TestClient) -> None:
    admin_token, _ = login(client, DevUsername.ADMIN.value, DevPassword.ADMIN.value)

    create_response = client.post(
        "/api/v1/users",
        headers=auth_header(admin_token),
        json={
            "username": "jane",
            "password": "p@ssword1",
            "display_name": "Jane Admin",
            "is_admin": True,
            "auto_login": True,
        },
    )

    assert create_response.status_code == 201
    created_user = cast(dict[str, Any], create_response.json())
    assert created_user["username"] == "jane"
    assert created_user["display_name"] == "Jane Admin"
    assert created_user["is_admin"] is True
    assert created_user["auto_login"] is True
    assert "password_hash" not in created_user
    assert_qaa_generator_token_is_masked(created_user, token_set=False)

    get_response = client.get(
        f"/api/v1/users/{created_user['id']}",
        headers=auth_header(admin_token),
    )
    assert get_response.status_code == 200
    assert get_response.json()["username"] == "jane"
    assert_qaa_generator_token_is_masked(cast(dict[str, Any], get_response.json()), token_set=False)

    list_response = client.get("/api/v1/users", headers=auth_header(admin_token))
    assert list_response.status_code == 200
    body = cast(dict[str, Any], list_response.json())
    assert body["total"] == 3
    assert [user["username"] for user in cast(list[dict[str, Any]], body["items"])] == [
        "test",
        "admin",
        "jane",
    ]
    for user in cast(list[dict[str, Any]], body["items"]):
        assert_qaa_generator_token_is_masked(user, token_set=False)

    login_response = client.post(
        "/api/v1/auth/login",
        json={"username": "jane", "password": "p@ssword1"},
    )
    assert login_response.status_code == 200
    assert login_response.json()["user"]["username"] == "jane"


def test_create_user_rejects_duplicate_username(client: TestClient) -> None:
    admin_token, _ = login(client, DevUsername.ADMIN.value, DevPassword.ADMIN.value)

    response = client.post(
        "/api/v1/users",
        headers=auth_header(admin_token),
        json={
            "username": DevUsername.TEST.value,
            "password": "secret",
            "display_name": "Duplicate User",
        },
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "Username already exists."


def test_patch_promotes_demotes_and_resets_password(client: TestClient) -> None:
    admin_token, _ = login(client, DevUsername.ADMIN.value, DevPassword.ADMIN.value)
    created_user = create_user(client, admin_token, "patch-target", password="before")

    promote_response = client.patch(
        f"/api/v1/users/{created_user['id']}",
        headers=auth_header(admin_token),
        json={"is_admin": True},
    )
    assert promote_response.status_code == 200
    assert promote_response.json()["is_admin"] is True

    demote_response = client.patch(
        f"/api/v1/users/{created_user['id']}",
        headers=auth_header(admin_token),
        json={"is_admin": False, "display_name": "Edited User", "auto_login": True},
    )
    assert demote_response.status_code == 200
    assert demote_response.json()["is_admin"] is False
    assert demote_response.json()["display_name"] == "Edited User"
    assert demote_response.json()["auto_login"] is True

    reset_response = client.patch(
        f"/api/v1/users/{created_user['id']}",
        headers=auth_header(admin_token),
        json={"password": "after"},
    )
    assert reset_response.status_code == 200

    old_login = client.post(
        "/api/v1/auth/login",
        json={"username": "patch-target", "password": "before"},
    )
    new_login = client.post(
        "/api/v1/auth/login",
        json={"username": "patch-target", "password": "after"},
    )
    assert old_login.status_code == 401
    assert new_login.status_code == 200


def test_update_schema_rejects_username_changes(client: TestClient) -> None:
    admin_token, _ = login(client, DevUsername.ADMIN.value, DevPassword.ADMIN.value)
    created_user = create_user(client, admin_token, "immutable-user")

    response = client.patch(
        f"/api/v1/users/{created_user['id']}",
        headers=auth_header(admin_token),
        json={"username": "renamed-user"},
    )

    assert response.status_code == 422


def test_user_lookup_returns_404_for_unknown_id(client: TestClient) -> None:
    admin_token, _ = login(client, DevUsername.ADMIN.value, DevPassword.ADMIN.value)

    response = client.get("/api/v1/users/9999", headers=auth_header(admin_token))

    assert response.status_code == 404
    assert response.json()["detail"] == "User not found."


def test_me_returns_enabled_plugins_default_for_seeded_user_and_me_plugins_is_self_service(
    client: TestClient,
) -> None:
    token, _ = login(client, DevUsername.TEST.value, DevPassword.EMPTY.value)

    me_response = client.get("/api/v1/me", headers=auth_header(token))
    plugins_response = client.get("/api/v1/me/plugins", headers=auth_header(token))

    assert me_response.status_code == 200
    assert me_response.json()["enabled_plugins"] == DEFAULT_OPTIONAL_PLUGIN_IDS
    assert_qaa_generator_token_is_masked(cast(dict[str, Any], me_response.json()), token_set=False)
    assert plugins_response.status_code == 200
    assert plugins_response.json() == {"enabled_plugins": DEFAULT_OPTIONAL_PLUGIN_IDS}


def test_patch_me_updates_display_name_and_auto_login(client: TestClient) -> None:
    token, _ = login(client, DevUsername.TEST.value, DevPassword.EMPTY.value)

    response = client.patch(
        "/api/v1/me",
        headers=auth_header(token),
        json={"display_name": "Updated Test User", "auto_login": True},
    )

    assert response.status_code == 200
    assert response.json()["display_name"] == "Updated Test User"
    assert response.json()["auto_login"] is True
    assert_qaa_generator_token_is_masked(cast(dict[str, Any], response.json()), token_set=False)

    me_response = client.get("/api/v1/me", headers=auth_header(token))
    assert me_response.status_code == 200
    assert me_response.json()["display_name"] == "Updated Test User"
    assert me_response.json()["auto_login"] is True
    assert_qaa_generator_token_is_masked(cast(dict[str, Any], me_response.json()), token_set=False)


def test_patch_me_changes_password(client: TestClient) -> None:
    token, _ = login(client, DevUsername.TEST.value, DevPassword.EMPTY.value)

    response = client.patch(
        "/api/v1/me",
        headers=auth_header(token),
        json={"password": "new-password"},
    )

    assert response.status_code == 200
    assert_qaa_generator_token_is_masked(cast(dict[str, Any], response.json()), token_set=False)

    old_login = client.post(
        "/api/v1/auth/login",
        json={"username": DevUsername.TEST.value, "password": DevPassword.EMPTY.value},
    )
    new_login = client.post(
        "/api/v1/auth/login",
        json={"username": DevUsername.TEST.value, "password": "new-password"},
    )
    assert old_login.status_code == 401
    assert new_login.status_code == 200


def test_patch_me_sets_and_clears_qaa_generator_token_without_returning_it(
    client: TestClient,
) -> None:
    token, _ = login(client, DevUsername.TEST.value, DevPassword.EMPTY.value)

    set_response = client.patch(
        "/api/v1/me",
        headers=auth_header(token),
        json={QAA_GENERATOR_TOKEN_FIELD: "personal-token"},
    )

    assert set_response.status_code == 200
    assert_qaa_generator_token_is_masked(
        cast(dict[str, Any], set_response.json()),
        token_set=True,
    )

    me_response = client.get("/api/v1/me", headers=auth_header(token))
    assert me_response.status_code == 200
    assert_qaa_generator_token_is_masked(
        cast(dict[str, Any], me_response.json()),
        token_set=True,
    )

    clear_response = client.patch(
        "/api/v1/me",
        headers=auth_header(token),
        json={QAA_GENERATOR_TOKEN_FIELD: ""},
    )

    assert clear_response.status_code == 200
    assert_qaa_generator_token_is_masked(
        cast(dict[str, Any], clear_response.json()),
        token_set=False,
    )


def test_patch_me_partial_update_preserves_other_fields(client: TestClient) -> None:
    token, before = login(client, DevUsername.TEST.value, DevPassword.EMPTY.value)

    response = client.patch(
        "/api/v1/me",
        headers=auth_header(token),
        json={"display_name": "Partial Update"},
    )

    assert response.status_code == 200
    assert response.json()["display_name"] == "Partial Update"
    assert response.json()["auto_login"] == before["auto_login"]


def test_patch_me_rejects_unknown_fields(client: TestClient) -> None:
    token, _ = login(client, DevUsername.TEST.value, DevPassword.EMPTY.value)

    response = client.patch(
        "/api/v1/me",
        headers=auth_header(token),
        json={"username": "blocked"},
    )

    assert response.status_code == 422


def test_put_me_plugins_round_trips_and_updates_me(client: TestClient) -> None:
    token, _ = login(client, DevUsername.TEST.value, DevPassword.EMPTY.value)

    disable_response = client.put(
        "/api/v1/me/plugins",
        headers=auth_header(token),
        json={"enabled_plugins": []},
    )
    assert disable_response.status_code == 200
    assert disable_response.json() == {"enabled_plugins": []}

    me_after_disable = client.get("/api/v1/me", headers=auth_header(token))
    assert me_after_disable.status_code == 200
    assert me_after_disable.json()["enabled_plugins"] == []

    restore_response = client.put(
        "/api/v1/me/plugins",
        headers=auth_header(token),
        json={"enabled_plugins": [PluginId.STAGINGS.value]},
    )
    assert restore_response.status_code == 200
    assert restore_response.json() == {"enabled_plugins": [PluginId.STAGINGS.value]}


def test_put_me_plugins_rejects_unknown_and_system_ids_without_mutating_row(
    client: TestClient,
) -> None:
    token, _ = login(client, DevUsername.TEST.value, DevPassword.EMPTY.value)

    unknown_response = client.put(
        "/api/v1/me/plugins",
        headers=auth_header(token),
        json={"enabled_plugins": ["unknown-plugin"]},
    )
    system_response = client.put(
        "/api/v1/me/plugins",
        headers=auth_header(token),
        json={"enabled_plugins": [PluginId.ADMIN.value]},
    )
    me_response = client.get("/api/v1/me", headers=auth_header(token))

    assert unknown_response.status_code == 422
    assert system_response.status_code == 422
    assert me_response.status_code == 200
    assert me_response.json()["enabled_plugins"] == DEFAULT_OPTIONAL_PLUGIN_IDS


def test_guardrails_block_self_delete_and_self_demote(client: TestClient) -> None:
    admin_token, admin_user = login(client, DevUsername.ADMIN.value, DevPassword.ADMIN.value)
    create_user(client, admin_token, "support-admin", is_admin=True, display_name="Support Admin")

    self_delete_response = client.delete(
        f"/api/v1/users/{admin_user['id']}",
        headers=auth_header(admin_token),
    )
    self_demote_response = client.patch(
        f"/api/v1/users/{admin_user['id']}",
        headers=auth_header(admin_token),
        json={"is_admin": False},
    )

    assert self_delete_response.status_code == 409
    assert self_delete_response.json()["detail"] == "You cannot delete your own account."
    assert self_demote_response.status_code == 409
    assert self_demote_response.json()["detail"] == "You cannot remove your own admin access."


def test_guardrails_block_removing_last_admin(client: TestClient) -> None:
    admin_token, admin_user = login(client, DevUsername.ADMIN.value, DevPassword.ADMIN.value)

    delete_last_admin = client.delete(
        f"/api/v1/users/{admin_user['id']}",
        headers=auth_header(admin_token),
    )
    demote_last_admin = client.patch(
        f"/api/v1/users/{admin_user['id']}",
        headers=auth_header(admin_token),
        json={"is_admin": False},
    )

    assert delete_last_admin.status_code == 409
    assert delete_last_admin.json()["detail"] == "The last remaining admin cannot be removed."
    assert demote_last_admin.status_code == 409
    assert demote_last_admin.json()["detail"] == "The last remaining admin cannot be removed."


def test_delete_blocks_users_with_operations_and_allows_users_without_operations(
    client: TestClient,
) -> None:
    admin_token, _ = login(client, DevUsername.ADMIN.value, DevPassword.ADMIN.value)
    member_with_ops = create_user(client, admin_token, "with-ops", password="with-ops")
    member_without_ops = create_user(client, admin_token, "without-ops")

    member_token, _ = login(client, "with-ops", "with-ops")
    create_operation_response = client.post(
        "/api/v1/operations",
        headers=auth_header(member_token),
        json={
            "type": OperationType.DEPLOY.value,
            "ns": "qa-user-ops",
            "recipe": {"services": [], "images": {}, "suites": [], "flags": {}},
            "status": OperationStatus.SUCCESS.value,
        },
    )
    assert create_operation_response.status_code == 200

    blocked_delete = client.delete(
        f"/api/v1/users/{member_with_ops['id']}",
        headers=auth_header(admin_token),
    )
    allowed_delete = client.delete(
        f"/api/v1/users/{member_without_ops['id']}",
        headers=auth_header(admin_token),
    )

    assert blocked_delete.status_code == 409
    assert (
        blocked_delete.json()["detail"]
        == "This user has recorded operations; audit history must be preserved."
    )
    assert allowed_delete.status_code == 204

    list_response = client.get("/api/v1/users", headers=auth_header(admin_token))
    items = cast(list[dict[str, Any]], list_response.json()["items"])
    usernames = [user["username"] for user in items]
    assert "without-ops" not in usernames
