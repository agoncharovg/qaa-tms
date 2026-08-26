"""LLM model configuration parsing and resolution."""

from __future__ import annotations

import json
from dataclasses import dataclass
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.core.config import Settings
from app.core.constants import LlmProvider


class LlmModelsErrorMessage(StrEnum):
    INVALID_JSON = "LLM models must be a valid JSON array."
    INVALID_SHAPE = "LLM models must be a JSON array of model objects."
    MISSING_PROVIDER_KEY = "The selected provider API key is not configured."
    UNKNOWN_MODEL = "The selected model label is not configured."


class ModelSpec(BaseModel):
    """Configured LLM model metadata."""

    model_config = ConfigDict(extra="forbid")

    label: str = Field(min_length=1)
    provider: LlmProvider
    model_id: str = Field(alias="model_id", min_length=1)
    params: dict[str, object] = Field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class ResolvedModelSpec:
    """Resolved model configuration including the provider API key."""

    api_key: str
    label: str
    model_id: str
    params: dict[str, object]
    provider: LlmProvider


class LlmModelsJsonError(ValueError):
    """Raised when `llm_models` is not valid JSON."""


class LlmUnknownModelLabelError(ValueError):
    """Raised when the selected model label does not exist."""


class LlmProviderKeyMissingError(ValueError):
    """Raised when the selected provider has no configured API key."""


def parse_model_specs(raw_models: str) -> list[ModelSpec]:
    """Parse configured LLM models from the raw settings string."""

    try:
        decoded = json.loads(raw_models)
    except json.JSONDecodeError as exc:
        raise LlmModelsJsonError(LlmModelsErrorMessage.INVALID_JSON.value) from exc

    if not isinstance(decoded, list):
        raise LlmModelsJsonError(LlmModelsErrorMessage.INVALID_SHAPE.value)

    try:
        return [ModelSpec.model_validate(item) for item in decoded]
    except ValidationError as exc:
        raise LlmModelsJsonError(LlmModelsErrorMessage.INVALID_SHAPE.value) from exc


def resolve_model_spec(settings: Settings, label: str) -> ResolvedModelSpec:
    """Resolve a display label to a configured provider model and API key."""

    for model_spec in parse_model_specs(settings.llm_models):
        if model_spec.label != label:
            continue
        api_key = _resolve_provider_api_key(settings, model_spec.provider)
        if not api_key:
            raise LlmProviderKeyMissingError(
                _build_missing_key_message(model_spec.provider),
            )
        return ResolvedModelSpec(
            api_key=api_key,
            label=model_spec.label,
            model_id=model_spec.model_id,
            params=dict(model_spec.params),
            provider=model_spec.provider,
        )

    raise LlmUnknownModelLabelError(
        f"{LlmModelsErrorMessage.UNKNOWN_MODEL.value} Label: {label}",
    )


def _resolve_provider_api_key(settings: Settings, provider: LlmProvider) -> str:
    if provider is LlmProvider.ANTHROPIC:
        return settings.llm_anthropic_key
    return settings.llm_openai_key


def _build_missing_key_message(provider: LlmProvider) -> str:
    return f"{LlmModelsErrorMessage.MISSING_PROVIDER_KEY.value} Provider: {provider.value}"
