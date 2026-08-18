from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from typing import Any, cast
from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from test_users import auth_header, login

from app.core.constants import JenkinsFreezeStatus, JenkinsResumeRunStatus
from app.models.jenkins_freeze import JenkinsFreeze
from app.models.jenkins_resume_run import JenkinsResumeRun

SIGNATURE = "scope-jenkins-1"
FOLDER_PATH = "job/.QAA/job/E2E/job/PREPROD"
FOLDER_NAME = "PREPROD"
PIPELINE_PATH = f"{FOLDER_PATH}/job/Smoke"
SECOND_PIPELINE_PATH = f"{FOLDER_PATH}/job/Deploy"


def create_freeze(client: TestClient, token: str) -> dict[str, Any]:
    response = client.post(
        "/api/v1/jenkins/freezes",
        headers=auth_header(token),
        json={
            "folderPath": FOLDER_PATH,
            "folderName": FOLDER_NAME,
            "signature": SIGNATURE,
            "reason": "DR freeze",
            "killBuilds": False,
        },
    )
    assert response.status_code == 200
    return cast(dict[str, Any], response.json())


def snapshot_item(
    path: str,
    *,
    name: str,
    full_name: str,
    was_disabled: bool,
    scheduled: bool = False,
) -> dict[str, Any]:
    return {
        "path": path,
        "name": name,
        "fullName": full_name,
        "wasDisabled": was_disabled,
        "scheduled": scheduled,
        "wasBuilding": False,
    }


def put_snapshot(
    client: TestClient,
    token: str,
    freeze_id: str,
    snapshot: list[dict[str, Any]],
) -> None:
    response = client.put(
        f"/api/v1/jenkins/freezes/{freeze_id}/snapshot",
        headers=auth_header(token),
        json={"snapshot": snapshot, "mergeFreezeIds": []},
    )
    assert response.status_code == 200


def create_resume_run(client: TestClient, token: str, freeze_id: str) -> dict[str, Any]:
    response = client.post(
        "/api/v1/jenkins/resume-runs",
        headers=auth_header(token),
        json={"freezeId": freeze_id},
    )
    assert response.status_code == 200
    return cast(dict[str, Any], response.json())


def read_resume_run(client: TestClient, run_id: str) -> JenkinsResumeRun:
    session_maker = cast(async_sessionmaker[AsyncSession], client.app.state.session_maker)

    async def load() -> JenkinsResumeRun:
        async with session_maker() as session:
            result = await session.scalar(
                select(JenkinsResumeRun).where(JenkinsResumeRun.id == UUID(run_id))
            )
            assert result is not None
            return result

    return asyncio.run(load())


def update_resume_run_heartbeat(client: TestClient, run_id: str, heartbeat_at: datetime) -> None:
    session_maker = cast(async_sessionmaker[AsyncSession], client.app.state.session_maker)

    async def mutate() -> None:
        async with session_maker() as session:
            run = await session.scalar(
                select(JenkinsResumeRun).where(JenkinsResumeRun.id == UUID(run_id))
            )
            assert run is not None
            run.heartbeat_at = heartbeat_at
            await session.commit()

    asyncio.run(mutate())


def read_freeze(client: TestClient, freeze_id: str) -> JenkinsFreeze:
    session_maker = cast(async_sessionmaker[AsyncSession], client.app.state.session_maker)

    async def load() -> JenkinsFreeze:
        async with session_maker() as session:
            result = await session.scalar(
                select(JenkinsFreeze).where(JenkinsFreeze.id == UUID(freeze_id))
            )
            assert result is not None
            return result

    return asyncio.run(load())


def test_resume_run_routes_require_authentication(client: TestClient) -> None:
    response = client.get("/api/v1/jenkins/resume-runs", params={"signature": SIGNATURE})

    assert response.status_code == 401


