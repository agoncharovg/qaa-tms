from __future__ import annotations

from collections.abc import AsyncIterator, Sequence

import pytest

from app.core.config import Settings
from app.core.constants import LlmMessageRole, LlmProvider, LlmStreamEvent
from app.schemas import (
    LlmChatMessage,
    LlmChatRequest,
    LlmDoneEvent,
    LlmSeedContext,
    LlmTextDeltaEvent,
    LlmUsageEvent,
)
from app.services.llm.models import (
    LlmModelsJsonError,
    LlmProviderKeyMissingError,
    LlmUnknownModelLabelError,
    parse_model_specs,
    resolve_model_spec,
)
from app.services.llm.provider import (
    LlmProviderEvent,
    ProviderMessage,
    select_provider_client,
)
from app.services.llm.retry import is_transient_llm_error_message
from app.services.llm.service import LlmService, build_provider_messages

MODEL_CONFIG_JSON = (
    '[{"label":"Claude","provider":"anthropic","model_id":"claude-sonnet","params":{"max_tokens":1024}},'
    '{"label":"Codex","provider":"openai","model_id":"gpt-5","params":{"reasoning_effort":"high"}}]'
)
INVALID_MODEL_CONFIG_JSON = '{"label":"broken"}'
UNKNOWN_MODEL_LABEL = "Missing"
TRANSIENT_ERROR_MESSAGE = "Provider overloaded and request timed out."
NON_TRANSIENT_ERROR_MESSAGE = "Prompt validation failed."


class FakeProvider:
    def __init__(self, events: Sequence[LlmProviderEvent]) -> None:
        self._events = events
        self.calls: list[tuple[list[ProviderMessage], object, object]] = []

    async def stream(
        self,
        messages: Sequence[ProviderMessage],
        model_spec: object,
        tools: Sequence[dict[str, object]] | None,
    ) -> AsyncIterator[LlmProviderEvent]:
        self.calls.append((list(messages), model_spec, tools))
        for event in self._events:
            yield event


def build_settings(**overrides: object) -> Settings:
    base_settings = {
        "AGENT_LLM_ANTHROPIC_KEY": "anthropic-key",
        "AGENT_LLM_OPENAI_KEY": "openai-key",
        "AGENT_LLM_MODELS": MODEL_CONFIG_JSON,
    }
    base_settings.update(overrides)
    return Settings(**base_settings)


def test_parse_model_specs_returns_configured_models() -> None:
    models = parse_model_specs(MODEL_CONFIG_JSON)

    assert [model.label for model in models] == ["Claude", "Codex"]
    assert models[0].provider is LlmProvider.ANTHROPIC
    assert models[1].model_id == "gpt-5"


def test_parse_model_specs_rejects_invalid_json_shape() -> None:
    with pytest.raises(LlmModelsJsonError):
        parse_model_specs(INVALID_MODEL_CONFIG_JSON)


def test_resolve_model_spec_rejects_unknown_label() -> None:
    with pytest.raises(LlmUnknownModelLabelError):
        resolve_model_spec(build_settings(), UNKNOWN_MODEL_LABEL)


def test_resolve_model_spec_requires_provider_key() -> None:
    with pytest.raises(LlmProviderKeyMissingError):
        resolve_model_spec(
            build_settings(AGENT_LLM_ANTHROPIC_KEY=""),
            "Claude",
        )


def test_select_provider_client_uses_provider_registry() -> None:
    anthropic_provider = FakeProvider(events=[])
    openai_provider = FakeProvider(events=[])

    assert (
        select_provider_client(
            LlmProvider.ANTHROPIC,
            {
                LlmProvider.ANTHROPIC: anthropic_provider,
                LlmProvider.OPENAI: openai_provider,
            },
        )
        is anthropic_provider
    )


def test_is_transient_llm_error_message_matches_reference_patterns() -> None:
    assert is_transient_llm_error_message(TRANSIENT_ERROR_MESSAGE) is True
    assert is_transient_llm_error_message(NON_TRANSIENT_ERROR_MESSAGE) is False


@pytest.mark.asyncio
async def test_llm_service_streams_provider_events_as_sse_frames() -> None:
    fake_provider = FakeProvider(
        events=[
            LlmProviderEvent(
                event=LlmStreamEvent.TEXT_DELTA,
                payload=LlmTextDeltaEvent(delta="Hello"),
            ),
            LlmProviderEvent(
                event=LlmStreamEvent.USAGE,
                payload=LlmUsageEvent(input_tokens=5, output_tokens=7, total_tokens=12),
            ),
            LlmProviderEvent(
                event=LlmStreamEvent.DONE,
                payload=LlmDoneEvent(done=True),
            ),
        ]
    )
    service = LlmService(
        build_settings(),
        providers={
            LlmProvider.ANTHROPIC: fake_provider,
            LlmProvider.OPENAI: fake_provider,
        },
    )
    request = LlmChatRequest(
        model="Claude",
        messages=[LlmChatMessage(role=LlmMessageRole.USER, content="Hi")],
    )

    frames = [frame async for frame in service.stream_chat(request)]

    assert frames == [
        'event: text_delta\ndata: {"delta":"Hello"}\n\n',
        'event: usage\ndata: {"inputTokens":5,"outputTokens":7,"totalTokens":12}\n\n',
        'event: done\ndata: {"done":true}\n\n',
    ]
    assert fake_provider.calls[0][2] is None


def test_build_provider_messages_adds_system_prompt_and_seed_context() -> None:
    messages = build_provider_messages(
        messages=[LlmChatMessage(role=LlmMessageRole.USER, content="Investigate the pod")],
        seed_context=LlmSeedContext(
            context="team/dev",
            namespace="qa-demo",
            pod="api-123",
        ),
    )

    assert messages[0].role is LlmMessageRole.SYSTEM
    assert messages[1].content == (
        "Seed context:\ncontext: team/dev\nnamespace: qa-demo\npod: api-123"
    )
    assert messages[2].role is LlmMessageRole.USER
