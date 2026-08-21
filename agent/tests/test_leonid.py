from __future__ import annotations

from typing import Any

import httpx
import pytest

from app.api import routes as api_routes
from app.core.config import Settings
from app.core.constants import ErrorMessage
from app.services.leonid import (
    LeonidNotConfiguredError,
    LeonidUnreachableError,
    fetch_report,
    fetch_status,
)

LEONID_BASE_URL = "https://leonid-prod.i.gc.onl"


def build_settings(
    *,
    leonid_url: str = LEONID_BASE_URL,
    leonid_products: str | list[str] | None = None,
) -> Settings:
    settings_kwargs: dict[str, Any] = {
        "AGENT_HOST": "127.0.0.1",
        "AGENT_PORT": 47600,
        "AGENT_BACKEND_URL": "http://backend.test",
        "AGENT_CORS_ORIGINS": "http://localhost:3000,http://127.0.0.1:3000",
        "AGENT_LEONID_URL": leonid_url,
        "AGENT_LEONID_REQUEST_TIMEOUT": 15.0,
    }
    if leonid_products is not None:
        settings_kwargs["AGENT_LEONID_PRODUCTS"] = leonid_products
    return Settings(**settings_kwargs)


@pytest.mark.asyncio
async def test_fetch_status_reads_the_expected_product_endpoint() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        assert str(request.url) == f"{LEONID_BASE_URL}/api/iam/status/"
        return httpx.Response(
            status_code=200,
            json={
                "allow_to_deploy": True,
                "reason": None,
                "failed_tests": None,
                "last_build_date": "2026-08-21T09:00:00Z",
                "build_link": "https://jenkins.example/build/42",
                "force_deploy": False,
            },
        )

    payload = await fetch_status(
        build_settings(),
        "IAM",
        transport=httpx.MockTransport(handler),
    )

    assert payload == {
        "allow_to_deploy": True,
        "reason": None,
        "failed_tests": None,
        "last_build_date": "2026-08-21T09:00:00Z",
        "build_link": "https://jenkins.example/build/42",
        "force_deploy": False,
    }


@pytest.mark.asyncio
async def test_fetch_status_returns_none_when_leonid_has_no_product_data() -> None:
    async def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(status_code=204)

    payload = await fetch_status(
        build_settings(),
        "waap",
        transport=httpx.MockTransport(handler),
    )

    assert payload is None


@pytest.mark.asyncio
async def test_fetch_status_requires_local_leonid_configuration() -> None:
    with pytest.raises(LeonidNotConfiguredError, match="Leonid is not configured"):
        await fetch_status(build_settings(leonid_url=""), "iam")


@pytest.mark.asyncio
async def test_fetch_report_passes_date_and_optional_filters() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        assert str(request.url) == (
            f"{LEONID_BASE_URL}/api/report/billing/summary/"
            "?start_date=2026-08-01&end_date=2026-08-21&environment=PROD&test_type=UI"
        )
        return httpx.Response(
            status_code=200,
            json={
                "failed_total": 3,
                "success_total": 17,
                "top_failed_tests": [{"name": "checkout smoke", "count": 2}],
                "test_added": 1,
            },
        )

    payload = await fetch_report(
        build_settings(),
        "Billing",
        "2026-08-01",
        "2026-08-21",
        environment="PROD",
        test_type="UI",
        transport=httpx.MockTransport(handler),
    )

    assert payload == {
        "failed_total": 3,
        "success_total": 17,
        "top_failed_tests": [{"name": "checkout smoke", "count": 2}],
        "test_added": 1,
    }


@pytest.mark.asyncio
async def test_fetch_report_maps_http_errors_to_unreachable() -> None:
    async def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(status_code=503, json={"detail": "upstream unavailable"})

    with pytest.raises(LeonidUnreachableError, match=ErrorMessage.LEONID_UNREACHABLE.value):
        await fetch_report(
            build_settings(),
            "iam",
            "2026-08-01",
            "2026-08-21",
            environment=None,
            test_type=None,
            transport=httpx.MockTransport(handler),
        )


@pytest.mark.asyncio
async def test_leonid_products_route_returns_candidates_and_configured_flag(
    client: httpx.AsyncClient,
    auth_headers: dict[str, str],
) -> None:
    client._transport.app.state.settings = build_settings(
        leonid_products="iam,storage,qaa",
    )

    response = await client.get("/leonid/products", headers=auth_headers)

    assert response.status_code == 200
    assert response.json() == {
        "configured": True,
        "products": ["iam", "storage", "qaa"],
    }


