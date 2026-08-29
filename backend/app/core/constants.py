"""Shared backend constants."""

from enum import StrEnum


class PluginId(StrEnum):
    STAGINGS = "stagings"
    KUBER = "kuber"
    QAA_GENERATOR = "qaa-generator"
    JENKINS = "jenkins"
    STATISTICS = "statistics"
    LEONID = "leonid"
    NOTEBOOK = "notebook"
    NOTIFICATOR = "notificator"
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
    LEONID = "/leonid"
    NOTIFICATOR = "/notificator"
    MANIFEST = "/manifest"
    DOWNLOAD = "/download"
    INSTALL_SCRIPT = "/install.sh"
    AUTH = "/auth"
    LOGIN = "/login"
    SECURITY = "/security"
    PERMISSIONS = "/permissions"
    ROLES = "/roles"
    ROLE_BY_ID = "/roles/{role_id}"
    GROUPS = "/groups"
    GROUP_BY_ID = "/groups/{group_id}"
    GROUP_MEMBERS = "/groups/{group_id}/members"
    GROUP_PERMISSIONS = "/groups/{group_id}/permissions"
    GROUP_ROLES = "/groups/{group_id}/roles"
    AUDIT = "/audit"
    AUTHZ = "/authz"
    CHECK = "/check"
    JENKINS = "/jenkins"
    FREEZES = "/freezes"
    FREEZE_BY_ID = "/freezes/{freeze_id}"
    FREEZE_SNAPSHOT = "/freezes/{freeze_id}/snapshot"
    FREEZE_RESOLVE = "/freezes/{freeze_id}/resolve"
    SHARED_RESOURCE_LIMIT_TYPES = "/shared_resource_limit_types"
    SHARED_RESOURCE_LIMITS = "/shared_resource_limits"
    SHARED_RESOURCES = "/shared_resources"
    SKIPPED_SUITES = "/skipped_suites"
    OBJECT_DEFINITIONS = "/object_definitions"
    OBJECT_VALUES = "/object_values"
    PIPELINE_PARAMS = "/pipeline_params"
    TOGGLE_ENABLED = "/toggle_enabled"
    CANCEL = "/cancel"
    CHOICES = "/choices"
    NOTIFICATION_CONFIGS = "/notification_configs"
    TEAMS = "/teams"
    PRODUCTS = "/products"
    SUB_PRODUCTS = "/sub_products"
    SLACK_CHANNELS = "/slack_channels"
    NOTIFICATOR_USERS = "/users"
    QAA_MEMBERS = "/qaa_members"
    FAILURE_MENTION_RULES = "/failure_mention_rules"
    EVENTS = "/events"
    RECURRENT_FAILS = "/recurrent_fails"
    FAIL_REASONS = "/fail_reasons"
    MUTE_STATUSES = "/mute_statuses"
    HISTORY = "/history"
    RESUME_RUNS = "/resume-runs"
    RESUME_RUN_BY_ID = "/resume-runs/{run_id}"
    RESUME_RUN_PROGRESS = "/resume-runs/{run_id}/progress"
    RESUME_RUN_CANCEL = "/resume-runs/{run_id}/cancel"
    TREE = "/tree"
    BUILDS = "/builds"
    FOLDER = "/folder"
    SCOPE = "/scope"
    ME = "/me"
    ME_PLUGINS = "/me/plugins"
    SETTINGS = "/settings"
    USERS = "/users"
    USER_BY_ID = "/users/{user_id}"
    USER_PERMISSIONS = "/users/{user_id}/permissions"
    USER_PERMISSION_BY_KEY = "/users/{user_id}/permissions/{permission_key}"
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
    SECURITY = "security"
    JENKINS = "jenkins"
    LEONID = "leonid"
    NOTIFICATOR = "notificator"
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
    CACHE_CONTROL = "Cache-Control"
    CONTENT_TYPE = "Content-Type"
    IDEMPOTENCY_KEY = "Idempotency-Key"
    LAST_EVENT_ID = "Last-Event-ID"
    WWW_AUTHENTICATE = "WWW-Authenticate"
    X_QAA_GENERATOR_TOKEN = "X-QAA-Generator-Token"
    X_LEONID_TOKEN = "X-Leonid-Token"
    X_NOTIFICATOR_TOKEN = "X-Notificator-Token"


