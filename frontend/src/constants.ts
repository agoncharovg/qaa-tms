export const PluginId = {
  STAGINGS: "stagings",
  KUBER: "kuber",
  QAA_GENERATOR: "qaa-generator",
  JENKINS: "jenkins",
  ADMIN: "admin",
} as const;

export type PluginId = (typeof PluginId)[keyof typeof PluginId];

export const PluginOrigin = {
  BUILTIN: "builtin",
  LOCAL: "local",
} as const;

export type PluginOrigin = (typeof PluginOrigin)[keyof typeof PluginOrigin];

export const IconName = {
  CLUSTER: "cluster",
  JENKINS: "jenkins",
  ROCKET: "rocket",
  SPARKLES: "sparkles",
  SETTINGS: "settings",
} as const;

export type IconName = (typeof IconName)[keyof typeof IconName];

export const CONTRACT_VERSION = 1 as const;

export const ContentType = {
  REACT_VIEW: "react-view",
  IFRAME: "iframe",
  HTML: "html",
} as const;

export type ContentType = (typeof ContentType)[keyof typeof ContentType];

export const RoutePath = {
  ROOT: "/",
  LOGIN: "/login",
} as const;

export type RoutePath = (typeof RoutePath)[keyof typeof RoutePath];

export const StorageKey = {
  TOKEN: "qaa-tms.token",
  REMEMBER_ME: "qaa-tms.remember-me",
  AUTO_LOGIN: "qaa-tms.auto-login",
  SIDEBAR_COLLAPSED: "qaa-tms.sidebar-collapsed",
  TABS: "qaa-tms.tabs",
  KUBE: "qaa-tms.kube",
  JENKINS_PINNED: "qaa-tms.jenkins-pinned",
} as const;

export type StorageKey = (typeof StorageKey)[keyof typeof StorageKey];

export const BackendPath = {
  AUTH_LOGIN: "/api/v1/auth/login",
  ME: "/api/v1/me",
  ME_PLUGINS: "/api/v1/me/plugins",
  USERS: "/api/v1/users",
  OPERATIONS: "/api/v1/operations",
  QAA_RUNS: "/api/v1/qaa/runs",
  QAA_ADMIN_USERS: "/api/v1/qaa/admin/users",
  QAA_ADMIN_SERVICE_TOKENS: "/api/v1/qaa/admin/service-tokens",
  REPLAY: "/replay",
  PAUSE: "/pause",
  RESUME: "/resume",
  STOP: "/stop",
  EVENTS_STREAM: "/events/stream",
  ARTIFACTS: "/artifacts",
  REGENERATE: "/tokens/regenerate",
  REVOKE: "/revoke",
  HEALTH: "/health",
  READY: "/ready",
} as const;

export type BackendPath = (typeof BackendPath)[keyof typeof BackendPath];

export function buildBackendUserPath(userId: number): string {
  return `${BackendPath.USERS}/${userId}`;
}

export function buildBackendOperationPath(operationId: string): string {
  return `${BackendPath.OPERATIONS}/${operationId}`;
}

export function buildBackendOperationReplayPath(operationId: string): string {
  return `${buildBackendOperationPath(operationId)}${BackendPath.REPLAY}`;
}

export function buildBackendQaaRunPath(runId: string): string {
  return `${BackendPath.QAA_RUNS}/${encodeURIComponent(runId)}`;
}

export function buildBackendQaaRunPausePath(runId: string): string {
  return `${buildBackendQaaRunPath(runId)}${BackendPath.PAUSE}`;
}

export function buildBackendQaaRunResumePath(runId: string): string {
  return `${buildBackendQaaRunPath(runId)}${BackendPath.RESUME}`;
}

export function buildBackendQaaRunStopPath(runId: string): string {
  return `${buildBackendQaaRunPath(runId)}${BackendPath.STOP}`;
}

export function buildBackendQaaRunStreamPath(runId: string): string {
  return `${buildBackendQaaRunPath(runId)}${BackendPath.EVENTS_STREAM}`;
}

