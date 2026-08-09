from __future__ import annotations

import httpx


async def test_preflight_returns_all_expected_keys(
    client: httpx.AsyncClient,
    auth_headers: dict[str, str],
) -> None:
    response = await client.get("/preflight", headers=auth_headers)

    assert response.status_code == 200
    body = response.json()
    assert [item["key"] for item in body] == [
        "tools",
        "clusterReachable",
        "vpn",
        "kubeconfig",
        "dockerHarbor",
        "dockerStaging",
        "harborPull",
        "submodules",
        "venv",
        "repoInstalled",
    ]
    for item in body:
        assert set(item) == {"key", "ok", "detail", "howTo"}
        assert isinstance(item["ok"], bool)
        assert isinstance(item["detail"], str)
        assert isinstance(item["howTo"], str)

