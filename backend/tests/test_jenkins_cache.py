from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta

from app.core.constants import JENKINS_FOLDER_HISTORY_RETENTION_MS
from app.schemas.jenkins import JenkinsBuild, JenkinsNode
from app.services import jenkins_cache as cache_service
from app.services.jenkins_cache import JenkinsCache


def build_node(path: str, *, name: str = "PREPROD", synthetic: bool = False) -> JenkinsNode:
    return JenkinsNode(
        name=name,
        path=path,
        url=f"https://jenkins.example/{path}/",
        kind="folder",
        synthetic=synthetic,
        children=[],
    )


def build_build(number: int) -> JenkinsBuild:
    return JenkinsBuild(
        number=number,
        result="SUCCESS",
        building=False,
        timestamp=1720000000000 + number,
        duration_ms=120000,
        url=f"https://jenkins.example/build/{number}/",
        allure_url=f"https://jenkins.example/build/{number}/allure/",
    )


def pipeline_node(
    path: str,
    *,
    builds: list[JenkinsBuild],
    name: str = "Billing Smoke",
) -> JenkinsNode:
    return JenkinsNode(
        name=name,
        path=path,
        url=f"https://jenkins.example/{path}/",
        kind="pipeline",
        status="passed",
        synthetic=False,
        scheduled=False,
        builds=builds,
        children=[],
    )


def test_tree_cache_single_flight_flow(monkeypatch) -> None:
    current_time = [datetime(2026, 8, 17, tzinfo=UTC)]
    monkeypatch.setattr(cache_service, "utcnow", lambda: current_time[0])

    cache = JenkinsCache()
    signature = "scope-1"
    roots = [build_node("job/.QAA/job/E2E/job/PREPROD")]

    asyncio.run(cache.write_tree(signature, roots, None))

    fresh_roots, fresh_fetched_at, fresh_stale, fresh_lease = asyncio.run(
        cache.read_tree(signature)
    )
    assert fresh_roots == roots
    assert fresh_fetched_at == current_time[0]
    assert fresh_stale is False
    assert fresh_lease is None

    current_time[0] += timedelta(seconds=901)
    stale_roots, stale_fetched_at, stale_flag, first_lease = asyncio.run(cache.read_tree(signature))
    second_roots, second_fetched_at, second_flag, second_lease = asyncio.run(
        cache.read_tree(signature)
    )

    assert stale_roots == roots
    assert stale_fetched_at is not None
    assert stale_flag is True
    assert first_lease is not None
    assert second_roots == roots
    assert second_fetched_at == stale_fetched_at
    assert second_flag is True
    assert second_lease is None

    refreshed_roots = [build_node("job/.QAA/job/E2E/job/PROD")]
    asyncio.run(cache.write_tree(signature, refreshed_roots, first_lease))

    final_roots, final_fetched_at, final_stale, final_lease = asyncio.run(
        cache.read_tree(signature)
    )
    assert final_roots == refreshed_roots
    assert final_fetched_at == current_time[0]
    assert final_stale is False
    assert final_lease is None


def test_builds_cache_expired_lease_can_be_reminted(monkeypatch) -> None:
    current_time = [datetime(2026, 8, 17, tzinfo=UTC)]
    monkeypatch.setattr(cache_service, "utcnow", lambda: current_time[0])

    cache = JenkinsCache()
    signature = "scope-1"
    path = "job/.QAA/job/E2E/job/PREPROD/job/Smoke"

    first_builds, first_fetched_at, first_stale, first_lease = asyncio.run(
        cache.read_builds(signature, path)
    )
    assert first_builds == []
    assert first_fetched_at is None
    assert first_stale is True
    assert first_lease is not None

    current_time[0] += timedelta(seconds=31)
    _, _, second_stale, second_lease = asyncio.run(cache.read_builds(signature, path))
    assert second_stale is True
    assert second_lease is not None
    assert second_lease != first_lease

    asyncio.run(cache.write_builds(signature, path, [build_build(42)], second_lease))

    builds, fetched_at, stale, lease = asyncio.run(cache.read_builds(signature, path))
    assert [build.number for build in builds] == [42]
    assert fetched_at == current_time[0]
    assert stale is False
    assert lease is None