export function buildBackendQaaRunArtifactsPath(runId: string): string {
  return `${buildBackendQaaRunPath(runId)}${BackendPath.ARTIFACTS}`;
}

export function buildBackendQaaUserPath(userId: string): string {
  return `${BackendPath.QAA_ADMIN_USERS}/${encodeURIComponent(userId)}`;
}

export function buildBackendQaaUserRegeneratePath(userId: string): string {
  return `${buildBackendQaaUserPath(userId)}${BackendPath.REGENERATE}`;
}

export function buildBackendQaaServiceTokenRevokePath(tokenId: string): string {
  return `${BackendPath.QAA_ADMIN_SERVICE_TOKENS}/${encodeURIComponent(tokenId)}${BackendPath.REVOKE}`;
}

export const AgentPath = {
  PING: "/ping",
  PREFLIGHT: "/preflight",
  JENKINS_TREE: "/jenkins/tree",
  JENKINS_BUILDS: "/jenkins/builds",
  KUBECONFIG_STATUS: "/staging/kubeconfig/status",
  KUBECONFIG_REFRESH: "/staging/kubeconfig/refresh",
  KUBECONFIG_ACTIVATE: "/staging/kubeconfig/activate",
  SETUP: "/setup",
  NAMESPACES: "/namespaces",
  KUBE_CONTEXTS: "/kube/contexts",
  KUBE_USE_CONTEXT: "/kube/contexts/use",
  KUBE_NAMESPACES: "/kube/namespaces",
  KUBE_PODS: "/kube/pods",
  KUBE_TOP: "/kube/top",
  STATUS: "/status",
  CREDS: "/creds",
  LOGS: "/logs",
  DESCRIBE: "/describe",
  DELETE: "/delete",
  DEPLOY_RECIPE: "/deploy-recipe",
  DEPLOY: "/deploy",
  DESTROY: "/destroy",
  ADOPT: "/adopt",
  SYNC: "/sync",
  GRAFANA_CREDS: "/grafana-creds",
  E2E_SUITES: "/e2e/suites",
  E2E_RUN: "/e2e-run",
  JOBS: "/jobs",
  STREAM: "/stream",
  CANCEL: "/cancel",
} as const;

export type AgentPath = (typeof AgentPath)[keyof typeof AgentPath];

export function buildAgentJobPath(jobId: string): string {
  return `${AgentPath.JOBS}/${encodeURIComponent(jobId)}`;
}

export function buildAgentJobStreamPath(jobId: string): string {
  return `${buildAgentJobPath(jobId)}${AgentPath.STREAM}`;
}

export function buildAgentJobCancelPath(jobId: string): string {
  return `${buildAgentJobPath(jobId)}${AgentPath.CANCEL}`;
}

export function buildAgentNamespaceStatusPath(namespace: string): string {
  return `${AgentPath.NAMESPACES}/${encodeURIComponent(namespace)}${AgentPath.STATUS}`;
}

export function buildAgentNamespaceCredsPath(namespace: string): string {
  return `${AgentPath.NAMESPACES}/${encodeURIComponent(namespace)}${AgentPath.CREDS}`;
}

export function buildAgentNamespaceLogsPath(namespace: string, deploy: string): string {
  const params = new URLSearchParams({
    deploy,
  });
  return `${AgentPath.NAMESPACES}/${encodeURIComponent(namespace)}${AgentPath.LOGS}?${params.toString()}`;
}

export function buildAgentNamespaceDeployRecipePath(namespace: string): string {
  return `${AgentPath.NAMESPACES}/${encodeURIComponent(namespace)}${AgentPath.DEPLOY_RECIPE}`;
}

function setOptionalSearchParam(
  searchParams: URLSearchParams,
  key: string,
  value: string | null | undefined
): void {
  if (!value) {
    return;
  }

  searchParams.set(key, value);
}

export function buildAgentJenkinsTreePath(): string {
  return AgentPath.JENKINS_TREE;
}

