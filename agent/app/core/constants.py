"""Shared agent constants."""

from __future__ import annotations

from enum import StrEnum


class AgentPath(StrEnum):
    PING = "/ping"
    PREFLIGHT = "/preflight"
    SETUP = "/setup"
    NAMESPACES = "/namespaces"
    STATUS = "/status"
    CREDS = "/creds"
    LOGS = "/logs"
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
DEFAULT_KUBECONFIG_FRESHNESS_SECONDS = 12 * 60 * 60
DEFAULT_STAGING_BINARY_NAME = "staging"
HTTPS_PORT = 443
MIN_STAGE = 0
MAX_STAGE = 7
PACKAGE_NAME = "qaa-tms-agent"
