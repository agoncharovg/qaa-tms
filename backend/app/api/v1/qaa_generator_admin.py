"""QAA generator admin proxy routes."""

from __future__ import annotations

from enum import StrEnum
from typing import cast

import httpx
from fastapi import APIRouter, Query, Request, Response, status
from fastapi.responses import JSONResponse

from app.api.deps import AdminUser
from app.core.config import Settings
from app.core.constants import ApiTag, HttpMethod, MediaType, RoutePath
from app.schemas.qaa_generator import (
    QaaServiceTokenCreateRequest,
    QaaUserCreateRequest,
    QaaUserUpdateRequest,
)
from app.services.qaa_generator import (
    QaaGeneratorJsonResponse,
    QaaGeneratorServicePath,
    QaaGeneratorTokenMode,
    build_outbound_headers,
    build_qaa_service_token_regenerate_path,
    build_qaa_service_token_revoke_path,
    build_qaa_user_path,
    build_qaa_user_token_regenerate_path,
    request_json,
)

router = APIRouter(tags=[ApiTag.QAA_GENERATOR.value])



class QaaAdminListQueryParam(StrEnum):
    EMAIL = "email"
    KIND = "kind"
    LIMIT = "limit"
    OFFSET = "offset"
    SLACK_USER_ID = "slack_user_id"


def get_qaa_client(request: Request) -> httpx.AsyncClient:
    return cast(httpx.AsyncClient, request.app.state.qaa_generator_client)


def get_settings(request: Request) -> Settings:
    return cast(Settings, request.app.state.settings)


def build_proxy_response(result: QaaGeneratorJsonResponse) -> Response:
    if result.status_code == status.HTTP_204_NO_CONTENT:
        return Response(status_code=result.status_code)
    return JSONResponse(content=result.payload, status_code=result.status_code)


def build_list_params(
    *,
    email: str | None,
    kind: str | None,
    slack_user_id: str | None,
    limit: int | None,
    offset: int | None,
) -> list[tuple[str, str]]:
    params: list[tuple[str, str]] = []
    if email:
        params.append((QaaAdminListQueryParam.EMAIL.value, email))
    if kind:
        params.append((QaaAdminListQueryParam.KIND.value, kind))
    if slack_user_id:
        params.append((QaaAdminListQueryParam.SLACK_USER_ID.value, slack_user_id))
    if limit is not None:
        params.append((QaaAdminListQueryParam.LIMIT.value, str(limit)))
    if offset is not None:
        params.append((QaaAdminListQueryParam.OFFSET.value, str(offset)))
    return params


def build_admin_headers(settings: Settings) -> dict[str, str]:
    return build_outbound_headers(
        settings,
        accept=MediaType.JSON,
        token_mode=QaaGeneratorTokenMode.SUPERUSER,
    )


@router.get(RoutePath.QAA_ADMIN_USERS.value)
async def list_qaa_users(
    request: Request,
    _: AdminUser,
    email: str | None = None,
    kind: str | None = Query(default=None),
    slack_user_id: str | None = None,
    limit: int | None = Query(default=None, ge=1),
    offset: int | None = Query(default=None, ge=0),
) -> Response:
    client = get_qaa_client(request)
    result = await request_json(
        client,
        method=HttpMethod.GET.value,
        path=QaaGeneratorServicePath.USERS.value,
        headers=build_admin_headers(get_settings(request)),
        token_mode=QaaGeneratorTokenMode.SUPERUSER,
        params=build_list_params(
            email=email,
            kind=kind,
            slack_user_id=slack_user_id,
            limit=limit,
            offset=offset,
        ),
    )
    return build_proxy_response(result)


@router.post(RoutePath.QAA_ADMIN_USERS.value)
async def create_qaa_user(
    payload: QaaUserCreateRequest,
    request: Request,
    _: AdminUser,
) -> Response:
    client = get_qaa_client(request)
    result = await request_json(
        client,
        method=HttpMethod.POST.value,
        path=QaaGeneratorServicePath.USERS.value,
        headers=build_admin_headers(get_settings(request)),
        token_mode=QaaGeneratorTokenMode.SUPERUSER,
        json_body=payload.model_dump(mode="json"),
    )
    return build_proxy_response(result)


