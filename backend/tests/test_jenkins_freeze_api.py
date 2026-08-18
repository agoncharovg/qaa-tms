from __future__ import annotations

import asyncio
from typing import Any, cast
from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from test_users import auth_header, login

from app.core.constants import JenkinsFreezeStatus
from app.models.jenkins_freeze import JenkinsFreeze

SIGNATURE = "scope-jenkins-1"
PREPROD_PATH = "job/.QAA/job/E2E/job/PREPROD"
IAM_PATH = f"{PREPROD_PATH}/job/IAM"
CDN_PATH = f"{PREPROD_PATH}/job/CDN"
OTHER_PATH = "job/.QAA/job/E2E/job/PROD"
IAM_PIPELINE_PATH = f"{IAM_PATH}/job/Smoke"
CDN_PIPELINE_PATH = f"{CDN_PATH}/job/Smoke"
PREPROD_PIPELINE_PATH = f"{PREPROD_PATH}/job/Shared"


def create_freeze(
    client: TestClient,
    token: str,
    *,
    folder_path: str,
    folder_name: str,
    reason: str = "DR freeze",
    kill_builds: bool = False,
    signature: str = SIGNATURE,
) -> dict[str, Any]:
    response = client.post(
        "/api/v1/jenkins/freezes",
        headers=auth_header(token),
        json={
            "folderPath": folder_path,
            "folderName": folder_name,
            "signature": signature,
            "reason": reason,
            "killBuilds": kill_builds,
        },
    )
    assert response.status_code == 200
    return cast(dict[str, Any], response.json())


def snapshot_item(
    path: str,
    *,
    full_name: str,
    name: str,
    was_disabled: bool,
    scheduled: bool = False,
    was_building: bool = False,
) -> dict[str, Any]:
    return {
        "path": path,
        "fullName": full_name,
        "name": name,
        "wasDisabled": was_disabled,
        "scheduled": scheduled,
        "wasBuilding": was_building,
    }


def put_snapshot(
    client: TestClient,
    token: str,
    freeze_id: str,
    snapshot: list[dict[str, Any]],
    *,
    merge_freeze_ids: list[str] | None = None,
) -> dict[str, Any]:
    response = client.put(
        f"/api/v1/jenkins/freezes/{freeze_id}/snapshot",
        headers=auth_header(token),
        json={
            "snapshot": snapshot,
            "mergeFreezeIds": merge_freeze_ids or [],
        },
    )
    assert response.status_code == 200
    return cast(dict[str, Any], response.json())


def read_freeze(client: TestClient, freeze_id: str) -> JenkinsFreeze:
    session_maker = cast(
        async_sessionmaker[AsyncSession],
        client.app.state.session_maker,
    )

    async def load() -> JenkinsFreeze:
        async with session_maker() as session:
            result = await session.scalar(
                select(JenkinsFreeze).where(JenkinsFreeze.id == UUID(freeze_id))
            )
            assert result is not None
            return result

    return asyncio.run(load())


def test_jenkins_freeze_routes_require_authentication(client: TestClient) -> None:
    response = client.get("/api/v1/jenkins/freezes", params={"signature": SIGNATURE})

    assert response.status_code == 401


def test_create_allows_overlaps_and_snapshot_put_marks_freeze_applied(client: TestClient) -> None:
    token, _ = login(client, "test", "")

    first = create_freeze(
        client,
        token,
        folder_path=IAM_PATH,
        folder_name="IAM",
        reason="IAM lock",
    )
    second = create_freeze(
        client,
        token,
        folder_path=PREPROD_PATH,
        folder_name="PREPROD",
        reason="Wide lock",
    )
    snapshot_response = put_snapshot(
        client,
        token,
        second["id"],
        [
            snapshot_item(
                PREPROD_PIPELINE_PATH,
                full_name=".QAA/E2E/PREPROD/Shared",
                name="Shared",
                was_disabled=False,
            )
        ],
    )

    assert first["status"] == JenkinsFreezeStatus.ACTIVE.value
    assert first["applied"] is False
    assert second["status"] == JenkinsFreezeStatus.ACTIVE.value
    assert snapshot_response["applied"] is True
    assert snapshot_response["snapshot"][0]["path"] == PREPROD_PIPELINE_PATH