class CacheControl(StrEnum):
    NO_STORE = "no-store"


class HttpMethod(StrEnum):
    DELETE = "DELETE"
    GET = "GET"
    PATCH = "PATCH"
    POST = "POST"
    PUT = "PUT"


class MediaType(StrEnum):
    GZIP = "application/gzip"
    JSON = "application/json"
    SHELL = "text/x-shellscript; charset=utf-8"
    TEXT_EVENT_STREAM = "text/event-stream"


class JwtAlgorithm(StrEnum):
    HS256 = "HS256"


class JwtClaim(StrEnum):
    SUBJECT = "sub"
    EXPIRES_AT = "exp"
    TOKEN_TYPE = "token_type"
    SESSION_VERSION = "sv"


class AppEnvironment(StrEnum):
    DEVELOPMENT = "development"
    PRODUCTION = "production"


class AuthLoginEventReason(StrEnum):
    SUCCESS = "success"
    INVALID_CREDENTIALS = "invalid_credentials"
    RATE_LIMITED = "rate_limited"
    EMPTY_PASSWORD_DISABLED = "empty_password_disabled"


class SecuritySubjectKind(StrEnum):
    USER = "user"
    GROUP = "group"


class SecurityScopeKind(StrEnum):
    GLOBAL = "global"
    PLUGIN = "plugin"
    JENKINS_PATH = "jenkins_path"
    NAMESPACE = "namespace"
    SETTINGS_SURFACE = "settings_surface"


class SecurityRoleKey(StrEnum):
    SUPERADMIN = "superadmin"
    ADMINISTRATOR = "administrator"
    ENGINEER = "engineer"
    VIEWER = "viewer"


class PermissionKey(StrEnum):
    SECURITY_READ = "security.read"
    SECURITY_ROLES_READ = "security.roles.read"
    SECURITY_ROLES_MANAGE = "security.roles.manage"
    SECURITY_GROUPS_READ = "security.groups.read"
    SECURITY_GROUPS_MANAGE = "security.groups.manage"
    SECURITY_AUDIT_READ = "security.audit.read"
    USERS_READ = "users.read"
    USERS_MANAGE = "users.manage"
    PROFILE_SELF_READ = "profile.self.read"
    PROFILE_SELF_MANAGE = "profile.self.manage"
    SERVER_SETTINGS_READ = "server_settings.read"
    SERVER_SETTINGS_MANAGE = "server_settings.manage"
    OPERATIONS_READ_OWN = "operations.read_own"
    OPERATIONS_READ_ALL = "operations.read_all"
    JENKINS_READ = "jenkins.read"
    JENKINS_FREEZE = "jenkins.freeze"
    JENKINS_RESUME = "jenkins.resume"
    STATISTICS_READ = "statistics.read"
    STAGINGS_READ = "stagings.read"
    STAGINGS_DEPLOY = "stagings.deploy"
    STAGINGS_DESTROY = "stagings.destroy"
    STAGINGS_SYNC = "stagings.sync"
    STAGINGS_E2E_RUN = "stagings.e2e_run"
    KUBER_READ = "kuber.read"
    KUBER_USE_CONTEXT = "kuber.use_context"
    KUBER_DELETE_POD = "kuber.delete_pod"
    QAA_READ = "qaa.read"
    QAA_RUN = "qaa.run"
    QAA_ADMIN = "qaa.admin"
    NOTIFICATOR_READ = "notificator.read"
    NOTIFICATOR_WRITE = "notificator.write"
    LEONID_READ = "leonid.read"
    LEONID_WRITE = "leonid.write"
    NOTEBOOK_READ = "notebook.read"
    NOTEBOOK_WRITE = "notebook.write"


class SettingsSurface(StrEnum):
    SERVER = "server"
    AGENT = "agent"
    APPLICATION = "application"


