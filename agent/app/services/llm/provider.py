"""Provider abstractions for streaming LLM responses."""

from __future__ import annotations

from collections.abc import AsyncIterator, Mapping, Sequence
from dataclasses import dataclass
from typing import Protocol

from app.core.constants import LlmMessageRole, LlmProvider, LlmStreamEvent
from app.schemas import LlmDoneEvent, LlmErrorEvent, LlmTextDeltaEvent, LlmUsageEvent
from app.services.llm.models import ResolvedModelSpec


@dataclass(frozen=True, slots=True)
class ProviderMessage:
    """Provider-agnostic chat message."""

    content: str
    role: LlmMessageRole


@dataclass(frozen=True, slots=True)
class LlmProviderEvent:
    """Streamed provider event payload."""

    event: LlmStreamEvent
    payload: LlmTextDeltaEvent | LlmUsageEvent | LlmDoneEvent | LlmErrorEvent


class LlmProviderClient(Protocol):
    """Provider interface used by the LLM service."""

    def stream(
        self,
        messages: Sequence[ProviderMessage],
        model_spec: ResolvedModelSpec,
        tools: Sequence[dict[str, object]] | None,
    ) -> AsyncIterator[LlmProviderEvent]:
        ...


def build_default_provider_registry() -> Mapping[LlmProvider, LlmProviderClient]:
    from app.services.llm.anthropic_provider import AnthropicProviderClient
    from app.services.llm.openai_provider import OpenaiProviderClient

    registry: dict[LlmProvider, LlmProviderClient] = {
        LlmProvider.ANTHROPIC: AnthropicProviderClient(),
        LlmProvider.OPENAI: OpenaiProviderClient(),
    }
    return registry


def select_provider_client(
    provider: LlmProvider,
    registry: Mapping[LlmProvider, LlmProviderClient],
) -> LlmProviderClient:
    return registry[provider]