def test_merge_absorbs_selected_active_freezes_and_non_merge_keeps_prior_locks(
    client: TestClient,
) -> None:
    token, user = login(client, "test", "")

    iam = create_freeze(client, token, folder_path=IAM_PATH, folder_name="IAM", reason="IAM")
    put_snapshot(
        client,
        token,
        iam["id"],
        [
            snapshot_item(
                IAM_PIPELINE_PATH,
                full_name=".QAA/E2E/PREPROD/IAM/Smoke",
                name="Smoke",
                was_disabled=False,
            )
        ],
    )
    cdn = create_freeze(client, token, folder_path=CDN_PATH, folder_name="CDN", reason="CDN")
    put_snapshot(
        client,
        token,
        cdn["id"],
        [
            snapshot_item(
                CDN_PIPELINE_PATH,
                full_name=".QAA/E2E/PREPROD/CDN/Smoke",
                name="Smoke",
                was_disabled=False,
            )
        ],
    )

    non_merge = create_freeze(
        client,
        token,
        folder_path=PREPROD_PATH,
        folder_name="PREPROD",
        reason="No merge",
    )
    non_merge_response = put_snapshot(
        client,
        token,
        non_merge["id"],
        [
            snapshot_item(
                IAM_PIPELINE_PATH,
                full_name=".QAA/E2E/PREPROD/IAM/Smoke",
                name="Smoke",
                was_disabled=True,
            ),
            snapshot_item(
                CDN_PIPELINE_PATH,
                full_name=".QAA/E2E/PREPROD/CDN/Smoke",
                name="Smoke",
                was_disabled=True,
            ),
        ],
    )

    assert [item["wasDisabled"] for item in non_merge_response["snapshot"]] == [True, True]
    assert read_freeze(client, iam["id"]).status == JenkinsFreezeStatus.ACTIVE
    assert read_freeze(client, cdn["id"]).status == JenkinsFreezeStatus.ACTIVE

    merged = create_freeze(
        client,
        token,
        folder_path=PREPROD_PATH,
        folder_name="PREPROD",
        reason="Merge",
    )
    merged_response = put_snapshot(
        client,
        token,
        merged["id"],
        [
            snapshot_item(
                IAM_PIPELINE_PATH,
                full_name=".QAA/E2E/PREPROD/IAM/Smoke",
                name="Smoke",
                was_disabled=True,
            ),
            snapshot_item(
                CDN_PIPELINE_PATH,
                full_name=".QAA/E2E/PREPROD/CDN/Smoke",
                name="Smoke",
                was_disabled=True,
            ),
            snapshot_item(
                PREPROD_PIPELINE_PATH,
                full_name=".QAA/E2E/PREPROD/Shared",
                name="Shared",
                was_disabled=False,
            ),
        ],
        merge_freeze_ids=[iam["id"], cdn["id"]],
    )

    snapshot_by_path = {
        item["path"]: item["wasDisabled"]
        for item in cast(list[dict[str, Any]], merged_response["snapshot"])
    }
    assert snapshot_by_path[IAM_PIPELINE_PATH] is False
    assert snapshot_by_path[CDN_PIPELINE_PATH] is False
    assert snapshot_by_path[PREPROD_PIPELINE_PATH] is False

    iam_row = read_freeze(client, iam["id"])
    cdn_row = read_freeze(client, cdn["id"])
    assert iam_row.status == JenkinsFreezeStatus.MERGED
    assert cdn_row.status == JenkinsFreezeStatus.MERGED
    assert str(iam_row.merged_into_id) == merged["id"]
    assert str(cdn_row.merged_into_id) == merged["id"]
    assert iam_row.resolved_at is not None
    assert cdn_row.resolved_at is not None
    assert merged_response["createdBy"] == user["username"]


def test_merge_ignores_non_active_or_non_intersecting_ids(client: TestClient) -> None:
    token, _ = login(client, "test", "")

    active = create_freeze(client, token, folder_path=IAM_PATH, folder_name="IAM")
    put_snapshot(
        client,
        token,
        active["id"],
        [
            snapshot_item(
                IAM_PIPELINE_PATH,
                full_name=".QAA/E2E/PREPROD/IAM/Smoke",
                name="Smoke",
                was_disabled=False,
            )
        ],
    )
    resolved = create_freeze(client, token, folder_path=CDN_PATH, folder_name="CDN")
    put_snapshot(
        client,
        token,
        resolved["id"],
        [
            snapshot_item(
                CDN_PIPELINE_PATH,
                full_name=".QAA/E2E/PREPROD/CDN/Smoke",
                name="Smoke",
                was_disabled=False,
            )
        ],
    )
    resolve_response = client.post(
        f"/api/v1/jenkins/freezes/{resolved['id']}/resolve",
        headers=auth_header(token),
    )
    assert resolve_response.status_code == 200

    outside = create_freeze(client, token, folder_path=OTHER_PATH, folder_name="PROD")
    put_snapshot(
        client,
        token,
        outside["id"],
        [
            snapshot_item(
                f"{OTHER_PATH}/job/Smoke",
                full_name=".QAA/E2E/PROD/Smoke",
                name="Smoke",
                was_disabled=False,
            )
        ],
    )

    wide = create_freeze(client, token, folder_path=PREPROD_PATH, folder_name="PREPROD")
    put_snapshot(
        client,
        token,
        wide["id"],
        [
            snapshot_item(
                IAM_PIPELINE_PATH,
                full_name=".QAA/E2E/PREPROD/IAM/Smoke",
                name="Smoke",
                was_disabled=True,
            )
        ],
        merge_freeze_ids=[active["id"], resolved["id"], outside["id"]],
    )

    assert read_freeze(client, active["id"]).status == JenkinsFreezeStatus.MERGED
    assert read_freeze(client, resolved["id"]).status == JenkinsFreezeStatus.RESOLVED
    assert read_freeze(client, outside["id"]).status == JenkinsFreezeStatus.ACTIVE


