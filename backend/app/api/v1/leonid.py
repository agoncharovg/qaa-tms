"""Leonid proxy routes."""

from __future__ import annotations

from dataclasses import dataclass
from types import GenericAlias
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends, HTTPException, status
from pydantic import BaseModel, ValidationError

from app.api.deps import get_leonid_client, require_permission
from app.core.constants import ApiTag, PermissionKey, RoutePath
from app.models.user import User
from app.schemas.leonid import (
    LeonidObjectDefinitionCreate,
    LeonidObjectDefinitionPatch,
    LeonidObjectDefinitionResponse,
    LeonidObjectDefinitionUpdate,
    LeonidObjectValueCreate,
    LeonidObjectValuePatch,
    LeonidObjectValueResponse,
    LeonidObjectValueUpdate,
    LeonidPipelineParamCreate,
    LeonidPipelineParamPatch,
    LeonidPipelineParamResponse,
    LeonidPipelineParamUpdate,
    LeonidSharedResourceCreate,
    LeonidSharedResourceLimitCreate,
    LeonidSharedResourceLimitPatch,
    LeonidSharedResourceLimitResponse,
    LeonidSharedResourceLimitTypeResponse,
    LeonidSharedResourceLimitUpdate,
    LeonidSharedResourcePatch,
    LeonidSharedResourceResponse,
    LeonidSharedResourceUpdate,
    LeonidSkippedSuiteCreate,
    LeonidSkippedSuiteResponse,
)
from app.services.leonid_client import LeonidClient

router = APIRouter(prefix=RoutePath.LEONID.value, tags=[ApiTag.LEONID.value])
LeonidReadUser = Annotated[User, Depends(require_permission(PermissionKey.LEONID_READ))]
LeonidWriteUser = Annotated[User, Depends(require_permission(PermissionKey.LEONID_WRITE))]
LeonidClientDep = Annotated[LeonidClient, Depends(get_leonid_client)]


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
    toggle_method: str | None = None


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
    async def list_endpoint(_: LeonidReadUser, client: LeonidClientDep) -> list[Any]:
        payload = await getattr(client, resource.list_method)()
        return [resource.response_model(**item) for item in payload]

    async def get_endpoint(item_id: int, _: LeonidReadUser, client: LeonidClientDep) -> Any:
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
        _: LeonidWriteUser,
        client: LeonidClientDep,
        payload: Annotated[Any, Body()],
    ) -> Any:
        body = parse_request_model(payload, resource.create_model)
        response_payload = await getattr(client, resource.create_method)(body)
        return resource.response_model(**response_payload)

    async def update_endpoint(
        item_id: int,
        _: LeonidWriteUser,
        client: LeonidClientDep,
        payload: Annotated[Any, Body()],
    ) -> Any:
        body = parse_request_model(payload, resource.update_model)
        response_payload = await getattr(client, resource.update_method)(item_id, body)
        return resource.response_model(**response_payload)

    async def patch_endpoint(
        item_id: int,
        _: LeonidWriteUser,
        client: LeonidClientDep,
        payload: Annotated[Any, Body()],
    ) -> Any:
        body = parse_request_model(payload, resource.patch_model, partial=True)
        response_payload = await getattr(client, resource.patch_method)(item_id, body)
        return resource.response_model(**response_payload)

    async def delete_endpoint(item_id: int, _: LeonidWriteUser, client: LeonidClientDep) -> None:
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

    if resource.toggle_method is None:
        return

    toggle_method = resource.toggle_method

    async def toggle_endpoint(
        item_id: int,
        _: LeonidWriteUser,
        client: LeonidClientDep,
    ) -> Any:
        payload = await getattr(client, toggle_method)(item_id)
        return resource.response_model(**payload)

    router.add_api_route(
        f"{resource.collection_path.value}/{{item_id}}{RoutePath.TOGGLE_ENABLED.value}",
        toggle_endpoint,
        methods=["POST"],
        name=f"toggle_{resource.item_name}",
        response_model=resource.response_model,
    )


@router.get(RoutePath.SKIPPED_SUITES.value, response_model=list[LeonidSkippedSuiteResponse])
async def list_skipped_suites(
    _: LeonidReadUser,
    client: LeonidClientDep,
) -> list[LeonidSkippedSuiteResponse]:
    payload = await client.list_skipped_suites()
    return [LeonidSkippedSuiteResponse(**item) for item in payload]


@router.get(
    f"{RoutePath.SKIPPED_SUITES.value}/{{item_id}}",
    response_model=LeonidSkippedSuiteResponse,
)
async def get_skipped_suite(
    item_id: int,
    _: LeonidReadUser,
    client: LeonidClientDep,
) -> LeonidSkippedSuiteResponse:
    payload = await client.get_skipped_suite(item_id)
    return LeonidSkippedSuiteResponse(**payload)


