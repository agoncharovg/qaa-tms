"""Notificator proxy routes."""

from __future__ import annotations

from dataclasses import dataclass
from types import GenericAlias
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from pydantic import BaseModel, ValidationError

from app.api.deps import get_notificator_client, require_permission
from app.core.constants import ApiTag, PermissionKey, RoutePath
from app.models.user import User
from app.schemas.notificator import (
    NotificatorChoicesResponse,
    NotificatorEventResponse,
    NotificatorFailReasonResponse,
    NotificatorFailureMentionRuleResponse,
    NotificatorHistoryItemResponse,
    NotificatorMuteStatusResponse,
    NotificatorNotificationConfigCreate,
    NotificatorNotificationConfigPatch,
    NotificatorNotificationConfigResponse,
    NotificatorNotificationConfigUpdate,
    NotificatorProductCreate,
    NotificatorProductPatch,
    NotificatorProductResponse,
    NotificatorProductTeamResponse,
    NotificatorProductUpdate,
    NotificatorQaaMemberResponse,
    NotificatorRecurrentFailResponse,
    NotificatorSlackChannelCreate,
    NotificatorSlackChannelPatch,
    NotificatorSlackChannelResponse,
    NotificatorSlackChannelUpdate,
    NotificatorSubProductCreate,
    NotificatorSubProductPatch,
    NotificatorSubProductResponse,
    NotificatorSubProductUpdate,
    NotificatorUserResponse,
)
from app.services.notificator_client import NotificatorClient

router = APIRouter(prefix=RoutePath.NOTIFICATOR.value, tags=[ApiTag.NOTIFICATOR.value])
NotificatorReadUser = Annotated[User, Depends(require_permission(PermissionKey.NOTIFICATOR_READ))]
NotificatorWriteUser = Annotated[User, Depends(require_permission(PermissionKey.NOTIFICATOR_WRITE))]
NotificatorClientDep = Annotated[NotificatorClient, Depends(get_notificator_client)]


@dataclass(frozen=True)
class ReadOnlyResourceDef:
    collection_path: RoutePath
    response_model: type[BaseModel]
    list_method: str
    get_method: str
    item_name: str


@dataclass(frozen=True)
class WritableResourceDef(ReadOnlyResourceDef):
    create_model: type[BaseModel]
    update_model: type[BaseModel]
    patch_model: type[BaseModel]
    create_method: str
    update_method: str
    patch_method: str
    delete_method: str


def format_validation_error(exc: ValidationError) -> str:
    first_error = exc.errors(include_url=False)[0]
    location = ".".join(str(part) for part in first_error.get("loc", ()))
    message = str(first_error.get("msg", "Invalid request body."))
    if location:
        return f"Invalid request body: {location}: {message}"
    return f"Invalid request body: {message}"


def parse_request_model(
    payload: Any,
    model_type: type[BaseModel],
    *,
    partial: bool = False,
) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid request body: expected a JSON object.",
        )

    try:
        model = model_type.model_validate(payload)
    except ValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=format_validation_error(exc),
        ) from exc

    return model.model_dump(exclude_unset=partial)


def register_read_only_resource(resource: ReadOnlyResourceDef) -> None:
    async def list_endpoint(_: NotificatorReadUser, client: NotificatorClientDep) -> list[Any]:
        payload = await getattr(client, resource.list_method)()
        return [resource.response_model(**item) for item in payload]

    async def get_endpoint(
        item_id: int,
        _: NotificatorReadUser,
        client: NotificatorClientDep,
    ) -> Any:
        payload = await getattr(client, resource.get_method)(item_id)
        return resource.response_model(**payload)

    list_response_model: Any = GenericAlias(list, (resource.response_model,))

    router.add_api_route(
        resource.collection_path.value,
        list_endpoint,
        methods=["GET"],
        name=f"list_{resource.item_name}",
        response_model=list_response_model,
    )
    router.add_api_route(
        f"{resource.collection_path.value}/{{item_id}}",
        get_endpoint,
        methods=["GET"],
        name=f"get_{resource.item_name}",
        response_model=resource.response_model,
    )


