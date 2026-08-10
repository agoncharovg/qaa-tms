"""Shared backend constants."""

from enum import StrEnum


class OperationType(StrEnum):
    DEPLOY = "deploy"
    DESTROY = "destroy"
    E2E_RUN = "e2e_run"
    ADOPT = "adopt"
    SYNC = "sync"
    SETUP = "setup"


class OperationStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"
    ABORTED = "aborted"


class Product(StrEnum):
    IAM = "IAM"
    BILLING = "Billing"
    CDN = "CDN"
    DNS = "DNS"
    NOTIFICATIONS = "Notifications"


class ApiPrefix(StrEnum):
    V1 = "/api/v1"


class RoutePath(StrEnum):
    HEALTH = "/health"
    READY = "/ready"
    AUTH = "/auth"
    LOGIN = "/login"
    ME = "/me"
    USERS = "/users"
    USER_BY_ID = "/users/{user_id}"
    OPERATIONS = "/operations"
    REPLAY = "/replay"


class ApiTag(StrEnum):
    AUTH = "auth"
    USERS = "users"
    OPERATIONS = "operations"
    SYSTEM = "system"


class TokenType(StrEnum):
    BEARER = "bearer"


class JwtAlgorithm(StrEnum):
    HS256 = "HS256"


class JwtClaim(StrEnum):
    SUBJECT = "sub"
    EXPIRES_AT = "exp"
    TOKEN_TYPE = "token_type"


class EnvKey(StrEnum):
    DATABASE_URL = "DATABASE_URL"
    JWT_SECRET = "JWT_SECRET"
    JWT_EXPIRE_MINUTES = "JWT_EXPIRE_MINUTES"
    CORS_ORIGINS = "CORS_ORIGINS"


class EnvFile(StrEnum):
    DOT_ENV = ".env"


class DatabaseDialect(StrEnum):
    POSTGRESQL = "postgresql"


class PasswordHashScheme(StrEnum):
    SHA256 = "sha256$"


class DevUsername(StrEnum):
    TEST = "test"
    ADMIN = "admin"


class DevDisplayName(StrEnum):
    TEST = "Test User"
    ADMIN = "Administrator"


class DevPassword(StrEnum):
    EMPTY = ""
    ADMIN = "admin"
