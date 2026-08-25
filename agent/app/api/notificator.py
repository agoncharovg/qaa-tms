"""Notificator proxy routes."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from pydantic import BaseModel, ValidationError

from app.api.deps import AuthContext, get_settings, require_permission
from app.core.config import Settings
from app.core.constants import AgentPath, ErrorMessage, PermissionKey
from app.schemas import (
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
from app.services.notificator import (
    NotificatorNotConfiguredError,
    NotificatorUnreachableError,
    create_notification_config,
    create_product,
    create_slack_channel,
    create_sub_product,
    delete_notification_config,
    delete_product,
    delete_slack_channel,
    delete_sub_product,
    get_choices,
    get_event,
    get_fail_reason,
    get_failure_mention_rule,
    get_history_item,
    get_mute_status,
    get_notification_config,
    get_product,
    get_qaa_member,
    get_recurrent_fail,
    get_slack_channel,
    get_sub_product,
    get_team,
    get_user,
    list_events,
    list_fail_reasons,
    list_failure_mention_rules,
    list_history,
    list_mute_statuses,
    list_notification_configs,
    list_products,
    list_qaa_members,
    list_recurrent_fails,
    list_slack_channels,
    list_sub_products,
    list_teams,
    list_users,
    patch_notification_config,
    patch_product,
    patch_slack_channel,
    patch_sub_product,
    update_notification_config,
    update_product,
    update_slack_channel,
    update_sub_product,
)

router = APIRouter()
SettingsDep = Annotated[Settings, Depends(get_settings)]
NotificatorReadAuth = Annotated[
    AuthContext, Depends(require_permission(PermissionKey.NOTIFICATOR_READ))
]
NotificatorWriteAuth = Annotated[
    AuthContext, Depends(require_permission(PermissionKey.NOTIFICATOR_WRITE))
]

ListService = Callable[[Settings], Awaitable[list[dict[str, Any]]]]
GetService = Callable[[Settings, int], Awaitable[dict[str, Any]]]
CreateService = Callable[[Settings, dict[str, Any]], Awaitable[dict[str, Any]]]
UpdateService = Callable[[Settings, int, dict[str, Any]], Awaitable[dict[str, Any]]]
DeleteService = Callable[[Settings, int], Awaitable[None]]


@dataclass(frozen=True)
class ReadOnlyResourceDef:
    path: AgentPath
    response_model: type[BaseModel]
    list_service: ListService
    get_service: GetService
    item_name: str


@dataclass(frozen=True)
class WritableResourceDef(ReadOnlyResourceDef):
    create_model: type[BaseModel]
    update_model: type[BaseModel]
    patch_model: type[BaseModel]
    create_service: CreateService
    update_service: UpdateService
    patch_service: UpdateService
    delete_service: DeleteService


def require_notificator_configured(settings: Settings) -> None:
    if not settings.notificator_configured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=ErrorMessage.NOTIFICATOR_NOT_CONFIGURED.value,
        )


def raise_notificator_http_error(
    exc: NotificatorNotConfiguredError | NotificatorUnreachableError,
) -> None:
    if isinstance(exc, NotificatorNotConfiguredError):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    raise HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail=str(exc),
    ) from exc


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
    async def list_endpoint(
        _: NotificatorReadAuth,
        settings: SettingsDep,
        service: ListService = resource.list_service,
        model_type: type[BaseModel] = resource.response_model,
    ) -> list[Any]:
        require_notificator_configured(settings)
        try:
            payload = await service(settings)
        except (NotificatorNotConfiguredError, NotificatorUnreachableError) as exc:
            raise_notificator_http_error(exc)
        return [model_type(**item) for item in payload]

    async def get_endpoint(
        item_id: int,
        _: NotificatorReadAuth,
        settings: SettingsDep,
        service: GetService = resource.get_service,
        model_type: type[BaseModel] = resource.response_model,
    ) -> Any:
        require_notificator_configured(settings)
        try:
            payload = await service(settings, item_id)
        except (NotificatorNotConfiguredError, NotificatorUnreachableError) as exc:
            raise_notificator_http_error(exc)
        return model_type(**payload)

    router.add_api_route(
        resource.path.value,
        list_endpoint,
        methods=["GET"],
        name=f"list_{resource.item_name}",
        response_model=list[resource.response_model],  # type: ignore[name-defined]
    )
    router.add_api_route(
        f"{resource.path.value}/{{item_id}}",
        get_endpoint,
        methods=["GET"],
        name=f"get_{resource.item_name}",
        response_model=resource.response_model,
    )


def register_writable_resource(resource: WritableResourceDef) -> None:
    register_read_only_resource(resource)

    async def create_endpoint(
        _: NotificatorWriteAuth,
        settings: SettingsDep,
        payload: Annotated[Any, Body()],
        request_model: type[BaseModel] = resource.create_model,
        service: CreateService = resource.create_service,
        response_model: type[BaseModel] = resource.response_model,
    ) -> Any:
        require_notificator_configured(settings)
        body = parse_request_model(payload, request_model)
        try:
            response_payload = await service(settings, body)
        except (NotificatorNotConfiguredError, NotificatorUnreachableError) as exc:
            raise_notificator_http_error(exc)
        return response_model(**response_payload)

    async def update_endpoint(
        item_id: int,
        _: NotificatorWriteAuth,
        settings: SettingsDep,
        payload: Annotated[Any, Body()],
        request_model: type[BaseModel] = resource.update_model,
        service: UpdateService = resource.update_service,
        response_model: type[BaseModel] = resource.response_model,
    ) -> Any:
        require_notificator_configured(settings)
        body = parse_request_model(payload, request_model)
        try:
            response_payload = await service(settings, item_id, body)
        except (NotificatorNotConfiguredError, NotificatorUnreachableError) as exc:
            raise_notificator_http_error(exc)
        return response_model(**response_payload)

    async def patch_endpoint(
        item_id: int,
        _: NotificatorWriteAuth,
        settings: SettingsDep,
        payload: Annotated[Any, Body()],
        request_model: type[BaseModel] = resource.patch_model,
        service: UpdateService = resource.patch_service,
        response_model: type[BaseModel] = resource.response_model,
    ) -> Any:
        require_notificator_configured(settings)
        body = parse_request_model(payload, request_model, partial=True)
        try:
            response_payload = await service(settings, item_id, body)
        except (NotificatorNotConfiguredError, NotificatorUnreachableError) as exc:
            raise_notificator_http_error(exc)
        return response_model(**response_payload)

    async def delete_endpoint(
        item_id: int,
        _: NotificatorWriteAuth,
        settings: SettingsDep,
        service: DeleteService = resource.delete_service,
    ) -> None:
        require_notificator_configured(settings)
        try:
            await service(settings, item_id)
        except (NotificatorNotConfiguredError, NotificatorUnreachableError) as exc:
            raise_notificator_http_error(exc)

    router.add_api_route(
        resource.path.value,
        create_endpoint,
        methods=["POST"],
        name=f"create_{resource.item_name}",
        response_model=resource.response_model,
        status_code=status.HTTP_201_CREATED,
    )
    router.add_api_route(
        f"{resource.path.value}/{{item_id}}",
        update_endpoint,
        methods=["PUT"],
        name=f"update_{resource.item_name}",
        response_model=resource.response_model,
    )
    router.add_api_route(
        f"{resource.path.value}/{{item_id}}",
        patch_endpoint,
        methods=["PATCH"],
        name=f"patch_{resource.item_name}",
        response_model=resource.response_model,
    )
    router.add_api_route(
        f"{resource.path.value}/{{item_id}}",
        delete_endpoint,
        methods=["DELETE"],
        name=f"delete_{resource.item_name}",
        status_code=status.HTTP_204_NO_CONTENT,
    )


@router.get(
    AgentPath.NOTIFICATOR_CHOICES.value,
    response_model=NotificatorChoicesResponse,
)
async def get_notificator_choices(
    _: NotificatorReadAuth,
    settings: SettingsDep,
) -> NotificatorChoicesResponse:
    require_notificator_configured(settings)
    try:
        payload = await get_choices(settings)
    except (NotificatorNotConfiguredError, NotificatorUnreachableError) as exc:
        raise_notificator_http_error(exc)
    return NotificatorChoicesResponse(**payload)


@router.get(
    AgentPath.NOTIFICATOR_CONFIGS.value,
    response_model=list[NotificatorNotificationConfigResponse],
)
async def get_notificator_configs(
    _: NotificatorReadAuth,
    settings: SettingsDep,
    product_team: str | None = Query(default=None),
) -> list[NotificatorNotificationConfigResponse]:
    require_notificator_configured(settings)
    try:
        payload = await list_notification_configs(settings, product_team=product_team)
    except (NotificatorNotConfiguredError, NotificatorUnreachableError) as exc:
        raise_notificator_http_error(exc)
    return [NotificatorNotificationConfigResponse(**item) for item in payload]


@router.post(
    AgentPath.NOTIFICATOR_CONFIGS.value,
    response_model=NotificatorNotificationConfigResponse,
    status_code=status.HTTP_201_CREATED,
)
async def post_notificator_config(
    _: NotificatorWriteAuth,
    settings: SettingsDep,
    payload: Annotated[Any, Body()],
) -> NotificatorNotificationConfigResponse:
    require_notificator_configured(settings)
    body = parse_request_model(payload, NotificatorNotificationConfigCreate)
    try:
        response_payload = await create_notification_config(settings, body)
    except (NotificatorNotConfiguredError, NotificatorUnreachableError) as exc:
        raise_notificator_http_error(exc)
    return NotificatorNotificationConfigResponse(**response_payload)


@router.get(
    f"{AgentPath.NOTIFICATOR_CONFIGS.value}/{{item_id}}",
    response_model=NotificatorNotificationConfigResponse,
)
async def get_notificator_config(
    item_id: int,
    _: NotificatorReadAuth,
    settings: SettingsDep,
) -> NotificatorNotificationConfigResponse:
    require_notificator_configured(settings)
    try:
        payload = await get_notification_config(settings, item_id)
    except (NotificatorNotConfiguredError, NotificatorUnreachableError) as exc:
        raise_notificator_http_error(exc)
    return NotificatorNotificationConfigResponse(**payload)


@router.put(
    f"{AgentPath.NOTIFICATOR_CONFIGS.value}/{{item_id}}",
    response_model=NotificatorNotificationConfigResponse,
)
async def put_notificator_config(
    item_id: int,
    _: NotificatorWriteAuth,
    settings: SettingsDep,
    payload: Annotated[Any, Body()],
) -> NotificatorNotificationConfigResponse:
    require_notificator_configured(settings)
    body = parse_request_model(payload, NotificatorNotificationConfigUpdate)
    try:
        response_payload = await update_notification_config(settings, item_id, body)
    except (NotificatorNotConfiguredError, NotificatorUnreachableError) as exc:
        raise_notificator_http_error(exc)
    return NotificatorNotificationConfigResponse(**response_payload)


@router.patch(
    f"{AgentPath.NOTIFICATOR_CONFIGS.value}/{{item_id}}",
    response_model=NotificatorNotificationConfigResponse,
)
async def patch_notificator_config_route(
    item_id: int,
    _: NotificatorWriteAuth,
    settings: SettingsDep,
    payload: Annotated[Any, Body()],
) -> NotificatorNotificationConfigResponse:
    require_notificator_configured(settings)
    body = parse_request_model(payload, NotificatorNotificationConfigPatch, partial=True)
    try:
        response_payload = await patch_notification_config(settings, item_id, body)
    except (NotificatorNotConfiguredError, NotificatorUnreachableError) as exc:
        raise_notificator_http_error(exc)
    return NotificatorNotificationConfigResponse(**response_payload)


@router.delete(
    f"{AgentPath.NOTIFICATOR_CONFIGS.value}/{{item_id}}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_notificator_config_route(
    item_id: int,
    _: NotificatorWriteAuth,
    settings: SettingsDep,
) -> None:
    require_notificator_configured(settings)
    try:
        await delete_notification_config(settings, item_id)
    except (NotificatorNotConfiguredError, NotificatorUnreachableError) as exc:
        raise_notificator_http_error(exc)


WRITABLE_RESOURCES: tuple[WritableResourceDef, ...] = (
    WritableResourceDef(
        path=AgentPath.NOTIFICATOR_PRODUCTS,
        response_model=NotificatorProductResponse,
        list_service=list_products,
        get_service=get_product,
        item_name="notificator_product",
        create_model=NotificatorProductCreate,
        update_model=NotificatorProductUpdate,
        patch_model=NotificatorProductPatch,
        create_service=create_product,
        update_service=update_product,
        patch_service=patch_product,
        delete_service=delete_product,
    ),
    WritableResourceDef(
        path=AgentPath.NOTIFICATOR_SUB_PRODUCTS,
        response_model=NotificatorSubProductResponse,
        list_service=list_sub_products,
        get_service=get_sub_product,
        item_name="notificator_sub_product",
        create_model=NotificatorSubProductCreate,
        update_model=NotificatorSubProductUpdate,
        patch_model=NotificatorSubProductPatch,
        create_service=create_sub_product,
        update_service=update_sub_product,
        patch_service=patch_sub_product,
        delete_service=delete_sub_product,
    ),
    WritableResourceDef(
        path=AgentPath.NOTIFICATOR_SLACK_CHANNELS,
        response_model=NotificatorSlackChannelResponse,
        list_service=list_slack_channels,
        get_service=get_slack_channel,
        item_name="notificator_slack_channel",
        create_model=NotificatorSlackChannelCreate,
        update_model=NotificatorSlackChannelUpdate,
        patch_model=NotificatorSlackChannelPatch,
        create_service=create_slack_channel,
        update_service=update_slack_channel,
        patch_service=patch_slack_channel,
        delete_service=delete_slack_channel,
    ),
)

READ_ONLY_RESOURCES: tuple[ReadOnlyResourceDef, ...] = (
    ReadOnlyResourceDef(
        path=AgentPath.NOTIFICATOR_TEAMS,
        response_model=NotificatorProductTeamResponse,
        list_service=list_teams,
        get_service=get_team,
        item_name="notificator_team",
    ),
    ReadOnlyResourceDef(
        path=AgentPath.NOTIFICATOR_USERS,
        response_model=NotificatorUserResponse,
        list_service=list_users,
        get_service=get_user,
        item_name="notificator_user",
    ),
    ReadOnlyResourceDef(
        path=AgentPath.NOTIFICATOR_QAA_MEMBERS,
        response_model=NotificatorQaaMemberResponse,
        list_service=list_qaa_members,
        get_service=get_qaa_member,
        item_name="notificator_qaa_member",
    ),
    ReadOnlyResourceDef(
        path=AgentPath.NOTIFICATOR_FAILURE_MENTION_RULES,
        response_model=NotificatorFailureMentionRuleResponse,
        list_service=list_failure_mention_rules,
        get_service=get_failure_mention_rule,
        item_name="notificator_failure_mention_rule",
    ),
    ReadOnlyResourceDef(
        path=AgentPath.NOTIFICATOR_EVENTS,
        response_model=NotificatorEventResponse,
        list_service=list_events,
        get_service=get_event,
        item_name="notificator_event",
    ),
    ReadOnlyResourceDef(
        path=AgentPath.NOTIFICATOR_RECURRENT_FAILS,
        response_model=NotificatorRecurrentFailResponse,
        list_service=list_recurrent_fails,
        get_service=get_recurrent_fail,
        item_name="notificator_recurrent_fail",
    ),
    ReadOnlyResourceDef(
        path=AgentPath.NOTIFICATOR_FAIL_REASONS,
        response_model=NotificatorFailReasonResponse,
        list_service=list_fail_reasons,
        get_service=get_fail_reason,
        item_name="notificator_fail_reason",
    ),
    ReadOnlyResourceDef(
        path=AgentPath.NOTIFICATOR_MUTE_STATUSES,
        response_model=NotificatorMuteStatusResponse,
        list_service=list_mute_statuses,
        get_service=get_mute_status,
        item_name="notificator_mute_status",
    ),
    ReadOnlyResourceDef(
        path=AgentPath.NOTIFICATOR_HISTORY,
        response_model=NotificatorHistoryItemResponse,
        list_service=list_history,
        get_service=get_history_item,
        item_name="notificator_history_item",
    ),
)

for writable_resource in WRITABLE_RESOURCES:
    register_writable_resource(writable_resource)

for read_only_resource in READ_ONLY_RESOURCES:
    register_read_only_resource(read_only_resource)