def register_writable_resource(resource: WritableResourceDef) -> None:
    register_read_only_resource(resource)

    async def create_endpoint(
        _: NotificatorWriteUser,
        client: NotificatorClientDep,
        payload: Annotated[Any, Body()],
    ) -> Any:
        body = parse_request_model(payload, resource.create_model)
        response_payload = await getattr(client, resource.create_method)(body)
        return resource.response_model(**response_payload)

    async def update_endpoint(
        item_id: int,
        _: NotificatorWriteUser,
        client: NotificatorClientDep,
        payload: Annotated[Any, Body()],
    ) -> Any:
        body = parse_request_model(payload, resource.update_model)
        response_payload = await getattr(client, resource.update_method)(item_id, body)
        return resource.response_model(**response_payload)

    async def patch_endpoint(
        item_id: int,
        _: NotificatorWriteUser,
        client: NotificatorClientDep,
        payload: Annotated[Any, Body()],
    ) -> Any:
        body = parse_request_model(payload, resource.patch_model, partial=True)
        response_payload = await getattr(client, resource.patch_method)(item_id, body)
        return resource.response_model(**response_payload)

    async def delete_endpoint(
        item_id: int,
        _: NotificatorWriteUser,
        client: NotificatorClientDep,
    ) -> None:
        await getattr(client, resource.delete_method)(item_id)

    router.add_api_route(
        resource.collection_path.value,
        create_endpoint,
        methods=["POST"],
        name=f"create_{resource.item_name}",
        response_model=resource.response_model,
        status_code=status.HTTP_201_CREATED,
    )
    router.add_api_route(
        f"{resource.collection_path.value}/{{item_id}}",
        update_endpoint,
        methods=["PUT"],
        name=f"update_{resource.item_name}",
        response_model=resource.response_model,
    )
    router.add_api_route(
        f"{resource.collection_path.value}/{{item_id}}",
        patch_endpoint,
        methods=["PATCH"],
        name=f"patch_{resource.item_name}",
        response_model=resource.response_model,
    )
    router.add_api_route(
        f"{resource.collection_path.value}/{{item_id}}",
        delete_endpoint,
        methods=["DELETE"],
        name=f"delete_{resource.item_name}",
        status_code=status.HTTP_204_NO_CONTENT,
    )


@router.get(RoutePath.CHOICES.value, response_model=NotificatorChoicesResponse)
async def get_notificator_choices(
    _: NotificatorReadUser,
    client: NotificatorClientDep,
) -> NotificatorChoicesResponse:
    payload = await client.get_choices()
    return NotificatorChoicesResponse(**payload)


@router.get(
    RoutePath.NOTIFICATION_CONFIGS.value,
    response_model=list[NotificatorNotificationConfigResponse],
)
async def get_notificator_configs(
    _: NotificatorReadUser,
    client: NotificatorClientDep,
    product_team: str | None = Query(default=None),
) -> list[NotificatorNotificationConfigResponse]:
    payload = await client.list_notification_configs(product_team=product_team)
    return [NotificatorNotificationConfigResponse(**item) for item in payload]


@router.post(
    RoutePath.NOTIFICATION_CONFIGS.value,
    response_model=NotificatorNotificationConfigResponse,
    status_code=status.HTTP_201_CREATED,
)
async def post_notificator_config(
    _: NotificatorWriteUser,
    client: NotificatorClientDep,
    payload: Annotated[Any, Body()],
) -> NotificatorNotificationConfigResponse:
    body = parse_request_model(payload, NotificatorNotificationConfigCreate)
    response_payload = await client.create_notification_config(body)
    return NotificatorNotificationConfigResponse(**response_payload)


@router.get(
    f"{RoutePath.NOTIFICATION_CONFIGS.value}/{{item_id}}",
    response_model=NotificatorNotificationConfigResponse,
)
async def get_notificator_config(
    item_id: int,
    _: NotificatorReadUser,
    client: NotificatorClientDep,
) -> NotificatorNotificationConfigResponse:
    payload = await client.get_notification_config(item_id)
    return NotificatorNotificationConfigResponse(**payload)


@router.put(
    f"{RoutePath.NOTIFICATION_CONFIGS.value}/{{item_id}}",
    response_model=NotificatorNotificationConfigResponse,
)
async def put_notificator_config(
    item_id: int,
    _: NotificatorWriteUser,
    client: NotificatorClientDep,
    payload: Annotated[Any, Body()],
) -> NotificatorNotificationConfigResponse:
    body = parse_request_model(payload, NotificatorNotificationConfigUpdate)
    response_payload = await client.update_notification_config(item_id, body)
    return NotificatorNotificationConfigResponse(**response_payload)


@router.patch(
    f"{RoutePath.NOTIFICATION_CONFIGS.value}/{{item_id}}",
    response_model=NotificatorNotificationConfigResponse,
)
async def patch_notificator_config_route(
    item_id: int,
    _: NotificatorWriteUser,
    client: NotificatorClientDep,
    payload: Annotated[Any, Body()],
) -> NotificatorNotificationConfigResponse:
    body = parse_request_model(payload, NotificatorNotificationConfigPatch, partial=True)
    response_payload = await client.patch_notification_config(item_id, body)
    return NotificatorNotificationConfigResponse(**response_payload)