export function buildAgentJenkinsBuildsPath(path: string): string {
  const params = new URLSearchParams({
    path,
  });
  return `${AgentPath.JENKINS_BUILDS}?${params.toString()}`;
}

export function buildAgentKubeNamespacesPath(context?: string | null): string {
  const params = new URLSearchParams();
  setOptionalSearchParam(params, "context", context);
  const query = params.toString();
  return query ? `${AgentPath.KUBE_NAMESPACES}?${query}` : AgentPath.KUBE_NAMESPACES;
}

export function buildAgentKubePodsPath(context: string | null | undefined, namespace: string): string {
  const params = new URLSearchParams({
    namespace,
  });
  setOptionalSearchParam(params, "context", context);
  return `${AgentPath.KUBE_PODS}?${params.toString()}`;
}

export function buildAgentKubePodDescribePath(
  pod: string,
  context: string | null | undefined,
  namespace: string
): string {
  const params = new URLSearchParams({
    namespace,
  });
  setOptionalSearchParam(params, "context", context);
  return `${AgentPath.KUBE_PODS}/${encodeURIComponent(pod)}${AgentPath.DESCRIBE}?${params.toString()}`;
}

export function buildAgentKubePodLogsPath(
  pod: string,
  params: {
    context?: string | null;
    namespace: string;
    container?: string | null;
    follow: boolean;
    tail: number;
    previous: boolean;
  }
): string {
  const searchParams = new URLSearchParams({
    follow: String(params.follow),
    namespace: params.namespace,
    previous: String(params.previous),
    tail: String(params.tail),
  });
  setOptionalSearchParam(searchParams, "context", params.context);
  setOptionalSearchParam(searchParams, "container", params.container);
  return `${AgentPath.KUBE_PODS}/${encodeURIComponent(pod)}${AgentPath.LOGS}?${searchParams.toString()}`;
}

export function buildAgentKubePodDeletePath(pod: string): string {
  return `${AgentPath.KUBE_PODS}/${encodeURIComponent(pod)}${AgentPath.DELETE}`;
}

export function buildAgentKubeTopPath(context: string | null | undefined, namespace: string): string {
  const params = new URLSearchParams({
    namespace,
  });
  setOptionalSearchParam(params, "context", context);
  return `${AgentPath.KUBE_TOP}?${params.toString()}`;
}

export function buildAgentE2eSuitesPath(product: Product): string {
  const params = new URLSearchParams({
    product,
  });
  return `${AgentPath.E2E_SUITES}?${params.toString()}`;
}

export const PreflightKey = {
  TOOLS: "tools",
  CLUSTER_REACHABLE: "clusterReachable",
  VPN: "vpn",
  KUBECONFIG: "kubeconfig",
  DOCKER_HARBOR: "dockerHarbor",
  DOCKER_STAGING: "dockerStaging",
  HARBOR_PULL: "harborPull",
  SUBMODULES: "submodules",
  VENV: "venv",
  REPO_INSTALLED: "repoInstalled",
} as const;

export type PreflightKey = (typeof PreflightKey)[keyof typeof PreflightKey];

export const PreflightLabel: Record<PreflightKey, string> = {
  [PreflightKey.CLUSTER_REACHABLE]: "Cluster reachable",
  [PreflightKey.DOCKER_HARBOR]: "Docker login to Harbor",
  [PreflightKey.DOCKER_STAGING]: "Docker login to staging registry",
  [PreflightKey.HARBOR_PULL]: "Harbor pull access",
  [PreflightKey.KUBECONFIG]: "Kubeconfig available",
  [PreflightKey.REPO_INSTALLED]: "qaa-stagings installed",
  [PreflightKey.SUBMODULES]: "Git submodules initialized",
  [PreflightKey.TOOLS]: "Required tools installed",
  [PreflightKey.VENV]: "Virtual environment ready",
  [PreflightKey.VPN]: "VPN connected",
};

