"""Leonid shared-token proxy client."""

from __future__ import annotations

from typing import Any

import httpx
from fastapi import HTTPException, status

from app.core.config import Settings
from app.core.constants import ErrorMessage, HttpHeader, MediaType

LEONID_LIMIT_TYPE_PATH = "/api/shared_resource_limit_types/"
LEONID_LIMIT_PATH = "/api/shared_resource_limits/"
LEONID_RESOURCE_PATH = "/api/shared_resources/"
LEONID_SKIPPED_SUITE_PATH = "/api/skipped_suites/"
LEONID_OBJECT_DEFINITION_PATH = "/api/object_definitions/"
LEONID_OBJECT_VALUE_PATH = "/api/object_values/"
LEONID_PIPELINE_PARAM_PATH = "/api/pipeline_params/"


def _detail_path(collection_path: str, item_id: int) -> str:
    return f"{collection_path}{item_id}/"


def _toggle_path(collection_path: str, item_id: int) -> str:
    return f"{collection_path}{item_id}/toggle_enabled/"


def _extract_error_message(payload: Any) -> str | None:
    if not isinstance(payload, dict):
        return None
    detail = payload.get("detail")
    if isinstance(detail, str):
        return detail
    error = payload.get("error")
    if isinstance(error, str):
        return error
    if isinstance(error, dict):
        message = error.get("message")
        if isinstance(message, str):
            return message
    return None


async def _read_json_payload(response: httpx.Response) -> Any:
    try:
        return response.json()
    except ValueError:
        text = response.text.strip()
        if text:
            return {"detail": text}
        return {}