@router.get(f"{RoutePath.QAA_ADMIN_USERS.value}{RoutePath.QAA_ADMIN_USER_BY_ID.value}")
async def get_qaa_user(
    user_id: str,
    request: Request,
    _: AdminUser,
) -> Response:
    client = get_qaa_client(request)
    result = await request_json(
        client,
        method=HttpMethod.GET.value,
        path=build_qaa_user_path(user_id),
        headers=build_admin_headers(get_settings(request)),
        token_mode=QaaGeneratorTokenMode.SUPERUSER,
    )
    return build_proxy_response(result)


@router.patch(f"{RoutePath.QAA_ADMIN_USERS.value}{RoutePath.QAA_ADMIN_USER_BY_ID.value}")
async def update_qaa_user(
    user_id: str,
    payload: QaaUserUpdateRequest,
    request: Request,
    _: AdminUser,
) -> Response:
    client = get_qaa_client(request)
    result = await request_json(
        client,
        method=HttpMethod.PATCH.value,
        path=build_qaa_user_path(user_id),
        headers=build_admin_headers(get_settings(request)),
        token_mode=QaaGeneratorTokenMode.SUPERUSER,
        json_body=payload.model_dump(mode="json", exclude_unset=True),
    )
    return build_proxy_response(result)


@router.delete(
    f"{RoutePath.QAA_ADMIN_USERS.value}{RoutePath.QAA_ADMIN_USER_BY_ID.value}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_qaa_user(
    user_id: str,
    request: Request,
    _: AdminUser,
) -> Response:
    client = get_qaa_client(request)
    result = await request_json(
        client,
        method=HttpMethod.DELETE.value,
        path=build_qaa_user_path(user_id),
        headers=build_admin_headers(get_settings(request)),
        token_mode=QaaGeneratorTokenMode.SUPERUSER,
    )
    return build_proxy_response(result)


@router.post(
    f"{RoutePath.QAA_ADMIN_USERS.value}{RoutePath.QAA_ADMIN_USER_BY_ID.value}{RoutePath.REGENERATE.value}"
)
async def regenerate_qaa_user_token(
    user_id: str,
    request: Request,
    _: AdminUser,
) -> Response:
    client = get_qaa_client(request)
    result = await request_json(
        client,
        method=HttpMethod.POST.value,
        path=build_qaa_user_token_regenerate_path(user_id, RoutePath.REGENERATE.value),
        headers=build_admin_headers(get_settings(request)),
        token_mode=QaaGeneratorTokenMode.SUPERUSER,
    )
    return build_proxy_response(result)


@router.post(RoutePath.QAA_ADMIN_SERVICE_TOKENS.value)
async def create_qaa_service_token(
    payload: QaaServiceTokenCreateRequest,
    request: Request,
    _: AdminUser,
) -> Response:
    client = get_qaa_client(request)
    result = await request_json(
        client,
        method=HttpMethod.POST.value,
        path=QaaGeneratorServicePath.SERVICE_TOKENS.value,
        headers=build_admin_headers(get_settings(request)),
        token_mode=QaaGeneratorTokenMode.SUPERUSER,
        json_body=payload.model_dump(mode="json"),
    )
    return build_proxy_response(result)


@router.post(
    f"{RoutePath.QAA_ADMIN_SERVICE_TOKENS.value}{RoutePath.QAA_ADMIN_SERVICE_TOKEN_BY_ID.value}{RoutePath.SERVICE_TOKEN_REGENERATE.value}"
)
async def regenerate_qaa_service_token(
    token_id: str,
    request: Request,
    _: AdminUser,
) -> Response:
    client = get_qaa_client(request)
    result = await request_json(
        client,
        method=HttpMethod.POST.value,
        path=build_qaa_service_token_regenerate_path(
            token_id,
            RoutePath.SERVICE_TOKEN_REGENERATE.value,
        ),
        headers=build_admin_headers(get_settings(request)),
        token_mode=QaaGeneratorTokenMode.SUPERUSER,
    )
    return build_proxy_response(result)


@router.post(
    f"{RoutePath.QAA_ADMIN_SERVICE_TOKENS.value}{RoutePath.QAA_ADMIN_SERVICE_TOKEN_BY_ID.value}{RoutePath.REVOKE.value}"
)
async def revoke_qaa_service_token(
    token_id: str,
    request: Request,
    _: AdminUser,
) -> Response:
    client = get_qaa_client(request)
    result = await request_json(
        client,
        method=HttpMethod.POST.value,
        path=build_qaa_service_token_revoke_path(token_id, RoutePath.REVOKE.value),
        headers=build_admin_headers(get_settings(request)),
        token_mode=QaaGeneratorTokenMode.SUPERUSER,
    )
    return build_proxy_response(result)
