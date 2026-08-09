from __future__ import annotations

import httpx


async def test_protected_routes_require_valid_bearer_token(
    client: httpx.AsyncClient,
    auth_headers: dict[str, str],
    invalid_auth_headers: dict[str, str],
) -> None:
    missing = await client.get("/preflight")
    invalid = await client.get("/preflight", headers=invalid_auth_headers)
    valid = await client.get("/preflight", headers=auth_headers)

    assert missing.status_code == 401
    assert invalid.status_code == 401
    assert valid.status_code == 200

