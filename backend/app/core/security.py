"""Security helpers for auth and password validation."""

from __future__ import annotations

import hashlib
import hmac
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt

from app.core.config import Settings
from app.core.constants import DevPassword, JwtAlgorithm, JwtClaim, PasswordHashScheme, TokenType


def hash_password(password: str) -> str:
    digest = hashlib.sha256(password.encode("utf-8")).hexdigest()
    return f"{PasswordHashScheme.SHA256.value}{digest}"


def verify_password(password: str, password_hash: str | None) -> bool:
    if password_hash is None:
        return password == DevPassword.EMPTY.value
    if not password_hash.startswith(PasswordHashScheme.SHA256.value):
        return False
    expected_hash = hash_password(password)
    return hmac.compare_digest(password_hash, expected_hash)


def create_access_token(subject: str, settings: Settings) -> str:
    expires_at = datetime.now(UTC) + timedelta(minutes=settings.jwt_expire_minutes)
    payload: dict[str, Any] = {
        JwtClaim.SUBJECT.value: subject,
        JwtClaim.EXPIRES_AT.value: expires_at,
        JwtClaim.TOKEN_TYPE.value: TokenType.BEARER.value,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=JwtAlgorithm.HS256.value)


def decode_access_token(token: str, settings: Settings) -> dict[str, Any]:
    payload = jwt.decode(
        token,
        settings.jwt_secret,
        algorithms=[JwtAlgorithm.HS256.value],
    )
    if not isinstance(payload, dict):
        raise jwt.InvalidTokenError("Invalid token payload.")
    return payload