def test_tree_cache_ignores_late_write_from_stale_lease(monkeypatch) -> None:
    current_time = [datetime(2026, 8, 17, tzinfo=UTC)]
    monkeypatch.setattr(cache_service, "utcnow", lambda: current_time[0])

    cache = JenkinsCache()
    signature = "scope-1"

    _, _, _, first_lease = asyncio.run(cache.read_tree(signature))
    assert first_lease is not None

    current_time[0] += timedelta(seconds=31)
    _, _, _, second_lease = asyncio.run(cache.read_tree(signature))
    assert second_lease is not None
    assert second_lease != first_lease

    asyncio.run(
        cache.write_tree(
            signature,
            [build_node("job/.QAA/job/E2E/job/PREPROD", name="fresh")],
            second_lease,
        )
    )
    asyncio.run(
        cache.write_tree(
            signature,
            [build_node("job/.QAA/job/E2E/job/PROD", name="stale")],
            first_lease,
        )
    )

    roots, _, stale, lease = asyncio.run(cache.read_tree(signature))

    assert [root.name for root in roots] == ["fresh"]
    assert stale is False
    assert lease is None


def test_folder_cache_single_flight_flow_with_custom_ttl(monkeypatch) -> None:
    current_time = [datetime(2026, 8, 17, tzinfo=UTC)]
    monkeypatch.setattr(cache_service, "utcnow", lambda: current_time[0])

    cache = JenkinsCache()
    signature = "scope-1"
    path = "job/.QAA/job/E2E/job/PREPROD/job/SMOKE"
    ttl_seconds = 60
    roots = [build_node("job/.QAA/job/E2E/job/PREPROD/job/SMOKE")]

    asyncio.run(cache.write_folder(signature, path, roots, None))

    fresh_roots, fresh_fetched_at, fresh_stale, fresh_lease = asyncio.run(
        cache.read_folder(signature, path, ttl_seconds)
    )
    assert fresh_roots == roots
    assert fresh_fetched_at == current_time[0]
    assert fresh_stale is False
    assert fresh_lease is None

    current_time[0] += timedelta(seconds=61)
    stale_roots, stale_fetched_at, stale_flag, first_lease = asyncio.run(
        cache.read_folder(signature, path, ttl_seconds)
    )
    second_roots, second_fetched_at, second_flag, second_lease = asyncio.run(
        cache.read_folder(signature, path, ttl_seconds)
    )

    assert stale_roots == roots
    assert stale_fetched_at is not None
    assert stale_flag is True
    assert first_lease is not None
    assert second_roots == roots
    assert second_fetched_at == stale_fetched_at
    assert second_flag is True
    assert second_lease is None

    refreshed_roots = [build_node("job/.QAA/job/E2E/job/PREPROD/job/SMOKE", name="Billing")]
    asyncio.run(cache.write_folder(signature, path, refreshed_roots, first_lease))

    final_roots, final_fetched_at, final_stale, final_lease = asyncio.run(
        cache.read_folder(signature, path, ttl_seconds)
    )
    assert final_roots == refreshed_roots
    assert final_fetched_at == current_time[0]
    assert final_stale is False
    assert final_lease is None


def test_folder_cache_ttl_is_per_call_not_a_shared_constant(monkeypatch) -> None:
    current_time = [datetime(2026, 8, 17, tzinfo=UTC)]
    monkeypatch.setattr(cache_service, "utcnow", lambda: current_time[0])

    cache = JenkinsCache()
    signature = "scope-1"
    path = "job/.QAA/job/E2E/job/PREPROD/job/SMOKE"
    roots = [build_node("job/.QAA/job/E2E/job/PREPROD/job/SMOKE")]

    asyncio.run(cache.write_folder(signature, path, roots, None))

    current_time[0] += timedelta(seconds=45)
    # A 30s TTL sees the 45s-old snapshot as stale...
    _, _, stale_with_short_ttl, _ = asyncio.run(cache.read_folder(signature, path, 30))
    assert stale_with_short_ttl is True

    # ...but a 60s TTL still considers the same snapshot fresh.
    _, _, stale_with_long_ttl, _ = asyncio.run(cache.read_folder(signature, path, 60))
    assert stale_with_long_ttl is False