export const Product = {
  IAM: "IAM",
  BILLING: "Billing",
  CDN: "CDN",
  DNS: "DNS",
  NOTIFICATIONS: "Notifications",
} as const;

export type Product = (typeof Product)[keyof typeof Product];

export const PRODUCT_OPTIONS = [
  Product.BILLING,
  Product.IAM,
  Product.CDN,
  Product.DNS,
  Product.NOTIFICATIONS,
] as const;

export const OperationType = {
  DEPLOY: "deploy",
  DESTROY: "destroy",
  E2E_RUN: "e2e_run",
  ADOPT: "adopt",
  SYNC: "sync",
  SETUP: "setup",
  KUBE_USE_CONTEXT: "kube_use_context",
  KUBE_DELETE_POD: "kube_delete_pod",
  KUBECONFIG_REFRESH: "kubeconfig_refresh",
  QAA_GENERATE: "qaa_generate",
} as const;

export type OperationType = (typeof OperationType)[keyof typeof OperationType];

export const OperationTypeLabel: Record<OperationType, string> = {
  [OperationType.DEPLOY]: "Deploy",
  [OperationType.DESTROY]: "Destroy",
  [OperationType.E2E_RUN]: "E2E run",
  [OperationType.ADOPT]: "Adopt",
  [OperationType.SYNC]: "Sync",
  [OperationType.SETUP]: "Setup",
  [OperationType.KUBE_USE_CONTEXT]: "Set context",
  [OperationType.KUBE_DELETE_POD]: "Delete pod",
  [OperationType.KUBECONFIG_REFRESH]: "Kubeconfig refresh",
  [OperationType.QAA_GENERATE]: "QAA generate",
};

export const KubeconfigAction = {
  NONE: "none",
  REFRESH: "refresh",
  ACTIVATE: "activate",
  REFRESH_AND_ACTIVATE: "refresh_and_activate",
} as const;

export type KubeconfigAction = (typeof KubeconfigAction)[keyof typeof KubeconfigAction];

export const KubeconfigReason = {
  MISSING: "missing",
  STALE: "stale",
  TOKEN_EXPIRED: "token_expired",
  CONTENT_INVALID: "content_invalid",
  NOT_ACTIVE: "not_active",
  HEALTHY: "healthy",
} as const;

export type KubeconfigReason = (typeof KubeconfigReason)[keyof typeof KubeconfigReason];

export const KubeconfigReasonLabel: Record<KubeconfigReason, string> = {
  [KubeconfigReason.MISSING]: "Missing",
  [KubeconfigReason.STALE]: "Stale (older than 48h)",
  [KubeconfigReason.TOKEN_EXPIRED]: "Token expired",
  [KubeconfigReason.CONTENT_INVALID]: "Invalid content",
  [KubeconfigReason.NOT_ACTIVE]: "Not the active config",
  [KubeconfigReason.HEALTHY]: "Healthy",
};

export const OperationStatus = {
  QUEUED: "queued",
  RUNNING: "running",
  SUCCESS: "success",
  FAILED: "failed",
  ABORTED: "aborted",
} as const;

export type OperationStatus = (typeof OperationStatus)[keyof typeof OperationStatus];

export const OperationStatusColor = {
  [OperationStatus.QUEUED]: "gray",
  [OperationStatus.RUNNING]: "blue",
  [OperationStatus.SUCCESS]: "teal",
  [OperationStatus.FAILED]: "red",
  [OperationStatus.ABORTED]: "yellow",
} as const satisfies Record<OperationStatus, string>;

export const JobStatus = OperationStatus;
export type JobStatus = OperationStatus;

export const NamespaceLogStatus = {
  IDLE: "idle",
  RUNNING: OperationStatus.RUNNING,
  SUCCESS: OperationStatus.SUCCESS,
  FAILED: OperationStatus.FAILED,
  ABORTED: OperationStatus.ABORTED,
} as const;

export type NamespaceLogStatus = (typeof NamespaceLogStatus)[keyof typeof NamespaceLogStatus];

