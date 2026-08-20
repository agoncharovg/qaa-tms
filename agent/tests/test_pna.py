from __future__ import annotations

import httpx


async def test_pna_preflight_allows_private_network_requests_from_allowed_origin(
    client: httpx.AsyncClient,
) -> None:
    response = await client.options(
        "/settings",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "PUT",
            "Access-Control-Request-Headers": "Authorization, X-QAA-TMS",
            "Access-Control-Request-Private-Network": "true",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-private-network"] == "true"
