"""Anthropic streaming provider adapter."""

from __future__ import annotations

from collections.abc import AsyncIterator, Sequence
from enum import IntEnum
from typing import Any, cast

from app.core.constants import LlmMessageRole, LlmStreamEvent
from app.schemas import LlmDoneEvent, LlmErrorEvent, LlmTextDeltaEvent, LlmUsageEvent
from app.services.llm.models import ResolvedModelSpec
from app.services.llm.provider import LlmProviderEvent, ProviderMessage


class AnthropicDefault(IntEnum):
    MAX_TOKENS = 1024


class AnthropicProviderClient:
    """Streams chat completions from Anthropic."""

    async def stream(
        self,
        messages: Sequence[ProviderMessage],
        model_spec: ResolvedModelSpec,
        tools: Sequence[dict[str, object]] | None,
    ) -> AsyncIterator[LlmProviderEvent]:
        from anthropic import AsyncAnthropic

        client = AsyncAnthropic(api_key=model_spec.api_key)
        request_kwargs = _build_request_kwargs(messages, model_spec, tools)

        try:
            async with client.messages.stream(**request_kwargs) as stream:
                async for text in stream.text_stream:
                    if not text:
                        continue
                    yield LlmProviderEvent(
                        event=LlmStreamEvent.TEXT_DELTA,
                        payload=LlmTextDeltaEvent(delta=text),
                    )

                final_message = await stream.get_final_message()
                usage = getattr(final_message, "usage", None)
                if usage is not None:
                    input_tokens = cast(int | None, getattr(usage, "input_tokens", None))
                    output_tokens = cast(int | None, getattr(usage, "output_tokens", None))
                    total_tokens = (
                        input_tokens + output_tokens
                        if input_tokens is not None and output_tokens is not None
                        else None
                    )
                    yield LlmProviderEvent(
                        event=LlmStreamEvent.USAGE,
                        payload=LlmUsageEvent(
                            input_tokens=input_tokens,
                            output_tokens=output_tokens,
                            total_tokens=total_tokens,
                        ),
                    )
        except Exception as exc:
            yield LlmProviderEvent(
                event=LlmStreamEvent.ERROR,
                payload=LlmErrorEvent(message=str(exc)),
            )
            return

        yield LlmProviderEvent(
            event=LlmStreamEvent.DONE,
            payload=LlmDoneEvent(done=True),
        )


def _build_request_kwargs(
    messages: Sequence[ProviderMessage],
    model_spec: ResolvedModelSpec,
    tools: Sequence[dict[str, object]] | None,
) -> dict[str, Any]:
    system_parts = [
        message.content for message in messages if message.role is LlmMessageRole.SYSTEM
    ]
    chat_messages = [
        {
            "content": message.content,
            "role": message.role.value,
        }
        for message in messages
        if message.role is not LlmMessageRole.SYSTEM
    ]
    params = dict(model_spec.params)
    request_kwargs: dict[str, Any] = {
        "max_tokens": params.pop("max_tokens", AnthropicDefault.MAX_TOKENS.value),
        "messages": chat_messages,
        "model": model_spec.model_id,
    }
    if system_parts:
        request_kwargs["system"] = "\n\n".join(system_parts)
    if tools is not None:
        request_kwargs["tools"] = list(tools)
    request_kwargs.update(params)
    return request_kwargs
