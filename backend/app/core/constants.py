"""Shared backend constants."""

from enum import StrEnum


class PluginId(StrEnum):
    STAGINGS = "stagings"
    QAA_GENERATOR = "qaa-generator"
    ADMIN = "admin"


class OperationType(StrEnum):
    DEPLOY = "deploy"
    DESTROY = "destroy"
    E2E_RUN = "e2e_run"
    ADOPT = "adopt"
    SYNC = "sync"
    SETUP = "setup"
    QAA_GENERATE = "qaa_generate"


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
    QAA_RUNS = "/qaa/runs"
    QAA_RUN_BY_ID = "/{run_id}"
    PAUSE = "/pause"
    RESUME = "/resume"
    STOP = "/stop"
    EVENTS_STREAM = "/events/stream"
    ARTIFACTS = "/artifacts"
    QAA_ADMIN_USERS = "/qaa/admin/users"
    QAA_ADMIN_USER_BY_ID = "/{user_id}"
    QAA_ADMIN_SERVICE_TOKENS = "/qaa/admin/service-tokens"
    QAA_ADMIN_SERVICE_TOKEN_BY_ID = "/{token_id}"
    REGENERATE = "/tokens/regenerate"
    REVOKE = "/revoke"


class ApiTag(StrEnum):
    AUTH = "auth"
    USERS = "users"
    OPERATIONS = "operations"
    QAA_GENERATOR = "qaa-generator"
    SYSTEM = "system"


class TokenType(StrEnum):
    BEARER = "bearer"


class AuthScheme(StrEnum):
    BEARER = "Bearer"


class HttpHeader(StrEnum):
    ACCEPT = "Accept"
    ACTOR = "Actor"
    AUTHORIZATION = "Authorization"
    CONTENT_TYPE = "Content-Type"
    IDEMPOTENCY_KEY = "Idempotency-Key"
    LAST_EVENT_ID = "Last-Event-ID"
    WWW_AUTHENTICATE = "WWW-Authenticate"


class MediaType(StrEnum):
    JSON = "application/json"
    TEXT_EVENT_STREAM = "text/event-stream"


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
    QAA_GENERATOR_BASE_URL = "QAA_GENERATOR_BASE_URL"
    QAA_GENERATOR_SERVICE_TOKEN = "QAA_GENERATOR_SERVICE_TOKEN"
    QAA_GENERATOR_SUPERUSER_TOKEN = "QAA_GENERATOR_SUPERUSER_TOKEN"
    QAA_GENERATOR_ACTOR = "QAA_GENERATOR_ACTOR"


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


class QaaRunProfile(StrEnum):
    BALANCED = "balanced"
    CODEX_ONLY = "codex-only"
    CLAUDE_ONLY = "claude-only"


class QaaRunStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    PAUSED = "paused"
    COMPLETED = "completed"
    FAILED = "failed"
    STOPPED = "stopped"


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


OPTIONAL_PLUGIN_IDS = (PluginId.STAGINGS, PluginId.QAA_GENERATOR)
SYSTEM_PLUGIN_IDS = (PluginId.ADMIN,)
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
DEFAULT_QAA_GENERATOR_BASE_URL = "http://qaa-generator.default.svc.cluster.local:8080/api/v1"
DEFAULT_QAA_GENERATOR_SERVICE_TOKEN = ""
DEFAULT_QAA_GENERATOR_SUPERUSER_TOKEN = ""
DEFAULT_QAA_GENERATOR_ACTOR = ""
DEFAULT_QAA_GENERATOR_TIMEOUT_SECONDS = 30.0
