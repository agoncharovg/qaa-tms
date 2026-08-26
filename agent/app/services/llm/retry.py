"""Transient LLM error classification."""

from __future__ import annotations

from enum import StrEnum


class TransientLlmErrorPattern(StrEnum):
    OVERLOADED = "overloaded"
    RATE_LIMIT = "rate limit"
    SERVICE_UNAVAILABLE = "service unavailable"
    TOO_MANY_REQUESTS = "too many requests"
    MODEL_AT_CAPACITY = "model is at capacity"
    SERVER_ERROR = "server error"
    INTERNAL_ERROR = "internal error"
    REQUEST_TIMED_OUT = "request timed out"


TRANSIENT_LLM_ERROR_PATTERNS = tuple(pattern.value for pattern in TransientLlmErrorPattern)


def is_transient_llm_error_message(message: str) -> bool:
    normalized_message = message.casefold()
    return any(pattern in normalized_message for pattern in TRANSIENT_LLM_ERROR_PATTERNS)
