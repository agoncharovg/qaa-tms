"""Shared agent constants."""

from __future__ import annotations

from enum import StrEnum


class AgentPath(StrEnum):
    PING = "/ping"
    PREFLIGHT = "/preflight"
    KUBECONFIG_STATUS = "/staging/kubeconfig/status"
    KUBECONFIG_REFRESH = "/staging/kubeconfig/refresh"
    KUBECONFIG_ACTIVATE = "/staging/kubeconfig/activate"
    SETUP = "/setup"
    NAMESPACES = "/namespaces"
    KUBE_CONTEXTS = "/kube/contexts"
    KUBE_USE_CONTEXT = "/kube/contexts/use"
    KUBE_NAMESPACES = "/kube/namespaces"
    KUBE_PODS = "/kube/pods"
    KUBE_TOP = "/kube/top"
    STATUS = "/status"
    CREDS = "/creds"
    LOGS = "/logs"
    DESCRIBE = "/describe"
    DELETE = "/delete"
    DEPLOY_RECIPE = "/deploy-recipe"
    DEPLOY = "/deploy"
    DESTROY = "/destroy"
    ADOPT = "/adopt"
    SYNC = "/sync"
    GRAFANA_CREDS = "/grafana-creds"
    E2E_SUITES = "/e2e/suites"
    E2E_RUN = "/e2e-run"
    JOBS = "/jobs"
    STREAM = "/stream"
    CANCEL = "/cancel"


class PreflightKey(StrEnum):
    TOOLS = "tools"
    CLUSTER_REACHABLE = "clusterReachable"
    VPN = "vpn"
    KUBECONFIG = "kubeconfig"
    DOCKER_HARBOR = "dockerHarbor"
    DOCKER_STAGING = "dockerStaging"
    HARBOR_PULL = "harborPull"
    SUBMODULES = "submodules"
    VENV = "venv"
    REPO_INSTALLED = "repoInstalled"


class JobStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"
    ABORTED = "aborted"


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


class Product(StrEnum):
    IAM = "IAM"
    BILLING = "Billing"
    CDN = "CDN"
    DNS = "DNS"
    NOTIFICATIONS = "Notifications"


class OperationStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"
    ABORTED = "aborted"


class EnvKey(StrEnum):
    HOST = "AGENT_HOST"
    PORT = "AGENT_PORT"
    CORS_ORIGINS = "AGENT_CORS_ORIGINS"
    BACKEND_URL = "AGENT_BACKEND_URL"
    STAGING_BIN = "AGENT_STAGING_BIN"
    STAGINGS_REPO = "AGENT_STAGINGS_REPO"
    KUBECTL_BIN = "AGENT_KUBECTL_BIN"
    KUBECONFIG = "AGENT_KUBECONFIG"
    KUBECTL_REQUEST_TIMEOUT = "AGENT_KUBECTL_REQUEST_TIMEOUT"
    STAGING_KUBECONFIG_URL = "AGENT_STAGING_KUBECONFIG_URL"
    KUBECONFIG_ACTIVE_PATH = "AGENT_KUBECONFIG_ACTIVE_PATH"
    STAGING_KUBECONFIG_MAX_AGE_HOURS = "AGENT_STAGING_KUBECONFIG_MAX_AGE_HOURS"


class EnvFile(StrEnum):
    DOT_ENV = ".env"


class HeaderName(StrEnum):
    ACCEPT = "Accept"
    AUTHORIZATION = "Authorization"
    CACHE_CONTROL = "Cache-Control"
    CONNECTION = "Connection"
    CONTENT_TYPE = "Content-Type"
    X_QAA_TMS = "X-QAA-TMS"


class HeaderValue(StrEnum):
    APPLICATION_JSON = "application/json"
    BEARER = "Bearer"
    EVENT_STREAM = "text/event-stream"
    EVENT_STREAM_UTF8 = "text/event-stream; charset=utf-8"
    KEEP_ALIVE = "keep-alive"
    NO_CACHE = "no-cache"
    X_QAA_TMS_ENABLED = "1"


class BackendPath(StrEnum):
    ME = "/api/v1/me"
    OPERATIONS = "/api/v1/operations"


class RequiredTool(StrEnum):
    PYTHON3 = "python3"
    KUBECTL = "kubectl"
    KUSTOMIZE = "kustomize"
    DOCKER = "docker"
    GIT = "git"


class DockerRegistry(StrEnum):
    HARBOR = "harbor.p.gc.onl"
    STAGING = "registry.frn-stg.p.gc.onl:8443"


class StagingEnvKey(StrEnum):
    KUBECONFIG = "STAGING_KUBECONFIG"


class VpnProbeHost(StrEnum):
    FULL_VPN_ONLY = "kubeconf.frn-stg.p.gc.onl"


class SseEvent(StrEnum):
    LOG = "log"
    TERMINAL = "terminal"


