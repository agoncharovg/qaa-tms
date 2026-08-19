"""qaa-generator transport helpers."""

from __future__ import annotations

from dataclasses import dataclass

from app.core.config import Settings


@dataclass(frozen=True)
class QaaGeneratorRuntime:
    base_url: str


def resolve_qaa_generator_runtime(settings: Settings) -> QaaGeneratorRuntime:
    return QaaGeneratorRuntime(base_url=settings.qaa_generator_base_url)