class EnvKey(StrEnum):
    APP_ENV = "APP_ENV"
    DATABASE_URL = "DATABASE_URL"
    JWT_SECRET = "JWT_SECRET"
    JWT_EXPIRE_MINUTES = "JWT_EXPIRE_MINUTES"
    AUTH_LOGIN_MAX_ATTEMPTS = "AUTH_LOGIN_MAX_ATTEMPTS"
    AUTH_LOGIN_WINDOW_SECONDS = "AUTH_LOGIN_WINDOW_SECONDS"
    CORS_ORIGINS = "CORS_ORIGINS"
    STATIC_DIR = "STATIC_DIR"
    AGENT_DIST_DIR = "AGENT_DIST_DIR"
    LEONID_URL = "LEONID_URL"
    LEONID_TOKEN = "LEONID_TOKEN"
    LEONID_REQUEST_TIMEOUT = "LEONID_REQUEST_TIMEOUT"
    NOTIFICATOR_URL = "NOTIFICATOR_URL"
    NOTIFICATOR_TOKEN = "NOTIFICATOR_TOKEN"
    NOTIFICATOR_REQUEST_TIMEOUT = "NOTIFICATOR_REQUEST_TIMEOUT"
    QAA_GENERATOR_BASE_URL = "QAA_GENERATOR_BASE_URL"
    QAA_GENERATOR_SUPERUSER_TOKEN = "QAA_GENERATOR_SUPERUSER_TOKEN"
    JENKINS_COMMON_URL = "JENKINS_COMMON_URL"
    JENKINS_COMMON_USERNAME = "JENKINS_COMMON_USERNAME"
    JENKINS_COMMON_TOKEN = "JENKINS_COMMON_TOKEN"
    JENKINS_ROOT_GROUPS = "JENKINS_ROOT_GROUPS"
    JENKINS_ROOT_FOLDERS = "JENKINS_ROOT_FOLDERS"
    JENKINS_HISTORY_LIMIT = "JENKINS_HISTORY_LIMIT"
    JENKINS_REQUEST_TIMEOUT = "JENKINS_REQUEST_TIMEOUT"
    JENKINS_TREE_DEPTH = "JENKINS_TREE_DEPTH"


class EnvFile(StrEnum):
    DOT_ENV = ".env"


class QueryParam(StrEnum):
    PATH = "path"
    SIGNATURE = "signature"
    STATUS = "status"
    TTL_SECONDS = "ttl_seconds"
    TYPE = "type"


class DatabaseDialect(StrEnum):
    POSTGRESQL = "postgresql"


