"""Agent-side LLM chat orchestration."""

from __future__ import annotations

from collections.abc import AsyncIterator, Mapping, Sequence
from enum import StrEnum

from app.core.config import Settings
from app.core.constants import LlmMessageRole, LlmProvider, LlmStreamEvent
from app.schemas import (
    LlmChatMessage,
    LlmChatRequest,
    LlmDoneEvent,
    LlmErrorEvent,
    LlmModelInfo,
    LlmSeedContext,
)
from app.services.llm.models import (
    ModelSpec,
    ResolvedModelSpec,
    parse_model_specs,
    resolve_model_spec,
)
from app.services.llm.provider import (
    LlmProviderClient,
    ProviderMessage,
    build_default_provider_registry,
    select_provider_client,
)
from app.services.sse import encode_sse


class LlmServicePrompt(StrEnum):
    SYSTEM = (
        "You are the QAA TMS Assistant. Respond with concise, practical help for engineering work."
    )
    SEED_CONTEXT_TITLE = "Seed context:"
    SEED_CONTEXT_ITEM = "{label}: {value}"


class LlmService:
    """Phase 1 single-pass LLM chat service."""

    def __init__(
        self,
        settings: Settings,
        providers: Mapping[LlmProvider, LlmProviderClient] | None = None,
    ) -> None:
        self._settings = settings
        self._providers = providers or build_default_provider_registry()

    def list_models(self) -> list[LlmModelInfo]:
        model_specs = parse_model_specs(self._settings.llm_models)
        return [self._to_model_info(model_spec) for model_spec in model_specs]

    def stream_chat(self, request: LlmChatRequest) -> AsyncIterator[str]:
        model_spec = resolve_model_spec(self._settings, request.model)
        provider = select_provider_client(model_spec.provider, self._providers)
        messages = build_provider_messages(request.messages, request.seed_context)
        return self._stream_provider(provider, messages, model_spec)

    async def _stream_provider(
        self,
        provider: LlmProviderClient,
        messages: Sequence[ProviderMessage],
        model_spec: ResolvedModelSpec,
    ) -> AsyncIterator[str]:
        saw_done_event = False
        try:
            async for event in provider.stream(messages, model_spec, None):
                if event.event is LlmStreamEvent.DONE:
                    saw_done_event = True
                yield encode_sse(event.event, event.payload.model_dump(by_alias=True))
        except Exception as exc:
            yield encode_sse(
                LlmStreamEvent.ERROR,
                LlmErrorEvent(message=str(exc)).model_dump(by_alias=True),
            )
        if not saw_done_event:
            yield encode_sse(
                LlmStreamEvent.DONE,
                LlmDoneEvent(done=True).model_dump(by_alias=True),
            )

    @staticmethod
    def _to_model_info(model_spec: ModelSpec) -> LlmModelInfo:
        return LlmModelInfo(
            label=model_spec.label,
            provider=model_spec.provider,
            model_id=model_spec.model_id,
            params=dict(model_spec.params),
        )


def build_provider_messages(
    messages: Sequence[LlmChatMessage],
    seed_context: LlmSeedContext | None,
) -> list[ProviderMessage]:
    provider_messages: list[ProviderMessage] = [
        ProviderMessage(
            content=LlmServicePrompt.SYSTEM.value,
            role=LlmMessageRole.SYSTEM,
        )
    ]
    seed_message = build_seed_context_message(seed_context)
    if seed_message:
        provider_messages.append(
            ProviderMessage(
                content=seed_message,
                role=LlmMessageRole.SYSTEM,
            )
        )
    provider_messages.extend(
        ProviderMessage(content=message.content, role=message.role) for message in messages
    )
    return provider_messages


def build_seed_context_message(seed_context: LlmSeedContext | None) -> str | None:
    if seed_context is None:
        return None

    lines = [LlmServicePrompt.SEED_CONTEXT_TITLE.value]
    if seed_context.context:
        lines.append(
            LlmServicePrompt.SEED_CONTEXT_ITEM.value.format(
                label="context",
                value=seed_context.context,
            )
        )
    if seed_context.namespace:
        lines.append(
            LlmServicePrompt.SEED_CONTEXT_ITEM.value.format(
                label="namespace",
                value=seed_context.namespace,
            )
        )
    if seed_context.pod:
        lines.append(
            LlmServicePrompt.SEED_CONTEXT_ITEM.value.format(
                label="pod",
                value=seed_context.pod,
            )
        )
    return "\n".join(lines) if len(lines) > 1 else None
