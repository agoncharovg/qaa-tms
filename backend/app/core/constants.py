"""Shared backend constants."""

from enum import StrEnum


class PluginId(StrEnum):
    STAGINGS = "stagings"
    ADMIN = "admin"


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
    ME_PLUGINS = "/me/plugins"
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


class AuthScheme(StrEnum):
    BEARER = "Bearer"


class HttpHeader(StrEnum):
    WWW_AUTHENTICATE = "WWW-Authenticate"


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


class HealthStatus(StrEnum):
    OK = "ok"
    READY = "ready"


class HealthFieldName(StrEnum):
    STATUS = "status"


class ErrorMessage(StrEnum):
    INVALID_AUTHENTICATION_CREDENTIALS = "Invalid authentication credentials."
    OPERATION_NOT_FOUND = "Operation not found."
    USER_NOT_FOUND = "User not found."
    INVALID_ENABLED_PLUGINS = "enabled_plugins must contain only optional plugin ids."


class DevUsername(StrEnum):
    TEST = "test"
    ADMIN = "admin"


class DevDisplayName(StrEnum):
    TEST = "Test User"
    ADMIN = "Administrator"


class DevPassword(StrEnum):
    EMPTY = ""
    ADMIN = "admin"


OPTIONAL_PLUGIN_IDS = frozenset({PluginId.STAGINGS})
SYSTEM_PLUGIN_IDS = frozenset({PluginId.ADMIN})
OPTIONAL_PLUGIN_ID_VALUES = tuple(plugin_id.value for plugin_id in OPTIONAL_PLUGIN_IDS)
SYSTEM_PLUGIN_ID_VALUES = tuple(plugin_id.value for plugin_id in SYSTEM_PLUGIN_IDS)


def resolve_enabled_plugins(enabled_plugins: list[str] | None) -> list[str]:
    source = enabled_plugins if enabled_plugins is not None else list(OPTIONAL_PLUGIN_ID_VALUES)
    enabled_set = set(source)
    return [plugin_id for plugin_id in OPTIONAL_PLUGIN_ID_VALUES if plugin_id in enabled_set]


DEFAULT_STRING_LENGTH = 255
OPERATIONS_MIN_LIMIT = 1
OPERATIONS_MAX_LIMIT = 100
OPERATIONS_DEFAULT_LIMIT = 20
DEFAULT_OFFSET = 0