class PasswordHashScheme(StrEnum):
    SHA256 = "sha256$"
    SCRYPT = "scrypt$"


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
    EMPTY_PASSWORDS_REQUIRE_DEVELOPMENT = "Empty passwords are allowed only in development."
    INVALID_USERNAME_OR_PASSWORD = "Invalid username or password."
    LOGIN_RATE_LIMIT_EXCEEDED = "Too many login attempts. Try again later."
    LAST_REMAINING_ADMIN_CANNOT_BE_REMOVED = "The last remaining admin cannot be removed."
    NOT_AUTHENTICATED = "Not authenticated."
    PERMISSION_DENIED = "You do not have permission to perform this action."
    SESSION_NO_LONGER_VALID = "Session is no longer valid."
    USERNAME_ALREADY_EXISTS = "Username already exists."
    USER_HAS_RECORDED_OPERATIONS = (
        "This user has recorded operations; audit history must be preserved."
    )
    INVALID_AUTHENTICATION_CREDENTIALS = "Invalid authentication credentials."
    JENKINS_PATH_OUT_OF_SCOPE = "Requested job path is outside the allowed Jenkins scope."
    JENKINS_UNREACHABLE = "Jenkins is unreachable."
    LEONID_NOT_CONFIGURED = "Leonid is not configured (set LEONID_URL and LEONID_TOKEN)."
    LEONID_UNREACHABLE = "Leonid is unreachable."
    LEONID_UPSTREAM_REJECTED = "Leonid rejected the shared token."
    NOTIFICATOR_NOT_CONFIGURED = (
        "Notificator is not configured (set NOTIFICATOR_URL and NOTIFICATOR_TOKEN)."
    )
    NOTIFICATOR_UNREACHABLE = "Notificator is unreachable."
    NOTIFICATOR_UPSTREAM_REJECTED = "Notificator rejected the shared token."
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
    PluginId.LEONID,
    PluginId.NOTEBOOK,
    PluginId.NOTIFICATOR,
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
DEFAULT_APP_ENV = AppEnvironment.PRODUCTION
DEFAULT_DATABASE_URL = "postgresql+asyncpg://qaa_tms:qaa_tms@localhost:5432/qaa_tms"
DEFAULT_JWT_SECRET = "dev-secret-change-me"
DEFAULT_JWT_EXPIRE_MINUTES = 0
DEFAULT_AUTH_LOGIN_MAX_ATTEMPTS = 5
DEFAULT_AUTH_LOGIN_WINDOW_SECONDS = 60
DEFAULT_STATIC_DIR = "/app/static"
DEFAULT_AGENT_DIST_DIR = "/app/agent-dist"
DEFAULT_JENKINS_COMMON_URL = "https://jenkins.p.gc.onl"
DEFAULT_JENKINS_ROOT_GROUPS = (
    "BE=job/.QAA/job/E2E",
    "FE=job/.QAA/job/UI_E2E",
)
DEFAULT_JENKINS_ROOT_FOLDERS = ("PREPROD", "PROD")
DEFAULT_JENKINS_HISTORY_LIMIT = 8
DEFAULT_JENKINS_REQUEST_TIMEOUT = 15.0
DEFAULT_JENKINS_STUCK_MIN_IDLE_HOURS = 6
DEFAULT_JENKINS_TREE_DEPTH = 5
DEFAULT_JENKINS_BUILDS_LIMIT = 15
DEFAULT_SMOKE_FOLDER_HISTORY_LIMIT = 30
DEFAULT_LEONID_URL = ""
DEFAULT_LEONID_TOKEN = ""
DEFAULT_LEONID_REQUEST_TIMEOUT = 15.0
DEFAULT_NOTIFICATOR_URL = ""
DEFAULT_NOTIFICATOR_TOKEN = ""
DEFAULT_NOTIFICATOR_REQUEST_TIMEOUT = 15.0
DEFAULT_QAA_GENERATOR_BASE_URL = "https://qaa-generator-prod.i.gc.onl/api/v1"
DEFAULT_QAA_GENERATOR_SUPERUSER_TOKEN = ""
DEFAULT_QAA_GENERATOR_TIMEOUT_SECONDS = 30.0
AGENT_MIN_SUPPORTED_VERSION = "0.1.0"
GROUP_LABEL_SEPARATOR = "="
GROUP_LIST_SEPARATOR = ","
JENKINS_ANIME_SUFFIX = "_anime"
JENKINS_FOLDER_CLASS = "com.cloudbees.hudson.plugins.folder.Folder"
JENKINS_JOB_PATH_SEGMENT = "job"
JENKINS_SCOPE_SIGNATURE_LENGTH = 16
JENKINS_SCM_TRIGGER_CLASS = "hudson.triggers.SCMTrigger"
JENKINS_TIMER_TRIGGER_CLASS = "hudson.triggers.TimerTrigger"
JENKINS_TREE_CACHE_TTL_SECONDS = 900
JENKINS_BUILDS_CACHE_TTL_SECONDS = 60
JENKINS_REFRESH_LEASE_TTL_SECONDS = 30
JENKINS_FOLDER_CACHE_MIN_TTL_SECONDS = 30
JENKINS_FOLDER_CACHE_MAX_TTL_SECONDS = 600
JENKINS_FOLDER_HISTORY_RETENTION_SECONDS = 3600
JENKINS_FOLDER_HISTORY_RETENTION_MS = JENKINS_FOLDER_HISTORY_RETENTION_SECONDS * 1000
PASSWORD_SCRYPT_SALT_BYTES = 16
PASSWORD_SCRYPT_N = 16384
PASSWORD_SCRYPT_R = 8
PASSWORD_SCRYPT_P = 1
PASSWORD_SCRYPT_DKLEN = 64
# Must exceed the worst-case single-pipeline resume (enable + last-build params +
# build ≈ 3× the 15s Jenkins request timeout, plus the inter-item pause), otherwise a
# slow-but-live campaign is falsely judged abandoned and could be relaunched.
JENKINS_RESUME_RUN_STALE_SECONDS = 120