@router.post(
    RoutePath.SKIPPED_SUITES.value,
    response_model=LeonidSkippedSuiteResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_skipped_suite(
    user: LeonidWriteUser,
    client: LeonidClientDep,
    payload: Annotated[Any, Body()],
) -> LeonidSkippedSuiteResponse:
    body = parse_request_model(payload, LeonidSkippedSuiteCreate)
    body["author"] = user.username
    response_payload = await client.create_skipped_suite(body)
    return LeonidSkippedSuiteResponse(**response_payload)


@router.post(
    f"{RoutePath.SKIPPED_SUITES.value}/{{item_id}}{RoutePath.CANCEL.value}",
    response_model=LeonidSkippedSuiteResponse,
)
async def cancel_skipped_suite(
    item_id: int,
    user: LeonidWriteUser,
    client: LeonidClientDep,
) -> LeonidSkippedSuiteResponse:
    payload = await client.cancel_skipped_suite(item_id, {"cancelled_by": user.username})
    return LeonidSkippedSuiteResponse(**payload)


RESOURCES: tuple[ReadOnlyResourceDef | WritableResourceDef, ...] = (
    ReadOnlyResourceDef(
        collection_path=RoutePath.SHARED_RESOURCE_LIMIT_TYPES,
        response_model=LeonidSharedResourceLimitTypeResponse,
        list_method="list_shared_resource_limit_types",
        get_method="get_shared_resource_limit_type",
        item_name="leonid_shared_resource_limit_type",
    ),
    WritableResourceDef(
        collection_path=RoutePath.SHARED_RESOURCE_LIMITS,
        response_model=LeonidSharedResourceLimitResponse,
        list_method="list_shared_resource_limits",
        get_method="get_shared_resource_limit",
        item_name="leonid_shared_resource_limit",
        create_model=LeonidSharedResourceLimitCreate,
        update_model=LeonidSharedResourceLimitUpdate,
        patch_model=LeonidSharedResourceLimitPatch,
        create_method="create_shared_resource_limit",
        update_method="update_shared_resource_limit",
        patch_method="patch_shared_resource_limit",
        delete_method="delete_shared_resource_limit",
    ),
    WritableResourceDef(
        collection_path=RoutePath.SHARED_RESOURCES,
        response_model=LeonidSharedResourceResponse,
        list_method="list_shared_resources",
        get_method="get_shared_resource",
        item_name="leonid_shared_resource",
        create_model=LeonidSharedResourceCreate,
        update_model=LeonidSharedResourceUpdate,
        patch_model=LeonidSharedResourcePatch,
        create_method="create_shared_resource",
        update_method="update_shared_resource",
        patch_method="patch_shared_resource",
        delete_method="delete_shared_resource",
        toggle_method="toggle_shared_resource",
    ),
    WritableResourceDef(
        collection_path=RoutePath.OBJECT_DEFINITIONS,
        response_model=LeonidObjectDefinitionResponse,
        list_method="list_object_definitions",
        get_method="get_object_definition",
        item_name="leonid_object_definition",
        create_model=LeonidObjectDefinitionCreate,
        update_model=LeonidObjectDefinitionUpdate,
        patch_model=LeonidObjectDefinitionPatch,
        create_method="create_object_definition",
        update_method="update_object_definition",
        patch_method="patch_object_definition",
        delete_method="delete_object_definition",
        toggle_method="toggle_object_definition",
    ),
    WritableResourceDef(
        collection_path=RoutePath.OBJECT_VALUES,
        response_model=LeonidObjectValueResponse,
        list_method="list_object_values",
        get_method="get_object_value",
        item_name="leonid_object_value",
        create_model=LeonidObjectValueCreate,
        update_model=LeonidObjectValueUpdate,
        patch_model=LeonidObjectValuePatch,
        create_method="create_object_value",
        update_method="update_object_value",
        patch_method="patch_object_value",
        delete_method="delete_object_value",
        toggle_method="toggle_object_value",
    ),
    WritableResourceDef(
        collection_path=RoutePath.PIPELINE_PARAMS,
        response_model=LeonidPipelineParamResponse,
        list_method="list_pipeline_params",
        get_method="get_pipeline_param",
        item_name="leonid_pipeline_param",
        create_model=LeonidPipelineParamCreate,
        update_model=LeonidPipelineParamUpdate,
        patch_model=LeonidPipelineParamPatch,
        create_method="create_pipeline_param",
        update_method="update_pipeline_param",
        patch_method="patch_pipeline_param",
        delete_method="delete_pipeline_param",
    ),
)

for resource in RESOURCES:
    if isinstance(resource, WritableResourceDef):
        register_writable_resource(resource)
    else:
        register_read_only_resource(resource)