export const NamespaceLogStatusLabel: Record<NamespaceLogStatus, string> = {
  [NamespaceLogStatus.IDLE]: "Idle",
  [NamespaceLogStatus.RUNNING]: "Running",
  [NamespaceLogStatus.SUCCESS]: "Success",
  [NamespaceLogStatus.FAILED]: "Failed",
  [NamespaceLogStatus.ABORTED]: "Aborted",
};

export const NamespaceOrigin = {
  CLUSTER: "cluster",
  LOCAL: "local",
} as const;

export type NamespaceOrigin = (typeof NamespaceOrigin)[keyof typeof NamespaceOrigin];

export const NamespaceOriginLabel: Record<NamespaceOrigin, string> = {
  [NamespaceOrigin.CLUSTER]: "Cluster namespace",
  [NamespaceOrigin.LOCAL]: "Local only - not on cluster",
};

export const OperationStatusLabel: Record<OperationStatus, string> = {
  [OperationStatus.QUEUED]: "Queued",
  [OperationStatus.RUNNING]: "Running",
  [OperationStatus.SUCCESS]: "Success",
  [OperationStatus.FAILED]: "Failed",
  [OperationStatus.ABORTED]: "Aborted",
};

export const TERMINAL_JOB_STATUSES = [
  OperationStatus.SUCCESS,
  OperationStatus.FAILED,
  OperationStatus.ABORTED,
] as const;

export const JobStreamEvent = {
  LOG: "log",
  TERMINAL: "terminal",
} as const;

export type JobStreamEvent = (typeof JobStreamEvent)[keyof typeof JobStreamEvent];

export const HttpMethod = {
  GET: "GET",
  POST: "POST",
  PUT: "PUT",
  PATCH: "PATCH",
  DELETE: "DELETE",
} as const;

export type HttpMethod = (typeof HttpMethod)[keyof typeof HttpMethod];

export const HttpHeader = {
  ACCEPT: "Accept",
  AUTHORIZATION: "Authorization",
  CONTENT_TYPE: "Content-Type",
} as const;

export type HttpHeader = (typeof HttpHeader)[keyof typeof HttpHeader];

export const MediaType = {
  JSON: "application/json",
  TEXT_EVENT_STREAM: "text/event-stream",
} as const;

export type MediaType = (typeof MediaType)[keyof typeof MediaType];

export const HttpStatus = {
  CONFLICT: 409,
  NO_CONTENT: 204,
} as const;

export type HttpStatus = (typeof HttpStatus)[keyof typeof HttpStatus];

export const ViewKey = {
  STAGINGS_PREFLIGHT: "stagings-preflight",
  JENKINS_TREE: "jenkins-tree",
  JENKINS_BOARD: "jenkins-board",
  STAGINGS_DEPLOY: "stagings-deploy",
  STAGINGS_HISTORY: "stagings-history",
  STAGINGS_NAMESPACES: "stagings-namespaces",
  STAGINGS_SYNC: "stagings-sync",
  STAGINGS_E2E: "stagings-e2e",
  KUBE_CLUSTERS: "kube-clusters",
  KUBE_PODS: "kube-pods",
  QAA_GENERATE: "qaa-generate",
  QAA_LIVE: "qaa-live",
  QAA_RUNS: "qaa-runs",
  QAA_ADMIN: "qaa-admin",
  ADMIN_PLUGINS: "admin-plugins",
  ADMIN_USERS: "admin-users",
} as const;

export type ViewKey = (typeof ViewKey)[keyof typeof ViewKey];