@router.delete(
    f"{RoutePath.NOTIFICATION_CONFIGS.value}/{{item_id}}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_notificator_config_route(
    item_id: int,
    _: NotificatorWriteUser,
    client: NotificatorClientDep,
) -> None:
    await client.delete_notification_config(item_id)


WRITABLE_RESOURCES: tuple[WritableResourceDef, ...] = (
    WritableResourceDef(
        collection_path=RoutePath.PRODUCTS,
        response_model=NotificatorProductResponse,
        list_method="list_products",
        get_method="get_product",
        item_name="notificator_product",
        create_model=NotificatorProductCreate,
        update_model=NotificatorProductUpdate,
        patch_model=NotificatorProductPatch,
        create_method="create_product",
        update_method="update_product",
        patch_method="patch_product",
        delete_method="delete_product",
    ),
    WritableResourceDef(
        collection_path=RoutePath.SUB_PRODUCTS,
        response_model=NotificatorSubProductResponse,
        list_method="list_sub_products",
        get_method="get_sub_product",
        item_name="notificator_sub_product",
        create_model=NotificatorSubProductCreate,
        update_model=NotificatorSubProductUpdate,
        patch_model=NotificatorSubProductPatch,
        create_method="create_sub_product",
        update_method="update_sub_product",
        patch_method="patch_sub_product",
        delete_method="delete_sub_product",
    ),
    WritableResourceDef(
        collection_path=RoutePath.SLACK_CHANNELS,
        response_model=NotificatorSlackChannelResponse,
        list_method="list_slack_channels",
        get_method="get_slack_channel",
        item_name="notificator_slack_channel",
        create_model=NotificatorSlackChannelCreate,
        update_model=NotificatorSlackChannelUpdate,
        patch_model=NotificatorSlackChannelPatch,
        create_method="create_slack_channel",
        update_method="update_slack_channel",
        patch_method="patch_slack_channel",
        delete_method="delete_slack_channel",
    ),
)

READ_ONLY_RESOURCES: tuple[ReadOnlyResourceDef, ...] = (
    ReadOnlyResourceDef(
        collection_path=RoutePath.TEAMS,
        response_model=NotificatorProductTeamResponse,
        list_method="list_teams",
        get_method="get_team",
        item_name="notificator_team",
    ),
    ReadOnlyResourceDef(
        collection_path=RoutePath.NOTIFICATOR_USERS,
        response_model=NotificatorUserResponse,
        list_method="list_users",
        get_method="get_user",
        item_name="notificator_user",
    ),
    ReadOnlyResourceDef(
        collection_path=RoutePath.QAA_MEMBERS,
        response_model=NotificatorQaaMemberResponse,
        list_method="list_qaa_members",
        get_method="get_qaa_member",
        item_name="notificator_qaa_member",
    ),
    ReadOnlyResourceDef(
        collection_path=RoutePath.FAILURE_MENTION_RULES,
        response_model=NotificatorFailureMentionRuleResponse,
        list_method="list_failure_mention_rules",
        get_method="get_failure_mention_rule",
        item_name="notificator_failure_mention_rule",
    ),
    ReadOnlyResourceDef(
        collection_path=RoutePath.EVENTS,
        response_model=NotificatorEventResponse,
        list_method="list_events",
        get_method="get_event",
        item_name="notificator_event",
    ),
    ReadOnlyResourceDef(
        collection_path=RoutePath.RECURRENT_FAILS,
        response_model=NotificatorRecurrentFailResponse,
        list_method="list_recurrent_fails",
        get_method="get_recurrent_fail",
        item_name="notificator_recurrent_fail",
    ),
    ReadOnlyResourceDef(
        collection_path=RoutePath.FAIL_REASONS,
        response_model=NotificatorFailReasonResponse,
        list_method="list_fail_reasons",
        get_method="get_fail_reason",
        item_name="notificator_fail_reason",
    ),
    ReadOnlyResourceDef(
        collection_path=RoutePath.MUTE_STATUSES,
        response_model=NotificatorMuteStatusResponse,
        list_method="list_mute_statuses",
        get_method="get_mute_status",
        item_name="notificator_mute_status",
    ),
    ReadOnlyResourceDef(
        collection_path=RoutePath.HISTORY,
        response_model=NotificatorHistoryItemResponse,
        list_method="list_history",
        get_method="get_history_item",
        item_name="notificator_history_item",
    ),
)

for writable_resource in WRITABLE_RESOURCES:
    register_writable_resource(writable_resource)

for read_only_resource in READ_ONLY_RESOURCES:
    register_read_only_resource(read_only_resource)
