"""Server operational settings schemas."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from app.core.config import Settings


class ServerSettingsRead(BaseModel):
    qaa_generator_base_url: str
    qaa_generator_superuser_token_set: bool
    qaa_generator_port_forward_enabled: bool
    qaa_generator_port_forward_namespace: str
    qaa_generator_port_forward_resource: str
    qaa_generator_port_forward_local_port: int
    qaa_generator_port_forward_remote_port: int


class ServerSettingsUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    qaa_generator_base_url: str | None = None
    qaa_generator_superuser_token: str | None = None
    qaa_generator_port_forward_enabled: bool | None = None
    qaa_generator_port_forward_namespace: str | None = None
    qaa_generator_port_forward_resource: str | None = None
    qaa_generator_port_forward_local_port: int | None = None
    qaa_generator_port_forward_remote_port: int | None = None


def to_server_settings_read(settings: Settings) -> ServerSettingsRead:
    return ServerSettingsRead(
        qaa_generator_base_url=settings.qaa_generator_base_url,
        qaa_generator_superuser_token_set=bool(settings.qaa_generator_superuser_token),
        qaa_generator_port_forward_enabled=settings.qaa_generator_port_forward_enabled,
        qaa_generator_port_forward_namespace=settings.qaa_generator_port_forward_namespace,
        qaa_generator_port_forward_resource=settings.qaa_generator_port_forward_resource,
        qaa_generator_port_forward_local_port=settings.qaa_generator_port_forward_local_port,
        qaa_generator_port_forward_remote_port=settings.qaa_generator_port_forward_remote_port,
    )