export const TabId = {
  STAGINGS_PREFLIGHT: "tab-stagings-preflight",
  JENKINS_TREE: "tab-jenkins-tree",
  JENKINS_BOARD: "tab-jenkins-board",
  STAGINGS_DEPLOY: "tab-stagings-deploy",
  STAGINGS_HISTORY: "tab-stagings-history",
  STAGINGS_NAMESPACES: "tab-stagings-namespaces",
  STAGINGS_SYNC: "tab-stagings-sync",
  STAGINGS_E2E: "tab-stagings-e2e",
  KUBE_CLUSTERS: "tab-kube-clusters",
  KUBE_PODS: "tab-kube-pods",
  QAA_GENERATE: "tab-qaa-generate",
  QAA_LIVE: "tab-qaa-live",
  QAA_RUNS: "tab-qaa-runs",
  QAA_ADMIN: "tab-qaa-admin",
  ADMIN_PLUGINS: "tab-admin-plugins",
  ADMIN_USERS: "tab-admin-users",
} as const;

export type TabId = (typeof TabId)[keyof typeof TabId];

export const TabTitle: Record<TabId, string> = {
  [TabId.STAGINGS_PREFLIGHT]: "Preflight",
  [TabId.JENKINS_TREE]: "Tree",
  [TabId.JENKINS_BOARD]: "Pinned",
  [TabId.STAGINGS_DEPLOY]: "Deploy",
  [TabId.STAGINGS_HISTORY]: "History",
  [TabId.STAGINGS_NAMESPACES]: "Namespaces",
  [TabId.STAGINGS_SYNC]: "Sync",
  [TabId.STAGINGS_E2E]: "E2E",
  [TabId.KUBE_CLUSTERS]: "Clusters",
  [TabId.KUBE_PODS]: "Pods",
  [TabId.QAA_GENERATE]: "Generate",
  [TabId.QAA_LIVE]: "Live",
  [TabId.QAA_RUNS]: "Runs",
  [TabId.QAA_ADMIN]: "Admin",
  [TabId.ADMIN_PLUGINS]: "Plugins",
  [TabId.ADMIN_USERS]: "Users",
};

export const QueryKey = {
  AGENT_PREFLIGHT: "agent-preflight",
  AGENT_JOB: "agent-job",
  AGENT_NAMESPACES: "agent-namespaces",
  AGENT_NAMESPACE_STATUS: "agent-namespace-status",
  AGENT_NAMESPACE_CREDS: "agent-namespace-creds",
  AGENT_E2E_SUITES: "agent-e2e-suites",
  JENKINS_TREE: "jenkins-tree",
  JENKINS_BUILDS: "jenkins-builds",
  KUBECONFIG_STATUS: "kubeconfig-status",
  KUBE_CONTEXTS: "kube-contexts",
  KUBE_NAMESPACES: "kube-namespaces",
  KUBE_PODS: "kube-pods",
  KUBE_POD_DESCRIBE: "kube-pod-describe",
  KUBE_TOP: "kube-top",
  ME_PLUGINS: "me-plugins",
  USERS: "users",
  OPERATIONS: "operations",
  OPERATION_DETAIL: "operation-detail",
  OPERATION_REPLAY: "operation-replay",
  QAA_RUNS: "qaa-runs",
  QAA_RUN_DETAIL: "qaa-run-detail",
  QAA_RUN_ARTIFACTS: "qaa-run-artifacts",
  QAA_USERS: "qaa-users",
} as const;

export type QueryKey = (typeof QueryKey)[keyof typeof QueryKey];

export const AGENT_HOST = "127.0.0.1" as const;
export const DEFAULT_AGENT_PORT_RANGE = [47600, 47601, 47602, 47603, 47604, 47605] as const;
export const DEFAULT_API_BASE_URL = "http://localhost:8000" as const;
export const AGENT_APP_NAME = "qaa-tms-agent" as const;
export const AGENT_REQUEST_HEADER = "X-QAA-TMS" as const;
export const AGENT_REQUEST_HEADER_VALUE = "1" as const;
export const AUTH_SCHEME_BEARER = "Bearer" as const;
export const DEFAULT_OPERATIONS_PAGE_SIZE = 20 as const;
export const DEFAULT_QAA_RUNS_PAGE_SIZE = 20 as const;
export const DEFAULT_JOB_POLL_INTERVAL_MS = 2000 as const;
export const DEFAULT_KUBECONFIG_STATUS_POLL_MS = 60000 as const;
export const DEFAULT_KUBE_LOG_TAIL = 200 as const;
export const DEFAULT_JENKINS_TREE_REFETCH_MS = 30000 as const;
export const DEFAULT_IMAGE_TAG = "latest" as const;
export const MIN_DEPLOY_STAGE = 0 as const;
export const MAX_DEPLOY_STAGE = 7 as const;