def test_create_resume_run_builds_plan_and_sets_total(client: TestClient) -> None:
    token, _ = login(client, "test", "")
    freeze = create_freeze(client, token)
    put_snapshot(
        client,
        token,
        freeze["id"],
        [
            snapshot_item(
                PIPELINE_PATH,
                full_name=".QAA/E2E/PREPROD/Smoke",
                name="Smoke",
                was_disabled=False,
            ),
            snapshot_item(
                SECOND_PIPELINE_PATH,
                full_name=".QAA/E2E/PREPROD/Deploy",
                name="Deploy",
                was_disabled=True,
            ),
        ],
    )

    run = create_resume_run(client, token, freeze["id"])

    assert run["status"] == JenkinsResumeRunStatus.RUNNING.value
    assert run["total"] == 1
    assert run["startedCount"] == 0
    assert run["skippedCount"] == 1
    assert run["errorCount"] == 0
    assert run["currentPath"] == PIPELINE_PATH
    assert run["currentName"] == "Smoke"
    assert [item["state"] for item in run["items"]] == ["pending", "skipped"]
    assert run["items"][1]["reason"] == "Disabled before the freeze"


def test_second_create_conflicts_while_fresh_run_is_active(client: TestClient) -> None:
    token, _ = login(client, "test", "")
    freeze = create_freeze(client, token)
    put_snapshot(
        client,
        token,
        freeze["id"],
        [
            snapshot_item(
                PIPELINE_PATH,
                full_name=".QAA/E2E/PREPROD/Smoke",
                name="Smoke",
                was_disabled=False,
            )
        ],
    )
    create_resume_run(client, token, freeze["id"])

    response = client.post(
        "/api/v1/jenkins/resume-runs",
        headers=auth_header(token),
        json={"freezeId": freeze["id"]},
    )

    assert response.status_code == 409


def test_create_succeeds_when_existing_run_is_stale(client: TestClient) -> None:
    token, _ = login(client, "test", "")
    freeze = create_freeze(client, token)
    put_snapshot(
        client,
        token,
        freeze["id"],
        [
            snapshot_item(
                PIPELINE_PATH,
                full_name=".QAA/E2E/PREPROD/Smoke",
                name="Smoke",
                was_disabled=False,
            )
        ],
    )
    stale_run = create_resume_run(client, token, freeze["id"])
    update_resume_run_heartbeat(
        client,
        stale_run["id"],
        datetime.now(tz=UTC) - timedelta(seconds=31),
    )

    response = client.post(
        "/api/v1/jenkins/resume-runs",
        headers=auth_header(token),
        json={"freezeId": freeze["id"]},
    )

    assert response.status_code == 200
    assert response.json()["id"] != stale_run["id"]
    assert read_resume_run(client, stale_run["id"]).status == JenkinsResumeRunStatus.FAILED


def test_progress_advances_counters_and_resolves_freeze_on_last_item(client: TestClient) -> None:
    token, user = login(client, "test", "")
    freeze = create_freeze(client, token)
    put_snapshot(
        client,
        token,
        freeze["id"],
        [
            snapshot_item(
                PIPELINE_PATH,
                full_name=".QAA/E2E/PREPROD/Smoke",
                name="Smoke",
                was_disabled=False,
            ),
            snapshot_item(
                SECOND_PIPELINE_PATH,
                full_name=".QAA/E2E/PREPROD/Deploy",
                name="Deploy",
                was_disabled=False,
            ),
        ],
    )
    run = create_resume_run(client, token, freeze["id"])

    first_progress = client.put(
        f"/api/v1/jenkins/resume-runs/{run['id']}/progress",
        headers=auth_header(token),
        json={
            "path": PIPELINE_PATH,
            "state": "started",
            "nextPath": SECOND_PIPELINE_PATH,
            "nextName": "Deploy",
        },
    )
    assert first_progress.status_code == 200
    assert first_progress.json()["startedCount"] == 1
    assert first_progress.json()["currentPath"] == SECOND_PIPELINE_PATH

    final_progress = client.put(
        f"/api/v1/jenkins/resume-runs/{run['id']}/progress",
        headers=auth_header(token),
        json={
            "path": SECOND_PIPELINE_PATH,
            "state": "started",
        },
    )

    assert final_progress.status_code == 200
    assert final_progress.json()["status"] == JenkinsResumeRunStatus.DONE.value
    assert final_progress.json()["startedCount"] == 2
    assert final_progress.json()["errorCount"] == 0
    assert final_progress.json()["currentPath"] is None
    assert final_progress.json()["finishedAt"] is not None
    resolved_freeze = read_freeze(client, freeze["id"])
    assert resolved_freeze.status == JenkinsFreezeStatus.RESOLVED
    assert resolved_freeze.resolved_by_id == user["id"]


