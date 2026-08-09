export const SectionKey = {
  STAGINGS: "stagings",
  ADMIN: "admin",
} as const;

export type SectionKey = (typeof SectionKey)[keyof typeof SectionKey];

export const SectionLabel: Record<SectionKey, string> = {
  [SectionKey.STAGINGS]: "Stagings",
  [SectionKey.ADMIN]: "Administration",
};

export const ContentType = {
  REACT_VIEW: "react-view",
  IFRAME: "iframe",
  HTML: "html",
} as const;

export type ContentType = (typeof ContentType)[keyof typeof ContentType];

export const RoutePath = {
  ROOT: "/",
  LOGIN: "/login",
  STAGINGS: "/stagings",
  ADMIN: "/admin",
  ADMIN_USERS: "/admin/users",
} as const;

export type RoutePath = (typeof RoutePath)[keyof typeof RoutePath];

export const SectionRoute: Record<SectionKey, RoutePath> = {
  [SectionKey.STAGINGS]: RoutePath.STAGINGS,
  [SectionKey.ADMIN]: RoutePath.ADMIN_USERS,
};

export const StorageKey = {
  TOKEN: "qaa-tms.token",
  REMEMBER_ME: "qaa-tms.remember-me",
  AUTO_LOGIN: "qaa-tms.auto-login",
  SIDEBAR_COLLAPSED: "qaa-tms.sidebar-collapsed",
  TABS: "qaa-tms.tabs",
} as const;

export type StorageKey = (typeof StorageKey)[keyof typeof StorageKey];

export const BackendPath = {
  AUTH_LOGIN: "/api/v1/auth/login",
  ME: "/api/v1/me",
  OPERATIONS: "/api/v1/operations",
  REPLAY: "/replay",
  HEALTH: "/health",
  READY: "/ready",
} as const;

export type BackendPath = (typeof BackendPath)[keyof typeof BackendPath];

export function buildBackendOperationPath(operationId: string): string {
  return `${BackendPath.OPERATIONS}/${operationId}`;
}

export function buildBackendOperationReplayPath(operationId: string): string {
  return `${buildBackendOperationPath(operationId)}${BackendPath.REPLAY}`;
}

export const AgentPath = {
  PING: "/ping",
  PREFLIGHT: "/preflight",
  SETUP: "/setup",
  NAMESPACES: "/namespaces",
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

export const OperationType = {
  DEPLOY: "deploy",
  DESTROY: "destroy",
  E2E_RUN: "e2e_run",
  ADOPT: "adopt",
  SYNC: "sync",
  SETUP: "setup",
} as const;

export type OperationType = (typeof OperationType)[keyof typeof OperationType];

export const OperationTypeLabel: Record<OperationType, string> = {
  [OperationType.DEPLOY]: "Deploy",
  [OperationType.DESTROY]: "Destroy",
  [OperationType.E2E_RUN]: "E2E run",
  [OperationType.ADOPT]: "Adopt",
  [OperationType.SYNC]: "Sync",
  [OperationType.SETUP]: "Setup",
};

export const OperationStatus = {
  QUEUED: "queued",
  RUNNING: "running",
  SUCCESS: "success",
  FAILED: "failed",
  ABORTED: "aborted",
} as const;

export type OperationStatus = (typeof OperationStatus)[keyof typeof OperationStatus];

export const JobStatus = OperationStatus;
export type JobStatus = OperationStatus;

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

export const ViewKey = {
  STAGINGS_PREFLIGHT: "stagings-preflight",
  STAGINGS_DEPLOY: "stagings-deploy",
  STAGINGS_HISTORY: "stagings-history",
  STAGINGS_NAMESPACES: "stagings-namespaces",
  ADMIN_USERS: "admin-users",
} as const;

export type ViewKey = (typeof ViewKey)[keyof typeof ViewKey];

export const TabId = {
  STAGINGS_PREFLIGHT: "tab-stagings-preflight",
  STAGINGS_DEPLOY: "tab-stagings-deploy",
  STAGINGS_HISTORY: "tab-stagings-history",
  STAGINGS_NAMESPACES: "tab-stagings-namespaces",
  ADMIN_USERS: "tab-admin-users",
} as const;

export type TabId = (typeof TabId)[keyof typeof TabId];

export const TabTitle: Record<TabId, string> = {
  [TabId.STAGINGS_PREFLIGHT]: "Preflight",
  [TabId.STAGINGS_DEPLOY]: "Deploy",
  [TabId.STAGINGS_HISTORY]: "History",
  [TabId.STAGINGS_NAMESPACES]: "Namespaces",
  [TabId.ADMIN_USERS]: "Users",
};

export const QueryKey = {
  AGENT_PREFLIGHT: "agent-preflight",
  AGENT_JOB: "agent-job",
  OPERATIONS: "operations",
  OPERATION_DETAIL: "operation-detail",
  OPERATION_REPLAY: "operation-replay",
} as const;

export type QueryKey = (typeof QueryKey)[keyof typeof QueryKey];

export const AGENT_HOST = "127.0.0.1" as const;
export const DEFAULT_AGENT_PORT_RANGE = [47600, 47601, 47602, 47603, 47604, 47605] as const;
export const DEFAULT_API_BASE_URL = "http://localhost:8000" as const;
export const AGENT_APP_NAME = "qaa-tms-agent" as const;
export const AGENT_REQUEST_HEADER = "X-QAA-TMS" as const;
export const AGENT_REQUEST_HEADER_VALUE = "1" as const;
export const DEFAULT_OPERATIONS_PAGE_SIZE = 20 as const;
export const MIN_DEPLOY_STAGE = 0 as const;
export const MAX_DEPLOY_STAGE = 7 as const;