export const JenkinsNodeKind = {
  FOLDER: "folder",
  PIPELINE: "pipeline",
} as const;

export type JenkinsNodeKind = (typeof JenkinsNodeKind)[keyof typeof JenkinsNodeKind];

export const JenkinsStatus = {
  PASSED: "passed",
  FAILED: "failed",
  DISABLED: "disabled",
  RUNNING: "running",
  STUCK: "stuck",
  NOTBUILT: "notbuilt",
} as const;

export type JenkinsStatus = (typeof JenkinsStatus)[keyof typeof JenkinsStatus];

export const JenkinsStatusColor: Record<JenkinsStatus, string> = {
  [JenkinsStatus.PASSED]: "green",
  [JenkinsStatus.FAILED]: "red",
  [JenkinsStatus.DISABLED]: "gray",
  [JenkinsStatus.RUNNING]: "blue",
  [JenkinsStatus.STUCK]: "yellow",
  [JenkinsStatus.NOTBUILT]: "gray",
};

export const JenkinsStatusLabel: Record<JenkinsStatus, string> = {
  [JenkinsStatus.PASSED]: "Passed",
  [JenkinsStatus.FAILED]: "Failed",
  [JenkinsStatus.DISABLED]: "Disabled",
  [JenkinsStatus.RUNNING]: "Running",
  [JenkinsStatus.STUCK]: "Stuck",
  [JenkinsStatus.NOTBUILT]: "Not built",
};

export const QaaRunStatus = {
  QUEUED: "queued",
  RUNNING: "running",
  PAUSED: "paused",
  COMPLETED: "completed",
  FAILED: "failed",
  STOPPED: "stopped",
} as const;

export type QaaRunStatus = (typeof QaaRunStatus)[keyof typeof QaaRunStatus];

export const QaaRunStatusLabel: Record<QaaRunStatus, string> = {
  [QaaRunStatus.QUEUED]: "Queued",
  [QaaRunStatus.RUNNING]: "Running",
  [QaaRunStatus.PAUSED]: "Paused",
  [QaaRunStatus.COMPLETED]: "Completed",
  [QaaRunStatus.FAILED]: "Failed",
  [QaaRunStatus.STOPPED]: "Stopped",
};

export const QaaRunStatusColor: Record<QaaRunStatus, string> = {
  [QaaRunStatus.QUEUED]: "gray",
  [QaaRunStatus.RUNNING]: "blue",
  [QaaRunStatus.PAUSED]: "yellow",
  [QaaRunStatus.COMPLETED]: "teal",
  [QaaRunStatus.FAILED]: "red",
  [QaaRunStatus.STOPPED]: "orange",
};

export const TERMINAL_QAA_RUN_STATUSES = new Set<QaaRunStatus>([
  QaaRunStatus.COMPLETED,
  QaaRunStatus.FAILED,
  QaaRunStatus.STOPPED,
]);

export const QaaRunProfile = {
  BALANCED: "balanced",
  CODEX_ONLY: "codex-only",
  CLAUDE_ONLY: "claude-only",
} as const;

export type QaaRunProfile = (typeof QaaRunProfile)[keyof typeof QaaRunProfile];

export const QaaRunProfileLabel: Record<QaaRunProfile, string> = {
  [QaaRunProfile.BALANCED]: "Balanced",
  [QaaRunProfile.CODEX_ONLY]: "Codex only",
  [QaaRunProfile.CLAUDE_ONLY]: "Claude only",
};