@pytest.mark.asyncio
async def test_leonid_status_route_returns_404_for_products_without_data(
    client: httpx.AsyncClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_fetch_status(settings: Settings, product: str) -> dict[str, Any] | None:
        del settings, product
        return None

    monkeypatch.setattr(api_routes, "fetch_status", fake_fetch_status)

    response = await client.get("/leonid/status", headers=auth_headers, params={"product": "cdn"})

    assert response.status_code == 404
    assert response.json() == {"detail": "Leonid has no data for this product."}


@pytest.mark.asyncio
async def test_leonid_status_route_maps_configuration_and_network_failures(
    client: httpx.AsyncClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_not_configured(
        settings: Settings,
        product: str,
    ) -> dict[str, Any] | None:
        del settings, product
        raise LeonidNotConfiguredError(ErrorMessage.LEONID_NOT_CONFIGURED.value)

    async def fake_unreachable(
        settings: Settings,
        product: str,
    ) -> dict[str, Any] | None:
        del settings, product
        raise LeonidUnreachableError(ErrorMessage.LEONID_UNREACHABLE.value)

    monkeypatch.setattr(api_routes, "fetch_status", fake_not_configured)
    not_configured = await client.get(
        "/leonid/status",
        headers=auth_headers,
        params={"product": "iam"},
    )

    monkeypatch.setattr(api_routes, "fetch_status", fake_unreachable)
    unreachable = await client.get(
        "/leonid/status",
        headers=auth_headers,
        params={"product": "iam"},
    )

    assert not_configured.status_code == 503
    assert not_configured.json() == {"detail": ErrorMessage.LEONID_NOT_CONFIGURED.value}
    assert unreachable.status_code == 502
    assert unreachable.json() == {"detail": ErrorMessage.LEONID_UNREACHABLE.value}


@pytest.mark.asyncio
async def test_leonid_status_route_returns_agent_augmented_product_payload(
    client: httpx.AsyncClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_fetch_status(settings: Settings, product: str) -> dict[str, Any] | None:
        del settings
        assert product == "IAM"
        return {
            "allow_to_deploy": False,
            "reason": "2 failed UI tests",
            "failed_tests": [
                {
                    "test_name": "billing smoke",
                    "steps": [
                        {
                            "step_name": "checkout",
                            "error_message": "Button stayed disabled",
                        }
                    ],
                }
            ],
            "last_build_date": "2026-08-21T10:15:00Z",
            "build_link": "https://jenkins.example/build/77",
            "force_deploy": False,
        }

    monkeypatch.setattr(api_routes, "fetch_status", fake_fetch_status)

    response = await client.get("/leonid/status", headers=auth_headers, params={"product": "IAM"})

    assert response.status_code == 200
    assert response.json() == {
        "product": "iam",
        "allow_to_deploy": False,
        "reason": "2 failed UI tests",
        "failed_tests": [
            {
                "test_name": "billing smoke",
                "steps": [
                    {
                        "step_name": "checkout",
                        "error_message": "Button stayed disabled",
                    }
                ],
            }
        ],
        "last_build_date": "2026-08-21T10:15:00Z",
        "build_link": "https://jenkins.example/build/77",
        "force_deploy": False,
    }


@pytest.mark.asyncio
async def test_leonid_report_route_validates_dates_as_yyyy_mm_dd(
    client: httpx.AsyncClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_fetch_report(*args: Any, **kwargs: Any) -> dict[str, Any]:
        raise AssertionError("fetch_report should not be called for invalid dates")

    monkeypatch.setattr(api_routes, "fetch_report", fake_fetch_report)

    response = await client.get(
        "/leonid/report",
        headers=auth_headers,
        params={
            "product": "iam",
            "start_date": "2026/08/01",
            "end_date": "2026-08-21",
        },
    )

    assert response.status_code == 400
    assert response.json() == {"detail": "start_date must use YYYY-MM-DD format."}


@pytest.mark.asyncio
async def test_leonid_report_route_returns_summary_payload(
    client: httpx.AsyncClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_fetch_report(
        settings: Settings,
        product: str,
        start_date: str,
        end_date: str,
        environment: str | None,
        test_type: str | None,
    ) -> dict[str, Any]:
        del settings
        assert product == "billing"
        assert start_date == "2026-08-01"
        assert end_date == "2026-08-21"
        assert environment == "PREPROD"
        assert test_type is None
        return {
            "failed_total": 5,
            "success_total": 21,
            "top_failed_tests": [
                {"name": "checkout smoke", "count": 3},
                {"name": "refund smoke", "count": 1},
            ],
            "test_added": 2,
        }

    monkeypatch.setattr(api_routes, "fetch_report", fake_fetch_report)

    response = await client.get(
        "/leonid/report",
        headers=auth_headers,
        params={
            "product": "billing",
            "start_date": "2026-08-01",
            "end_date": "2026-08-21",
            "environment": "PREPROD",
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "failed_total": 5,
        "success_total": 21,
        "top_failed_tests": [
            {"name": "checkout smoke", "count": 3},
            {"name": "refund smoke", "count": 1},
        ],
        "test_added": 2,
    }


@pytest.mark.asyncio
async def test_leonid_routes_ignore_unknown_fields_from_upstream_payloads(
    client: httpx.AsyncClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def status_handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        assert str(request.url) == f"{LEONID_BASE_URL}/api/iam/status/"
        return httpx.Response(
            status_code=200,
            json={
                "allow_to_deploy": True,
                "reason": "green build",
                "failed_tests": [
                    {
                        "test_name": "billing smoke",
                        "unexpected_test_field": "ignored",
                        "steps": [
                            {
                                "step_name": "checkout",
                                "error_message": "Button stayed disabled",
                                "unexpected_step_field": 7,
                            }
                        ],
                    }
                ],
                "last_build_date": "2026-08-21T10:15:00Z",
                "build_link": "https://jenkins.example/build/88",
                "force_deploy": False,
                "extra_field": 1,
            },
        )

    async def fake_fetch_status(settings: Settings, product: str) -> dict[str, Any] | None:
        del settings
        return await fetch_status(
            build_settings(),
            product,
            transport=httpx.MockTransport(status_handler),
        )

    monkeypatch.setattr(api_routes, "fetch_status", fake_fetch_status)

    status_response = await client.get(
        "/leonid/status",
        headers=auth_headers,
        params={"product": "IAM"},
    )

    assert status_response.status_code == 200
    assert status_response.json() == {
        "product": "iam",
        "allow_to_deploy": True,
        "reason": "green build",
        "failed_tests": [
            {
                "test_name": "billing smoke",
                "steps": [
                    {
                        "step_name": "checkout",
                        "error_message": "Button stayed disabled",
                    }
                ],
            }
        ],
        "last_build_date": "2026-08-21T10:15:00Z",
        "build_link": "https://jenkins.example/build/88",
        "force_deploy": False,
    }

    async def report_handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        assert str(request.url) == (
            f"{LEONID_BASE_URL}/api/report/billing/summary/"
            "?start_date=2026-08-01&end_date=2026-08-21"
        )
        return httpx.Response(
            status_code=200,
            json={
                "failed_total": 5,
                "success_total": 21,
                "top_failed_tests": [
                    {"name": "checkout smoke", "count": 3, "unexpected_rank": 1},
                    {"name": "refund smoke", "count": 1, "unexpected_rank": 2},
                ],
                "test_added": 2,
                "new_metric": 5,
            },
        )

    async def fake_fetch_report(
        settings: Settings,
        product: str,
        start_date: str,
        end_date: str,
        environment: str | None,
        test_type: str | None,
    ) -> dict[str, Any]:
        del settings
        return await fetch_report(
            build_settings(),
            product,
            start_date,
            end_date,
            environment,
            test_type,
            transport=httpx.MockTransport(report_handler),
        )

    monkeypatch.setattr(api_routes, "fetch_report", fake_fetch_report)

    report_response = await client.get(
        "/leonid/report",
        headers=auth_headers,
        params={
            "product": "billing",
            "start_date": "2026-08-01",
            "end_date": "2026-08-21",
        },
    )

    assert report_response.status_code == 200
    assert report_response.json() == {
        "failed_total": 5,
        "success_total": 21,
        "top_failed_tests": [
            {"name": "checkout smoke", "count": 3},
            {"name": "refund smoke", "count": 1},
        ],
        "test_added": 2,
    }