def test_delete_release_only_allows_not_yet_applied_claims(client: TestClient) -> None:
    token, _ = login(client, "test", "")

    pending = create_freeze(client, token, folder_path=IAM_PATH, folder_name="IAM")
    applied = create_freeze(client, token, folder_path=CDN_PATH, folder_name="CDN")
    put_snapshot(
        client,
        token,
        applied["id"],
        [
            snapshot_item(
                CDN_PIPELINE_PATH,
                full_name=".QAA/E2E/PREPROD/CDN/Smoke",
                name="Smoke",
                was_disabled=False,
            )
        ],
    )

    delete_pending = client.delete(
        f"/api/v1/jenkins/freezes/{pending['id']}",
        headers=auth_header(token),
    )
    delete_applied = client.delete(
        f"/api/v1/jenkins/freezes/{applied['id']}",
        headers=auth_header(token),
    )

    assert delete_pending.status_code == 204
    assert delete_applied.status_code == 409


def test_resolve_records_who_resumed_and_active_filter_excludes_merged(client: TestClient) -> None:
    token, _ = login(client, "test", "")
    admin_token, admin_user = login(client, "admin", "admin")

    resolvable = create_freeze(client, token, folder_path=IAM_PATH, folder_name="IAM")
    put_snapshot(
        client,
        token,
        resolvable["id"],
        [
            snapshot_item(
                IAM_PIPELINE_PATH,
                full_name=".QAA/E2E/PREPROD/IAM/Smoke",
                name="Smoke",
                was_disabled=False,
            )
        ],
    )
    merged_source = create_freeze(client, token, folder_path=CDN_PATH, folder_name="CDN")
    put_snapshot(
        client,
        token,
        merged_source["id"],
        [
            snapshot_item(
                CDN_PIPELINE_PATH,
                full_name=".QAA/E2E/PREPROD/CDN/Smoke",
                name="Smoke",
                was_disabled=False,
            )
        ],
    )
    merge_owner = create_freeze(client, token, folder_path=PREPROD_PATH, folder_name="PREPROD")
    put_snapshot(
        client,
        token,
        merge_owner["id"],
        [
            snapshot_item(
                CDN_PIPELINE_PATH,
                full_name=".QAA/E2E/PREPROD/CDN/Smoke",
                name="Smoke",
                was_disabled=True,
            )
        ],
        merge_freeze_ids=[merged_source["id"]],
    )
    still_active = create_freeze(
        client,
        token,
        folder_path=PREPROD_PATH,
        folder_name="PREPROD second",
    )

    resolve_response = client.post(
        f"/api/v1/jenkins/freezes/{resolvable['id']}/resolve",
        headers=auth_header(admin_token),
    )
    active_response = client.get(
        "/api/v1/jenkins/freezes",
        headers=auth_header(token),
        params={"signature": SIGNATURE, "status": JenkinsFreezeStatus.ACTIVE.value},
    )

    assert resolve_response.status_code == 200
    assert resolve_response.json()["status"] == JenkinsFreezeStatus.RESOLVED.value
    assert resolve_response.json()["resolvedBy"] == admin_user["username"]
    assert resolve_response.json()["resolvedAt"] is not None
    assert (
        client.post(
            f"/api/v1/jenkins/freezes/{resolvable['id']}/resolve",
            headers=auth_header(token),
        ).status_code
        == 409
    )

    active_ids = [item["id"] for item in cast(list[dict[str, Any]], active_response.json())]
    assert still_active["id"] in active_ids
    assert resolvable["id"] not in active_ids
    assert merged_source["id"] not in active_ids
