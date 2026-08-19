"""Shared SQLAlchemy type helpers."""

from __future__ import annotations

from enum import Enum
from typing import Any

from sqlalchemy import JSON
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql.type_api import TypeEngine

from app.core.constants import DatabaseDialect


def enum_values[EnumT: Enum](enum_type: type[EnumT]) -> list[str]:
    return [str(member.value) for member in enum_type]


def json_variant() -> TypeEngine[Any]:
    return JSON().with_variant(JSONB(), DatabaseDialect.POSTGRESQL.value)
