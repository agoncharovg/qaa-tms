"""Shared backend constants."""

from enum import StrEnum


class PluginId(StrEnum):
    STAGINGS = "stagings"
    KUBER = "kuber"
    QAA_GENERATOR = "qaa-generator"
    JENKINS = "jenkins"
    STATISTICS = "statistics"
    ADMIN = "admin"
    PROFILE = "profile"


class OperationType(StrEnum):
    DEPLOY = "deploy"
    DESTROY = "destroy"
    E2E_RUN = "e2e_run"
    ADOPT = "adopt"
    SYNC = "sync"
    SETUP = "setup"
    KUBE_USE_CONTEXT = "kube_use_context"
    KUBE_DELETE_POD = "kube_delete_pod"
    KUBECONFIG_REFRESH = "kubeconfig_refresh"
    QAA_GENERATE = "qaa_generate"


class OperationStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"
    ABORTED = "aborted"


class JenkinsFreezeStatus(StrEnum):
    ACTIVE = "active"
    RESOLVED = "resolved"
    MERGED = "merged"


class JenkinsResumeRunStatus(StrEnum):
    RUNNING = "running"
    DONE = "done"
    CANCELLED = "cancelled"
    FAILED = "failed"


class JenkinsResumeItemState(StrEnum):
    PENDING = "pending"
    STARTED = "started"
    SKIPPED = "skipped"
    ERROR = "error"


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
    AGENT = "/agent"
    MANIFEST = "/manifest"
    DOWNLOAD = "/download"
    AUTH = "/auth"
    LOGIN = "/login"
    JENKINS = "/jenkins"
    FREEZES = "/freezes"
    FREEZE_BY_ID = "/freezes/{freeze_id}"
    FREEZE_SNAPSHOT = "/freezes/{freeze_id}/snapshot"
    FREEZE_RESOLVE = "/freezes/{freeze_id}/resolve"
    RESUME_RUNS = "/resume-runs"
    RESUME_RUN_BY_ID = "/resume-runs/{run_id}"
    RESUME_RUN_PROGRESS = "/resume-runs/{run_id}/progress"
    RESUME_RUN_CANCEL = "/resume-runs/{run_id}/cancel"
    TREE = "/tree"
    BUILDS = "/builds"
    FOLDER = "/folder"
    ME = "/me"
    ME_PLUGINS = "/me/plugins"
    SETTINGS = "/settings"
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
    SERVICE_TOKEN_REGENERATE = "/regenerate"
    REVOKE = "/revoke"


class ApiTag(StrEnum):
    AUTH = "auth"
    JENKINS = "jenkins"
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
    AUTHORIZATION = "Authorization"
    CONTENT_TYPE = "Content-Type"
    IDEMPOTENCY_KEY = "Idempotency-Key"
    LAST_EVENT_ID = "Last-Event-ID"
    WWW_AUTHENTICATE = "WWW-Authenticate"
    X_QAA_GENERATOR_TOKEN = "X-QAA-Generator-Token"


class HttpMethod(StrEnum):
    DELETE = "DELETE"
    GET = "GET"
    PATCH = "PATCH"
    POST = "POST"


class MediaType(StrEnum):
    GZIP = "application/gzip"
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
    STATIC_DIR = "STATIC_DIR"
    AGENT_DIST_DIR = "AGENT_DIST_DIR"
    QAA_GENERATOR_BASE_URL = "QAA_GENERATOR_BASE_URL"
    QAA_GENERATOR_SUPERUSER_TOKEN = "QAA_GENERATOR_SUPERUSER_TOKEN"


class EnvFile(StrEnum):
    DOT_ENV = ".env"


class QueryParam(StrEnum):
    STATUS = "status"
    TYPE = "type"


class DatabaseDialect(StrEnum):
    POSTGRESQL = "postgresql"


class PasswordHashScheme(StrEnum):
    SHA256 = "sha256$"


class JenkinsNodeKind(StrEnum):
    FOLDER = "folder"
    PIPELINE = "pipeline"


class JenkinsStatus(StrEnum):
    PASSED = "passed"
    FAILED = "failed"
    DISABLED = "disabled"
    RUNNING = "running"
    STUCK = "stuck"
    NOTBUILT = "notbuilt"


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
    AGENT_BUNDLE_NOT_AVAILABLE = "The bundled companion source artifact is not available."
    AGENT_MANIFEST_NOT_AVAILABLE = "The bundled companion manifest metadata is not available."
    ADMIN_ACCESS_REQUIRED = "Admin access is required."
    CANNOT_DELETE_OWN_ACCOUNT = "You cannot delete your own account."
    CANNOT_REMOVE_OWN_ADMIN_ACCESS = "You cannot remove your own admin access."
    DATABASE_NOT_READY = "Database is not ready."
    INVALID_USERNAME_OR_PASSWORD = "Invalid username or password."
    LAST_REMAINING_ADMIN_CANNOT_BE_REMOVED = "The last remaining admin cannot be removed."
    NOT_AUTHENTICATED = "Not authenticated."
    USERNAME_ALREADY_EXISTS = "Username already exists."
    USER_HAS_RECORDED_OPERATIONS = (
        "This user has recorded operations; audit history must be preserved."
    )
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


OPTIONAL_PLUGIN_IDS = (
    PluginId.STAGINGS,
    PluginId.KUBER,
    PluginId.QAA_GENERATOR,
    PluginId.JENKINS,
    PluginId.STATISTICS,
)
SYSTEM_PLUGIN_IDS = (PluginId.ADMIN, PluginId.PROFILE)
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
DEFAULT_DATABASE_URL = "postgresql+asyncpg://qaa_tms:qaa_tms@localhost:5432/qaa_tms"
DEFAULT_JWT_SECRET = "dev-secret-change-me"
DEFAULT_JWT_EXPIRE_MINUTES = 720
DEFAULT_STATIC_DIR = "/app/static"
DEFAULT_AGENT_DIST_DIR = "/app/agent-dist"
DEFAULT_QAA_GENERATOR_BASE_URL = "https://qaa-generator-prod.i.gc.onl/api/v1"
DEFAULT_QAA_GENERATOR_SUPERUSER_TOKEN = ""
DEFAULT_QAA_GENERATOR_TIMEOUT_SECONDS = 30.0
AGENT_MIN_SUPPORTED_VERSION = "0.1.0"
JENKINS_TREE_CACHE_TTL_SECONDS = 900
JENKINS_BUILDS_CACHE_TTL_SECONDS = 60
JENKINS_REFRESH_LEASE_TTL_SECONDS = 30
JENKINS_FOLDER_CACHE_MIN_TTL_SECONDS = 30
JENKINS_FOLDER_CACHE_MAX_TTL_SECONDS = 600
JENKINS_FOLDER_HISTORY_RETENTION_SECONDS = 3600
JENKINS_FOLDER_HISTORY_RETENTION_MS = JENKINS_FOLDER_HISTORY_RETENTION_SECONDS * 1000
# Must exceed the worst-case single-pipeline resume (enable + last-build params +
# build ≈ 3× the 15s Jenkins request timeout, plus the inter-item pause), otherwise a
# slow-but-live campaign is falsely judged abandoned and could be relaunched.
JENKINS_RESUME_RUN_STALE_SECONDS = 120
