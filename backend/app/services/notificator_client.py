"""Notificator shared-token proxy client."""

from __future__ import annotations

from typing import Any

import httpx
from fastapi import HTTPException, status

from app.core.config import Settings
from app.core.constants import ErrorMessage, HttpHeader, MediaType

NOTIFICATOR_NOTIFICATION_CONFIGS_PATH = "/notificator/notification_configs/"
NOTIFICATOR_TEAMS_PATH = "/notificator/teams/"
NOTIFICATOR_PRODUCTS_PATH = "/notificator/products/"
NOTIFICATOR_SUB_PRODUCTS_PATH = "/notificator/sub_products/"
NOTIFICATOR_SLACK_CHANNELS_PATH = "/notificator/slack_channels/"
NOTIFICATOR_USERS_PATH = "/notificator/users/"
NOTIFICATOR_QAA_MEMBERS_PATH = "/notificator/qaa_members/"
NOTIFICATOR_FAILURE_MENTION_RULES_PATH = "/notificator/failure_mention_rules/"
NOTIFICATOR_EVENTS_PATH = "/notificator/events/"
NOTIFICATOR_RECURRENT_FAILS_PATH = "/notificator/recurrent_fails/"
NOTIFICATOR_FAIL_REASONS_PATH = "/notificator/fail_reasons/"
NOTIFICATOR_MUTE_STATUSES_PATH = "/notificator/mute_statuses/"
NOTIFICATOR_HISTORY_PATH = "/notificator/history/"
NOTIFICATOR_CHOICES_PATH = "/notificator/choices/"


def _detail_path(collection_path: str, item_id: int) -> str:
    return f"{collection_path}{item_id}/"


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