class StagingCommand(StrEnum):
    DEPLOY = "deploy"
    DESTROY = "destroy"
    ADOPT = "adopt"
    SYNC = "sync"
    E2E_RUN = "e2e-run"


class KubectlCommand(StrEnum):
    CONFIG = "config"
    GET = "get"
    DESCRIBE = "describe"
    LOGS = "logs"
    DELETE = "delete"
    TOP = "top"
    VIEW = "view"
    USE_CONTEXT = "use-context"
    PODS = "pods"
    NAMESPACES = "namespaces"


class KubectlFlag(StrEnum):
    OUTPUT = "-o"
    CONTEXT = "--context"
    NAMESPACE = "--namespace"
    CONTAINER = "--container"
    FOLLOW = "--follow"
    TAIL = "--tail"
    PREVIOUS = "--previous"
    REQUEST_TIMEOUT = "--request-timeout"
    NO_HEADERS = "--no-headers"
    IGNORE_NOT_FOUND = "--ignore-not-found"


class KubectlOutput(StrEnum):
    JSON = "json"


class StagingFlag(StrEnum):
    SERVICES = "--services"
    IMAGE = "--image"
    CLEAN = "--clean"
    FULL = "--full"
    DRY_RUN = "--dry-run"
    NO_SYNC = "--no-sync"
    STAGE = "--stage"
    SERVICE = "--service"
    VERBOSE = "--verbose"
    PULL = "--pull"
    APPLY = "--apply"
    PRODUCT = "--product"
    SUITE = "--suite"
    THREADS = "--threads"
    LIST_SUITES = "--list-suites"


class JobEventType(StrEnum):
    LINE = "line"
    TERMINAL = "terminal"


class ErrorMessage(StrEnum):
    JOB_NOT_FOUND = "Job not found."
    STAGING_BINARY_NOT_INSTALLED = "The staging binary is not installed."
    UNAUTHORIZED = "Unauthorized."
    KUBECTL_NOT_INSTALLED = "kubectl is not installed."
    INVALID_KUBE_NAME = "Invalid Kubernetes resource name."
    KUBECONFIG_DOWNLOAD_FAILED = (
        "Failed to download the staging kubeconfig. Connect Full VPN and retry."
    )
    KUBECONFIG_DOWNLOAD_INVALID = (
        "Downloaded file is not a valid kubeconfig. Connect Full VPN and retry."
    )
    KUBECONFIG_ACTIVE_PATH_NOT_SYMLINK = (
        "The active kubeconfig path is a regular file and would be overwritten. "
        "Set AGENT_KUBECONFIG_ACTIVE_PATH to a managed symlink path, for example "
        "~/.kube/kubecfg.yaml, and retry."
    )


class KubeconfigAction(StrEnum):
    NONE = "none"
    REFRESH = "refresh"
    ACTIVATE = "activate"
    REFRESH_AND_ACTIVATE = "refresh_and_activate"


class KubeconfigReason(StrEnum):
    MISSING = "missing"
    STALE = "stale"
    TOKEN_EXPIRED = "token_expired"
    CONTENT_INVALID = "content_invalid"
    NOT_ACTIVE = "not_active"
    HEALTHY = "healthy"


AGENT_APP_NAME = "qaa-tms-agent"
DEFAULT_AGENT_VERSION = "0.1.0"
DEFAULT_AGENT_HOST = "127.0.0.1"
DEFAULT_AGENT_PORT = 47600
DEFAULT_BACKEND_URL = "http://localhost:8000"
DEFAULT_CORS_ORIGINS = (
    "http://localhost:3000",
    "http://127.0.0.1:3000",
)
DEFAULT_STAGING_KUBECONFIG = "~/.kube/ai-staging.yaml"
DEFAULT_AUTH_CACHE_TTL_SECONDS = 30
DEFAULT_BACKEND_TIMEOUT_SECONDS = 10.0
DEFAULT_COMMAND_TIMEOUT_SECONDS = 5.0
DEFAULT_CANCEL_WAIT_SECONDS = 5.0
DEFAULT_STAGING_KUBECONFIG_URL = "https://kubeconf.frn-stg.p.gc.onl/config"
DEFAULT_KUBECONFIG_ACTIVE_PATH = "~/.kube/config"
DEFAULT_STAGING_KUBECONFIG_MAX_AGE_HOURS = 48
DEFAULT_KUBECONFIG_FRESHNESS_SECONDS = DEFAULT_STAGING_KUBECONFIG_MAX_AGE_HOURS * 60 * 60
KUBECONFIG_REFRESH_GRACE_SECONDS = 300
DEFAULT_STAGING_BINARY_NAME = "staging"
DEFAULT_KUBECTL_BIN = "kubectl"
DEFAULT_KUBECTL_REQUEST_TIMEOUT = "10s"
DEFAULT_KUBE_LOG_TAIL = 200
HTTPS_PORT = 443
MIN_STAGE = 0
MAX_STAGE = 7
PACKAGE_NAME = "qaa-tms-agent"
