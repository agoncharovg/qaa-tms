from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta

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