def test_progress_keeps_freeze_active_when_a_pipeline_errors(client: TestClient) -> None:
    token, _ = login(client, "test", "")
    freeze = create_freeze(client, token)
    put_snapshot(
        client,
        token,
        freeze["id"],
        [
            snapshot_item(
                PIPELINE_PATH,
                full_name=".QAA/E2E/PREPROD/Smoke",
                name="Smoke",
                was_disabled=False,
            )
        ],
    )
    run = create_resume_run(client, token, freeze["id"])

    final_progress = client.put(
        f"/api/v1/jenkins/resume-runs/{run['id']}/progress",
        headers=auth_header(token),
        json={
            "path": PIPELINE_PATH,
            "state": "error",
            "reason": "Jenkins build failed",
        },
    )

    # The run finishes, but a failed pipeline keeps the freeze active for a retry.
    assert final_progress.status_code == 200
    assert final_progress.json()["status"] == JenkinsResumeRunStatus.DONE.value
    assert final_progress.json()["errorCount"] == 1
    freeze_after = read_freeze(client, freeze["id"])
    assert freeze_after.status == JenkinsFreezeStatus.ACTIVE


def test_progress_on_cancelled_run_does_not_resurrect_it(client: TestClient) -> None:
    token, _ = login(client, "test", "")
    freeze = create_freeze(client, token)
    put_snapshot(
        client,
        token,
        freeze["id"],
        [
            snapshot_item(
                PIPELINE_PATH,
                full_name=".QAA/E2E/PREPROD/Smoke",
                name="Smoke",
                was_disabled=False,
            )
        ],
    )
    run = create_resume_run(client, token, freeze["id"])
    cancel_response = client.post(
        f"/api/v1/jenkins/resume-runs/{run['id']}/cancel",
        headers=auth_header(token),
    )
    assert cancel_response.status_code == 200

    progress_response = client.put(
        f"/api/v1/jenkins/resume-runs/{run['id']}/progress",
        headers=auth_header(token),
        json={"path": PIPELINE_PATH, "state": "started"},
    )

    assert progress_response.status_code == 200
    assert progress_response.json()["status"] == JenkinsResumeRunStatus.CANCELLED.value
    assert progress_response.json()["startedCount"] == 0


def test_cancel_by_non_creator_sets_cancelled_by(client: TestClient) -> None:
    owner_token, _ = login(client, "test", "")
    cancel_token, _ = login(client, "admin", "admin")
    freeze = create_freeze(client, owner_token)
    put_snapshot(
        client,
        owner_token,
        freeze["id"],
        [
            snapshot_item(
                PIPELINE_PATH,
                full_name=".QAA/E2E/PREPROD/Smoke",
                name="Smoke",
                was_disabled=False,
            )
        ],
    )
    run = create_resume_run(client, owner_token, freeze["id"])

    cancel_response = client.post(
        f"/api/v1/jenkins/resume-runs/{run['id']}/cancel",
        headers=auth_header(cancel_token),
    )

    assert cancel_response.status_code == 200
    assert cancel_response.json()["cancelledBy"] == "admin"
    assert cancel_response.json()["status"] == JenkinsResumeRunStatus.CANCELLED.value


def test_stale_flag_is_computed_from_heartbeat(client: TestClient) -> None:
    token, _ = login(client, "test", "")
    freeze = create_freeze(client, token)
    put_snapshot(
        client,
        token,
        freeze["id"],
        [
            snapshot_item(
                PIPELINE_PATH,
                full_name=".QAA/E2E/PREPROD/Smoke",
                name="Smoke",
                was_disabled=False,
            )
        ],
    )
    run = create_resume_run(client, token, freeze["id"])
    update_resume_run_heartbeat(
        client,
        run["id"],
        datetime.now(tz=UTC) - timedelta(seconds=31),
    )

    response = client.get(
        f"/api/v1/jenkins/resume-runs/{run['id']}",
        headers=auth_header(token),
    )

    assert response.status_code == 200
    assert response.json()["stale"] is True