def test_folder_cache_accumulates_and_dedupes_pipeline_builds(monkeypatch) -> None:
    current_time = [datetime(2026, 8, 17, tzinfo=UTC)]
    monkeypatch.setattr(cache_service, "utcnow", lambda: current_time[0])

    cache = JenkinsCache()
    signature = "scope-1"
    path = "job/.QAA/job/E2E/job/PREPROD/job/SMOKE"
    pipeline_path = f"{path}/job/Billing"
    now_ms = int(current_time[0].timestamp() * 1000)

    first_roots = [
        pipeline_node(
            pipeline_path,
            builds=[
                build_build(100).model_copy(
                    update={
                        "building": True,
                        "result": None,
                        "timestamp": now_ms - 120000,
                    }
                ),
                build_build(101).model_copy(update={"timestamp": now_ms - 60000}),
            ],
        )
    ]
    second_roots = [
        pipeline_node(
            pipeline_path,
            builds=[
                build_build(100).model_copy(
                    update={
                        "building": False,
                        "result": "SUCCESS",
                        "timestamp": now_ms - 120000,
                    }
                ),
                build_build(102).model_copy(update={"timestamp": now_ms - 30000}),
            ],
        )
    ]

    asyncio.run(cache.write_folder(signature, path, first_roots, None))
    cached_roots, _, _, _ = asyncio.run(cache.read_folder(signature, path, 60))
    assert [build.number for build in cached_roots[0].builds] == [100, 101]
    assert cached_roots[0].builds[0].building is True

    asyncio.run(cache.write_folder(signature, path, second_roots, None))
    merged_roots, _, _, _ = asyncio.run(cache.read_folder(signature, path, 60))

    assert [build.number for build in merged_roots[0].builds] == [100, 101, 102]
    merged_build = merged_roots[0].builds[0]
    assert merged_build.building is False
    assert merged_build.result == "SUCCESS"


def test_folder_cache_prunes_old_builds_but_keeps_latest_anchor(monkeypatch) -> None:
    current_time = [datetime(2026, 8, 17, 12, 0, tzinfo=UTC)]
    monkeypatch.setattr(cache_service, "utcnow", lambda: current_time[0])

    cache = JenkinsCache()
    signature = "scope-1"
    path = "job/.QAA/job/E2E/job/PREPROD/job/SMOKE"
    now_ms = int(current_time[0].timestamp() * 1000)
    roots = [
        pipeline_node(
            f"{path}/job/WAAP",
            builds=[
                build_build(1).model_copy(
                    update={"timestamp": now_ms - JENKINS_FOLDER_HISTORY_RETENTION_MS - 120000}
                ),
                build_build(2).model_copy(
                    update={"timestamp": now_ms - JENKINS_FOLDER_HISTORY_RETENTION_MS - 60000}
                ),
            ],
            name="WAAP Smoke",
        )
    ]

    asyncio.run(cache.write_folder(signature, path, roots, None))
    cached_roots, _, _, _ = asyncio.run(cache.read_folder(signature, path, 60))

    assert [build.number for build in cached_roots[0].builds] == [2]


def test_write_builds_replaces_when_no_merge_callback_is_used(monkeypatch) -> None:
    current_time = [datetime(2026, 8, 17, tzinfo=UTC)]
    monkeypatch.setattr(cache_service, "utcnow", lambda: current_time[0])

    cache = JenkinsCache()
    signature = "scope-1"
    path = "job/.QAA/job/E2E/job/PREPROD/job/Smoke"

    asyncio.run(cache.write_builds(signature, path, [build_build(1), build_build(2)], None))
    asyncio.run(cache.write_builds(signature, path, [build_build(3)], None))

    builds, _, _, _ = asyncio.run(cache.read_builds(signature, path))

    assert [build.number for build in builds] == [3]


def test_tree_cache_preserves_synthetic_env_nodes() -> None:
    cache = JenkinsCache()
    signature = "scope-1"
    roots = [
        JenkinsNode(
            name="PREPROD",
            path="",
            url="",
            kind="folder",
            synthetic=True,
            children=[build_node("job/.QAA/job/E2E/job/PREPROD", name="BE")],
        )
    ]

    asyncio.run(cache.write_tree(signature, roots, None))

    cached_roots, _, _, _ = asyncio.run(cache.read_tree(signature))

    assert cached_roots[0].synthetic is True
    assert cached_roots[0].path == ""
    assert cached_roots[0].children[0].path == "job/.QAA/job/E2E/job/PREPROD"
