from __future__ import annotations

import httpx


async def test_ping_matches_frontend_shape(client: httpx.AsyncClient) -> None:
    response = await client.get("/ping")

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {
        "app",
        "version",
        "stagingsInstalled",
        "stagingsSha",
        "selfUpdateSupported",
        "os",
    }
    assert body["app"] == "qaa-tms-agent"
    assert body["stagingsInstalled"] is True
    assert isinstance(body["stagingsSha"], str)