class LeonidClient:
    def __init__(self, settings: Settings, http_client: httpx.AsyncClient) -> None:
        self._settings = settings
        self._http_client = http_client

    def _require_configured(self) -> None:
        if not self._settings.leonid_url.strip() or not self._settings.leonid_token.strip():
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=ErrorMessage.LEONID_NOT_CONFIGURED.value,
            )

    def _build_headers(self) -> dict[str, str]:
        return {
            HttpHeader.ACCEPT.value: MediaType.JSON.value,
            HttpHeader.X_LEONID_TOKEN.value: self._settings.leonid_token,
        }

    async def _send_json(
        self,
        method: str,
        path: str,
        *,
        json_body: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]] | dict[str, Any] | None:
        self._require_configured()
        url = f"{self._settings.leonid_url}{path}"
        try:
            response = await self._http_client.request(
                method,
                url,
                headers=self._build_headers(),
                json=json_body,
            )
        except httpx.RequestError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=ErrorMessage.LEONID_UNREACHABLE.value,
            ) from exc

        payload = await _read_json_payload(response)
        if response.is_success:
            if response.status_code == status.HTTP_204_NO_CONTENT or not response.content:
                return None
            if not isinstance(payload, (dict, list)):
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=ErrorMessage.LEONID_UNREACHABLE.value,
                )
            return payload

        if response.status_code in {status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN}:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=ErrorMessage.LEONID_UPSTREAM_REJECTED.value,
            )

        message = _extract_error_message(payload)
        if response.status_code >= status.HTTP_500_INTERNAL_SERVER_ERROR:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=message or ErrorMessage.LEONID_UNREACHABLE.value,
            )

        raise HTTPException(
            status_code=response.status_code,
            detail=message or ErrorMessage.LEONID_UNREACHABLE.value,
        )

    async def _list_collection(self, collection_path: str) -> list[dict[str, Any]]:
        payload = await self._send_json("GET", collection_path)
        return payload if isinstance(payload, list) else []

    async def _retrieve_item(self, collection_path: str, item_id: int) -> dict[str, Any]:
        payload = await self._send_json("GET", _detail_path(collection_path, item_id))
        return payload if isinstance(payload, dict) else {}

    async def _create_item(self, collection_path: str, body: dict[str, Any]) -> dict[str, Any]:
        payload = await self._send_json("POST", collection_path, json_body=body)
        return payload if isinstance(payload, dict) else {}

    async def _update_item(
        self,
        method: str,
        collection_path: str,
        item_id: int,
        body: dict[str, Any],
    ) -> dict[str, Any]:
        payload = await self._send_json(
            method,
            _detail_path(collection_path, item_id),
            json_body=body,
        )
        return payload if isinstance(payload, dict) else {}

    async def _delete_item(self, collection_path: str, item_id: int) -> None:
        await self._send_json("DELETE", _detail_path(collection_path, item_id))

    async def _toggle_item(self, collection_path: str, item_id: int) -> dict[str, Any]:
        payload = await self._send_json("POST", _toggle_path(collection_path, item_id))
        return payload if isinstance(payload, dict) else {}

    async def list_shared_resource_limit_types(self) -> list[dict[str, Any]]:
        return await self._list_collection(LEONID_LIMIT_TYPE_PATH)

    async def get_shared_resource_limit_type(self, limit_type_id: int) -> dict[str, Any]:
        return await self._retrieve_item(LEONID_LIMIT_TYPE_PATH, limit_type_id)

    async def list_shared_resource_limits(self) -> list[dict[str, Any]]:
        return await self._list_collection(LEONID_LIMIT_PATH)

    async def get_shared_resource_limit(self, limit_id: int) -> dict[str, Any]:
        return await self._retrieve_item(LEONID_LIMIT_PATH, limit_id)

    async def create_shared_resource_limit(self, body: dict[str, Any]) -> dict[str, Any]:
        return await self._create_item(LEONID_LIMIT_PATH, body)

    async def update_shared_resource_limit(
        self, limit_id: int, body: dict[str, Any]
    ) -> dict[str, Any]:
        return await self._update_item("PUT", LEONID_LIMIT_PATH, limit_id, body)

    async def patch_shared_resource_limit(
        self, limit_id: int, body: dict[str, Any]
    ) -> dict[str, Any]:
        return await self._update_item("PATCH", LEONID_LIMIT_PATH, limit_id, body)

    async def delete_shared_resource_limit(self, limit_id: int) -> None:
        await self._delete_item(LEONID_LIMIT_PATH, limit_id)

    async def list_shared_resources(self) -> list[dict[str, Any]]:
        return await self._list_collection(LEONID_RESOURCE_PATH)

    async def get_shared_resource(self, resource_id: int) -> dict[str, Any]:
        return await self._retrieve_item(LEONID_RESOURCE_PATH, resource_id)

    async def create_shared_resource(self, body: dict[str, Any]) -> dict[str, Any]:
        return await self._create_item(LEONID_RESOURCE_PATH, body)

    async def update_shared_resource(
        self, resource_id: int, body: dict[str, Any]
    ) -> dict[str, Any]:
        return await self._update_item("PUT", LEONID_RESOURCE_PATH, resource_id, body)

    async def patch_shared_resource(self, resource_id: int, body: dict[str, Any]) -> dict[str, Any]:
        return await self._update_item("PATCH", LEONID_RESOURCE_PATH, resource_id, body)

    async def delete_shared_resource(self, resource_id: int) -> None:
        await self._delete_item(LEONID_RESOURCE_PATH, resource_id)

    async def toggle_shared_resource(self, resource_id: int) -> dict[str, Any]:
        return await self._toggle_item(LEONID_RESOURCE_PATH, resource_id)

    async def list_skipped_suites(self) -> list[dict[str, Any]]:
        return await self._list_collection(LEONID_SKIPPED_SUITE_PATH)

    async def get_skipped_suite(self, suite_id: int) -> dict[str, Any]:
        return await self._retrieve_item(LEONID_SKIPPED_SUITE_PATH, suite_id)

    async def create_skipped_suite(self, body: dict[str, Any]) -> dict[str, Any]:
        return await self._create_item(LEONID_SKIPPED_SUITE_PATH, body)

    async def cancel_skipped_suite(self, suite_id: int, body: dict[str, Any]) -> dict[str, Any]:
        payload = await self._send_json(
            "POST",
            f"{LEONID_SKIPPED_SUITE_PATH}{suite_id}/cancel/",
            json_body=body,
        )
        return payload if isinstance(payload, dict) else {}

    async def list_object_definitions(self) -> list[dict[str, Any]]:
        return await self._list_collection(LEONID_OBJECT_DEFINITION_PATH)

    async def get_object_definition(self, definition_id: int) -> dict[str, Any]:
        return await self._retrieve_item(LEONID_OBJECT_DEFINITION_PATH, definition_id)

    async def create_object_definition(self, body: dict[str, Any]) -> dict[str, Any]:
        return await self._create_item(LEONID_OBJECT_DEFINITION_PATH, body)

    async def update_object_definition(
        self, definition_id: int, body: dict[str, Any]
    ) -> dict[str, Any]:
        return await self._update_item("PUT", LEONID_OBJECT_DEFINITION_PATH, definition_id, body)

    async def patch_object_definition(
        self, definition_id: int, body: dict[str, Any]
    ) -> dict[str, Any]:
        return await self._update_item("PATCH", LEONID_OBJECT_DEFINITION_PATH, definition_id, body)

    async def delete_object_definition(self, definition_id: int) -> None:
        await self._delete_item(LEONID_OBJECT_DEFINITION_PATH, definition_id)

    async def toggle_object_definition(self, definition_id: int) -> dict[str, Any]:
        return await self._toggle_item(LEONID_OBJECT_DEFINITION_PATH, definition_id)

    async def list_object_values(self) -> list[dict[str, Any]]:
        return await self._list_collection(LEONID_OBJECT_VALUE_PATH)

    async def get_object_value(self, value_id: int) -> dict[str, Any]:
        return await self._retrieve_item(LEONID_OBJECT_VALUE_PATH, value_id)

    async def create_object_value(self, body: dict[str, Any]) -> dict[str, Any]:
        return await self._create_item(LEONID_OBJECT_VALUE_PATH, body)

    async def update_object_value(self, value_id: int, body: dict[str, Any]) -> dict[str, Any]:
        return await self._update_item("PUT", LEONID_OBJECT_VALUE_PATH, value_id, body)

    async def patch_object_value(self, value_id: int, body: dict[str, Any]) -> dict[str, Any]:
        return await self._update_item("PATCH", LEONID_OBJECT_VALUE_PATH, value_id, body)

    async def delete_object_value(self, value_id: int) -> None:
        await self._delete_item(LEONID_OBJECT_VALUE_PATH, value_id)

    async def toggle_object_value(self, value_id: int) -> dict[str, Any]:
        return await self._toggle_item(LEONID_OBJECT_VALUE_PATH, value_id)

    async def list_pipeline_params(self) -> list[dict[str, Any]]:
        return await self._list_collection(LEONID_PIPELINE_PARAM_PATH)

    async def get_pipeline_param(self, pipeline_param_id: int) -> dict[str, Any]:
        return await self._retrieve_item(LEONID_PIPELINE_PARAM_PATH, pipeline_param_id)

    async def create_pipeline_param(self, body: dict[str, Any]) -> dict[str, Any]:
        return await self._create_item(LEONID_PIPELINE_PARAM_PATH, body)

    async def update_pipeline_param(
        self, pipeline_param_id: int, body: dict[str, Any]
    ) -> dict[str, Any]:
        return await self._update_item("PUT", LEONID_PIPELINE_PARAM_PATH, pipeline_param_id, body)

    async def patch_pipeline_param(
        self, pipeline_param_id: int, body: dict[str, Any]
    ) -> dict[str, Any]:
        return await self._update_item("PATCH", LEONID_PIPELINE_PARAM_PATH, pipeline_param_id, body)

    async def delete_pipeline_param(self, pipeline_param_id: int) -> None:
        await self._delete_item(LEONID_PIPELINE_PARAM_PATH, pipeline_param_id)
