"""Security helpers for auth and password validation."""

from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt

from app.core.config import Settings
from app.core.constants import (
    PASSWORD_SCRYPT_DKLEN,
    PASSWORD_SCRYPT_N,
    PASSWORD_SCRYPT_P,
    PASSWORD_SCRYPT_R,
    PASSWORD_SCRYPT_SALT_BYTES,
    DevPassword,
    JwtAlgorithm,
    JwtClaim,
    PasswordHashScheme,
    TokenType,
)

PASSWORD_HASH_SEPARATOR = "$"


def hash_legacy_password(password: str) -> str:
    digest = hashlib.sha256(password.encode("utf-8")).hexdigest()
    return f"{PasswordHashScheme.SHA256.value}{digest}"


def _hash_scrypt_password(
    password: str,
    salt: bytes,
    *,
    n: int = PASSWORD_SCRYPT_N,
    r: int = PASSWORD_SCRYPT_R,
    p: int = PASSWORD_SCRYPT_P,
    dklen: int = PASSWORD_SCRYPT_DKLEN,
) -> bytes:
    return hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=n,
        r=r,
        p=p,
        dklen=dklen,
    )


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(PASSWORD_SCRYPT_SALT_BYTES)
    digest = _hash_scrypt_password(password, salt)
    return (
        f"{PasswordHashScheme.SCRYPT.value}{PASSWORD_SCRYPT_N}{PASSWORD_HASH_SEPARATOR}"
        f"{PASSWORD_SCRYPT_R}{PASSWORD_HASH_SEPARATOR}{PASSWORD_SCRYPT_P}"
        f"{PASSWORD_HASH_SEPARATOR}{PASSWORD_SCRYPT_DKLEN}{PASSWORD_HASH_SEPARATOR}"
        f"{salt.hex()}{PASSWORD_HASH_SEPARATOR}{digest.hex()}"
    )


def _verify_legacy_password(password: str, password_hash: str) -> bool:
    expected_hash = hash_legacy_password(password)
    return hmac.compare_digest(password_hash, expected_hash)


def _verify_scrypt_password(password: str, password_hash: str) -> bool:
    parts = password_hash.split(PASSWORD_HASH_SEPARATOR)
    if len(parts) != 7 or parts[0] != PasswordHashScheme.SCRYPT.value.rstrip(
        PASSWORD_HASH_SEPARATOR
    ):
        return False

    try:
        n = int(parts[1])
        r = int(parts[2])
        p = int(parts[3])
        dklen = int(parts[4])
        salt = bytes.fromhex(parts[5])
        expected_digest = bytes.fromhex(parts[6])
    except ValueError:
        return False

    actual_digest = _hash_scrypt_password(password, salt, n=n, r=r, p=p, dklen=dklen)
    return hmac.compare_digest(expected_digest, actual_digest)


def verify_password(password: str, password_hash: str | None) -> bool:
    if password_hash is None:
        return password == DevPassword.EMPTY.value
    if password_hash.startswith(PasswordHashScheme.SCRYPT.value):
        return _verify_scrypt_password(password, password_hash)
    if password_hash.startswith(PasswordHashScheme.SHA256.value):
        return _verify_legacy_password(password, password_hash)
    return False


def password_hash_needs_upgrade(password_hash: str | None) -> bool:
    return password_hash is None or password_hash.startswith(PasswordHashScheme.SHA256.value)


def maybe_upgrade_password_hash(password: str, password_hash: str | None) -> str | None:
    if not verify_password(password, password_hash):
        return None
    if not password_hash_needs_upgrade(password_hash):
        return None
    return hash_password(password)


def is_empty_password_hash(password_hash: str | None) -> bool:
    return verify_password(DevPassword.EMPTY.value, password_hash)


def create_access_token(subject: str, settings: Settings, session_version: int) -> str:
    payload: dict[str, Any] = {
        JwtClaim.SUBJECT.value: subject,
        JwtClaim.TOKEN_TYPE.value: TokenType.BEARER.value,
        JwtClaim.SESSION_VERSION.value: session_version,
    }
    if settings.jwt_expire_minutes > 0:
        payload[JwtClaim.EXPIRES_AT.value] = datetime.now(UTC) + timedelta(
            minutes=settings.jwt_expire_minutes
        )
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
