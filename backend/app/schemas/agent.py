"""Companion artifact schemas."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class AgentManifestResponse(BaseModel):
    """Bundled companion source metadata exposed to the SPA."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    version: str
    min_supported: str = Field(alias="minSupported")
    download_url: str = Field(alias="downloadUrl")
    sha256: str
    os: str | None = None
