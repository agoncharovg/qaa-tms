"""Shared agent constants."""

from __future__ import annotations

from enum import StrEnum


class AgentPath(StrEnum):
    PING = "/ping"
    SETTINGS = "/settings"
    PREFLIGHT = "/preflight"
    JENKINS_SCOPE = "/jenkins/scope"
    JENKINS_TREE = "/jenkins/tree"
    JENKINS_BUILDS = "/jenkins/builds"
    JENKINS_FREEZE = "/jenkins/freeze"
    JENKINS_RESUME = "/jenkins/resume"
    JENKINS_RESUME_RUN = "/jenkins/resume-run"
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
    QAA_RUNS = "/qaa/runs"
    QAA_ARTIFACTS = "/artifacts"
    QAA_EVENTS_STREAM = "/events/stream"
    QAA_PAUSE = "/pause"
    QAA_RESUME = "/resume"
    QAA_STOP = "/stop"


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


class EnvKey(StrEnum):
    HOST = "AGENT_HOST"
    PORT = "AGENT_PORT"
    CORS_ORIGINS = "AGENT_CORS_ORIGINS"
    BACKEND_URL = "AGENT_BACKEND_URL"
    JENKINS_URL = "AGENT_JENKINS_URL"
    JENKINS_USERNAME = "AGENT_JENKINS_USERNAME"
    JENKINS_TOKEN = "AGENT_JENKINS_TOKEN"
    JENKINS_ROOT_GROUPS = "AGENT_JENKINS_ROOT_GROUPS"
    JENKINS_ROOT_FOLDERS = "AGENT_JENKINS_ROOT_FOLDERS"
    JENKINS_HISTORY_LIMIT = "AGENT_JENKINS_HISTORY_LIMIT"
    JENKINS_REQUEST_TIMEOUT = "AGENT_JENKINS_REQUEST_TIMEOUT"
    JENKINS_TREE_DEPTH = "AGENT_JENKINS_TREE_DEPTH"
    JENKINS_STUCK_MIN_IDLE_HOURS = "AGENT_JENKINS_STUCK_MIN_IDLE_HOURS"
    JENKINS_RESUME_PAUSE_SECONDS = "AGENT_JENKINS_RESUME_PAUSE_SECONDS"
    STAGING_BIN = "AGENT_STAGING_BIN"
    STAGINGS_REPO = "AGENT_STAGINGS_REPO"
    KUBECTL_BIN = "AGENT_KUBECTL_BIN"
    KUBECONFIG = "AGENT_KUBECONFIG"
    KUBECTL_REQUEST_TIMEOUT = "AGENT_KUBECTL_REQUEST_TIMEOUT"
    QAA_GENERATOR_TOKEN = "AGENT_QAA_GENERATOR_TOKEN"
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
    IDEMPOTENCY_KEY = "Idempotency-Key"
    LAST_EVENT_ID = "Last-Event-ID"
    X_QAA_GENERATOR_TOKEN = "X-QAA-Generator-Token"
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
    JENKINS_RESUME_RUNS = "/api/v1/jenkins/resume-runs"
    QAA_RUNS = "/api/v1/qaa/runs"


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


class JenkinsResumeResult(StrEnum):
    RESTORED = "restored"
    ENABLED = "enabled"
    MISSING = "missing"
    ERROR = "error"


class JenkinsColor(StrEnum):
    BLUE = "blue"
    RED = "red"
    YELLOW = "yellow"
    DISABLED = "disabled"
    NOTBUILT = "notbuilt"
    ABORTED = "aborted"


class JenkinsApiPath(StrEnum):
    API_JSON = "api/json"
    ALLURE_SUFFIX = "allure/"


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
    JENKINS_NOT_CONFIGURED = "Jenkins is not configured (set AGENT_JENKINS_URL/USERNAME/TOKEN)."
    JENKINS_UNREACHABLE = "Jenkins is unreachable."
    JENKINS_PATH_OUT_OF_SCOPE = "Requested job path is outside the allowed Jenkins scope."
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
DEFAULT_JENKINS_URL = "https://jenkins.p.gc.onl"
DEFAULT_JENKINS_ROOT_GROUPS = (
    "BE=job/.QAA/job/E2E",
    "FE=job/.QAA/job/UI_E2E",
)
DEFAULT_JENKINS_ROOT_FOLDERS = ("PREPROD", "PROD")
DEFAULT_JENKINS_HISTORY_LIMIT = 8
DEFAULT_JENKINS_REQUEST_TIMEOUT = 15.0
DEFAULT_JENKINS_TREE_DEPTH = 5
DEFAULT_JENKINS_STUCK_MIN_IDLE_HOURS = 6
DEFAULT_JENKINS_RESUME_PAUSE_SECONDS = 1.0
DEFAULT_JENKINS_BUILDS_LIMIT = 15
DEFAULT_STAGING_KUBECONFIG = "~/.kube/ai-staging.yaml"
DEFAULT_AUTH_CACHE_TTL_SECONDS = 30
DEFAULT_BACKEND_TIMEOUT_SECONDS = 10.0
DEFAULT_COMMAND_TIMEOUT_SECONDS = 5.0
DEFAULT_CANCEL_WAIT_SECONDS = 5.0
DEFAULT_STAGING_KUBECONFIG_URL = "https://kubeconf.frn-stg.p.gc.onl/config"
DEFAULT_KUBECONFIG_ACTIVE_PATH = "~/.kube/config"
DEFAULT_KUBECONFIG = "~/.kube/config"
DEFAULT_STAGING_KUBECONFIG_MAX_AGE_HOURS = 48
DEFAULT_KUBECONFIG_FRESHNESS_SECONDS = DEFAULT_STAGING_KUBECONFIG_MAX_AGE_HOURS * 60 * 60
KUBECONFIG_REFRESH_GRACE_SECONDS = 300
DEFAULT_STAGING_BINARY_NAME = "staging"
DEFAULT_KUBECTL_BIN = "kubectl"
DEFAULT_KUBECTL_REQUEST_TIMEOUT = "10s"
DEFAULT_KUBE_LOG_TAIL = 200
GROUP_LABEL_SEPARATOR = "="
GROUP_LIST_SEPARATOR = ","
JENKINS_JOB_PATH_SEGMENT = "job"
JENKINS_ANIME_SUFFIX = "_anime"
JENKINS_FOLDER_CLASS = "com.cloudbees.hudson.plugins.folder.Folder"
JENKINS_TIMER_TRIGGER_CLASS = "hudson.triggers.TimerTrigger"
JENKINS_SCM_TRIGGER_CLASS = "hudson.triggers.SCMTrigger"
HTTPS_PORT = 443
MIN_STAGE = 0
MAX_STAGE = 7
PACKAGE_NAME = "qaa-tms-agent"
