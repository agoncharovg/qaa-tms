from __future__ import annotations

import httpx


async def test_cors_allows_tms_origin_preflight(client: httpx.AsyncClient) -> None:
    response = await client.options(
        "/preflight",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "Authorization, X-QAA-TMS",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:3000"


async def test_cors_rejects_foreign_origin_preflight(client: httpx.AsyncClient) -> None:
    response = await client.options(
        "/preflight",
        headers={
            "Origin": "https://evil.example",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "Authorization, X-QAA-TMS",
        },
    )

    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers
