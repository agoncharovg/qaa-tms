"""OpenAI streaming provider adapter."""

from __future__ import annotations

from collections.abc import AsyncIterator, Sequence
from typing import Any, cast

from app.core.constants import LlmStreamEvent
from app.schemas import LlmDoneEvent, LlmErrorEvent, LlmTextDeltaEvent, LlmUsageEvent
from app.services.llm.models import ResolvedModelSpec
from app.services.llm.provider import LlmProviderEvent, ProviderMessage


class OpenaiProviderClient:
    """Streams chat completions from OpenAI."""

    async def stream(
        self,
        messages: Sequence[ProviderMessage],
        model_spec: ResolvedModelSpec,
        tools: Sequence[dict[str, object]] | None,
    ) -> AsyncIterator[LlmProviderEvent]:
        from openai import AsyncOpenAI

        client = AsyncOpenAI(api_key=model_spec.api_key)
        request_kwargs = _build_request_kwargs(messages, model_spec, tools)

        try:
            stream = await client.chat.completions.create(**request_kwargs)
            async for chunk in stream:
                for choice in chunk.choices:
                    delta_text = choice.delta.content
                    if not delta_text:
                        continue
                    yield LlmProviderEvent(
                        event=LlmStreamEvent.TEXT_DELTA,
                        payload=LlmTextDeltaEvent(delta=delta_text),
                    )

                if chunk.usage is not None:
                    input_tokens = cast(int | None, chunk.usage.prompt_tokens)
                    output_tokens = cast(int | None, chunk.usage.completion_tokens)
                    total_tokens = cast(int | None, chunk.usage.total_tokens)
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
    request_kwargs: dict[str, Any] = {
        "messages": [
            {
                "content": message.content,
                "role": message.role.value,
            }
            for message in messages
        ],
        "model": model_spec.model_id,
        "stream": True,
        "stream_options": {"include_usage": True},
    }
    if tools is not None:
        request_kwargs["tools"] = list(tools)
    request_kwargs.update(model_spec.params)
    return request_kwargs
