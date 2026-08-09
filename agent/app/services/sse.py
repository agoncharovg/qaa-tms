"""Shared SSE helpers."""

from __future__ import annotations

import json
from typing import Any

from app.core.constants import SseEvent


def encode_sse(event: SseEvent, payload: dict[str, Any]) -> str:
    """Encode a single SSE frame in the format consumed by the frontend parser."""

    data = json.dumps(payload, separators=(",", ":"))
    return f"event: {event.value}\ndata: {data}\n\n"