class NotificatorClient:
    def __init__(self, settings: Settings, http_client: httpx.AsyncClient) -> None:
        self._settings = settings
        self._http_client = http_client

    def _require_configured(self) -> None:
        if (
            not self._settings.notificator_url.strip()
            or not self._settings.notificator_token.strip()
        ):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=ErrorMessage.NOTIFICATOR_NOT_CONFIGURED.value,
            )

    def _build_headers(self) -> dict[str, str]:
        return {
            HttpHeader.ACCEPT.value: MediaType.JSON.value,
            HttpHeader.X_NOTIFICATOR_TOKEN.value: self._settings.notificator_token,
        }

    async def _send_json(
        self,
        method: str,
        path: str,
        *,
        json_body: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]] | dict[str, Any] | None:
        self._require_configured()
        url = f"{self._settings.notificator_url}{path}"
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
                detail=ErrorMessage.NOTIFICATOR_UNREACHABLE.value,
            ) from exc

        payload = await _read_json_payload(response)
        if response.is_success:
            if response.status_code == status.HTTP_204_NO_CONTENT or not response.content:
                return None
            if not isinstance(payload, (dict, list)):
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=ErrorMessage.NOTIFICATOR_UNREACHABLE.value,
                )
            return payload

        if response.status_code in {status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN}:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=ErrorMessage.NOTIFICATOR_UPSTREAM_REJECTED.value,
            )

        message = _extract_error_message(payload)
        if response.status_code >= status.HTTP_500_INTERNAL_SERVER_ERROR:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=message or ErrorMessage.NOTIFICATOR_UNREACHABLE.value,
            )

        raise HTTPException(
            status_code=response.status_code,
            detail=message or ErrorMessage.NOTIFICATOR_UNREACHABLE.value,
        )

    async def _list_collection(
        self,
        collection_path: str,
        *,
        query: dict[str, str] | None = None,
    ) -> list[dict[str, Any]]:
        path = collection_path
        if query:
            path = f"{collection_path}?{httpx.QueryParams(query)}"
        payload = await self._send_json("GET", path)
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

    async def get_choices(self) -> dict[str, Any]:
        payload = await self._send_json("GET", NOTIFICATOR_CHOICES_PATH)
        return payload if isinstance(payload, dict) else {}

    async def list_notification_configs(
        self, product_team: str | None = None
    ) -> list[dict[str, Any]]:
        query = {"product_team": product_team} if product_team else None
        return await self._list_collection(
            NOTIFICATOR_NOTIFICATION_CONFIGS_PATH,
            query=query,
        )

    async def get_notification_config(self, config_id: int) -> dict[str, Any]:
        return await self._retrieve_item(NOTIFICATOR_NOTIFICATION_CONFIGS_PATH, config_id)

    async def create_notification_config(self, body: dict[str, Any]) -> dict[str, Any]:
        return await self._create_item(NOTIFICATOR_NOTIFICATION_CONFIGS_PATH, body)

    async def update_notification_config(
        self, config_id: int, body: dict[str, Any]
    ) -> dict[str, Any]:
        return await self._update_item(
            "PUT", NOTIFICATOR_NOTIFICATION_CONFIGS_PATH, config_id, body
        )

    async def patch_notification_config(
        self, config_id: int, body: dict[str, Any]
    ) -> dict[str, Any]:
        return await self._update_item(
            "PATCH", NOTIFICATOR_NOTIFICATION_CONFIGS_PATH, config_id, body
        )

    async def delete_notification_config(self, config_id: int) -> None:
        await self._delete_item(NOTIFICATOR_NOTIFICATION_CONFIGS_PATH, config_id)

    async def list_teams(self) -> list[dict[str, Any]]:
        return await self._list_collection(NOTIFICATOR_TEAMS_PATH)

    async def get_team(self, team_id: int) -> dict[str, Any]:
        return await self._retrieve_item(NOTIFICATOR_TEAMS_PATH, team_id)

    async def list_products(self) -> list[dict[str, Any]]:
        return await self._list_collection(NOTIFICATOR_PRODUCTS_PATH)

    async def get_product(self, product_id: int) -> dict[str, Any]:
        return await self._retrieve_item(NOTIFICATOR_PRODUCTS_PATH, product_id)

    async def create_product(self, body: dict[str, Any]) -> dict[str, Any]:
        return await self._create_item(NOTIFICATOR_PRODUCTS_PATH, body)

    async def update_product(self, product_id: int, body: dict[str, Any]) -> dict[str, Any]:
        return await self._update_item("PUT", NOTIFICATOR_PRODUCTS_PATH, product_id, body)

    async def patch_product(self, product_id: int, body: dict[str, Any]) -> dict[str, Any]:
        return await self._update_item("PATCH", NOTIFICATOR_PRODUCTS_PATH, product_id, body)

    async def delete_product(self, product_id: int) -> None:
        await self._delete_item(NOTIFICATOR_PRODUCTS_PATH, product_id)

    async def list_sub_products(self) -> list[dict[str, Any]]:
        return await self._list_collection(NOTIFICATOR_SUB_PRODUCTS_PATH)

    async def get_sub_product(self, sub_product_id: int) -> dict[str, Any]:
        return await self._retrieve_item(NOTIFICATOR_SUB_PRODUCTS_PATH, sub_product_id)

    async def create_sub_product(self, body: dict[str, Any]) -> dict[str, Any]:
        return await self._create_item(NOTIFICATOR_SUB_PRODUCTS_PATH, body)

    async def update_sub_product(self, sub_product_id: int, body: dict[str, Any]) -> dict[str, Any]:
        return await self._update_item("PUT", NOTIFICATOR_SUB_PRODUCTS_PATH, sub_product_id, body)

    async def patch_sub_product(self, sub_product_id: int, body: dict[str, Any]) -> dict[str, Any]:
        return await self._update_item("PATCH", NOTIFICATOR_SUB_PRODUCTS_PATH, sub_product_id, body)

    async def delete_sub_product(self, sub_product_id: int) -> None:
        await self._delete_item(NOTIFICATOR_SUB_PRODUCTS_PATH, sub_product_id)

    async def list_slack_channels(self) -> list[dict[str, Any]]:
        return await self._list_collection(NOTIFICATOR_SLACK_CHANNELS_PATH)

    async def get_slack_channel(self, channel_id: int) -> dict[str, Any]:
        return await self._retrieve_item(NOTIFICATOR_SLACK_CHANNELS_PATH, channel_id)

    async def create_slack_channel(self, body: dict[str, Any]) -> dict[str, Any]:
        return await self._create_item(NOTIFICATOR_SLACK_CHANNELS_PATH, body)

    async def update_slack_channel(self, channel_id: int, body: dict[str, Any]) -> dict[str, Any]:
        return await self._update_item("PUT", NOTIFICATOR_SLACK_CHANNELS_PATH, channel_id, body)

    async def patch_slack_channel(self, channel_id: int, body: dict[str, Any]) -> dict[str, Any]:
        return await self._update_item("PATCH", NOTIFICATOR_SLACK_CHANNELS_PATH, channel_id, body)

    async def delete_slack_channel(self, channel_id: int) -> None:
        await self._delete_item(NOTIFICATOR_SLACK_CHANNELS_PATH, channel_id)

    async def list_users(self) -> list[dict[str, Any]]:
        return await self._list_collection(NOTIFICATOR_USERS_PATH)

    async def get_user(self, user_id: int) -> dict[str, Any]:
        return await self._retrieve_item(NOTIFICATOR_USERS_PATH, user_id)

    async def list_qaa_members(self) -> list[dict[str, Any]]:
        return await self._list_collection(NOTIFICATOR_QAA_MEMBERS_PATH)

    async def get_qaa_member(self, qaa_member_id: int) -> dict[str, Any]:
        return await self._retrieve_item(NOTIFICATOR_QAA_MEMBERS_PATH, qaa_member_id)

    async def list_failure_mention_rules(self) -> list[dict[str, Any]]:
        return await self._list_collection(NOTIFICATOR_FAILURE_MENTION_RULES_PATH)

    async def get_failure_mention_rule(self, rule_id: int) -> dict[str, Any]:
        return await self._retrieve_item(NOTIFICATOR_FAILURE_MENTION_RULES_PATH, rule_id)

    async def list_events(self) -> list[dict[str, Any]]:
        return await self._list_collection(NOTIFICATOR_EVENTS_PATH)

    async def get_event(self, event_id: int) -> dict[str, Any]:
        return await self._retrieve_item(NOTIFICATOR_EVENTS_PATH, event_id)

    async def list_recurrent_fails(self) -> list[dict[str, Any]]:
        return await self._list_collection(NOTIFICATOR_RECURRENT_FAILS_PATH)

    async def get_recurrent_fail(self, recurrent_fail_id: int) -> dict[str, Any]:
        return await self._retrieve_item(NOTIFICATOR_RECURRENT_FAILS_PATH, recurrent_fail_id)

    async def list_fail_reasons(self) -> list[dict[str, Any]]:
        return await self._list_collection(NOTIFICATOR_FAIL_REASONS_PATH)

    async def get_fail_reason(self, fail_reason_id: int) -> dict[str, Any]:
        return await self._retrieve_item(NOTIFICATOR_FAIL_REASONS_PATH, fail_reason_id)

    async def list_mute_statuses(self) -> list[dict[str, Any]]:
        return await self._list_collection(NOTIFICATOR_MUTE_STATUSES_PATH)

    async def get_mute_status(self, mute_status_id: int) -> dict[str, Any]:
        return await self._retrieve_item(NOTIFICATOR_MUTE_STATUSES_PATH, mute_status_id)

    async def list_history(self) -> list[dict[str, Any]]:
        return await self._list_collection(NOTIFICATOR_HISTORY_PATH)

    async def get_history_item(self, history_item_id: int) -> dict[str, Any]:
        return await self._retrieve_item(NOTIFICATOR_HISTORY_PATH, history_item_id)
