"""Server operational settings routes.

`Profile -> Settings` is the single editing surface in the SPA, but the values
still persist to their real consumer surfaces instead of a fictional shared
file. For backend settings, that surface is this package's `.env`.

qaa-generator transport settings that affect the outbound base URL or
port-forward process still require a backend restart, because the HTTP client
and optional port-forward are prepared at startup.
"""

from __future__ import annotations

from typing import cast

from fastapi import APIRouter, Request

from app.api.deps import AdminUser
from app.core import env_file
from app.core.config import Settings
from app.core.config import get_settings as load_settings
from app.core.constants import ApiTag, EnvKey, RoutePath
from app.schemas.settings import (
    ServerSettingsRead,
    ServerSettingsUpdateRequest,
    to_server_settings_read,
)

router = APIRouter(tags=[ApiTag.SYSTEM.value])

BOOL_ENV_VALUE = {
    False: "false",
    True: "true",
}

SERVER_SETTINGS_ENV_KEY_BY_FIELD = {
    "qaa_generator_base_url": EnvKey.QAA_GENERATOR_BASE_URL,
    "qaa_generator_port_forward_enabled": EnvKey.QAA_GENERATOR_PORT_FORWARD_ENABLED,
    "qaa_generator_port_forward_local_port": EnvKey.QAA_GENERATOR_PORT_FORWARD_LOCAL_PORT,
    "qaa_generator_port_forward_namespace": EnvKey.QAA_GENERATOR_PORT_FORWARD_NAMESPACE,
    "qaa_generator_port_forward_remote_port": EnvKey.QAA_GENERATOR_PORT_FORWARD_REMOTE_PORT,
    "qaa_generator_port_forward_resource": EnvKey.QAA_GENERATOR_PORT_FORWARD_RESOURCE,
    "qaa_generator_superuser_token": EnvKey.QAA_GENERATOR_SUPERUSER_TOKEN,
}

SERVER_SETTINGS_RUNTIME_FIELDS = tuple(SERVER_SETTINGS_ENV_KEY_BY_FIELD)


def get_runtime_settings(request: Request) -> Settings:
    return cast(Settings, request.app.state.settings)


def serialize_env_value(value: object) -> str:
    if isinstance(value, bool):
        return BOOL_ENV_VALUE[value]
    return str(value)


def build_env_updates(payload: ServerSettingsUpdateRequest) -> dict[str, str]:
    updates: dict[str, str] = {}
    for field_name in payload.model_fields_set:
        value = getattr(payload, field_name)
        if value is None:
            continue
        updates[SERVER_SETTINGS_ENV_KEY_BY_FIELD[field_name].value] = serialize_env_value(value)
    return updates


def merge_runtime_settings(current_settings: Settings, refreshed_settings: Settings) -> Settings:
    return current_settings.model_copy(
        update={
            field_name: getattr(refreshed_settings, field_name)
            for field_name in SERVER_SETTINGS_RUNTIME_FIELDS
        }
    )


@router.get(RoutePath.SETTINGS.value, response_model=ServerSettingsRead)
async def get_server_settings(_: AdminUser, request: Request) -> ServerSettingsRead:
    return to_server_settings_read(get_runtime_settings(request))


@router.put(RoutePath.SETTINGS.value, response_model=ServerSettingsRead)
async def update_server_settings(
    payload: ServerSettingsUpdateRequest,
    _: AdminUser,
    request: Request,
) -> ServerSettingsRead:
    updates = build_env_updates(payload)
    if not updates:
        return to_server_settings_read(get_runtime_settings(request))

    env_file.upsert_env_values(env_file.BACKEND_ENV_FILE, updates)
    load_settings.cache_clear()
    current_settings = get_runtime_settings(request)
    refreshed_settings = load_settings()
    request.app.state.settings = merge_runtime_settings(current_settings, refreshed_settings)

    return to_server_settings_read(get_runtime_settings(request))
