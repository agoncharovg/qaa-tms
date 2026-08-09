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
  HEALTH: "/health",
  READY: "/ready",
} as const;

export type BackendPath = (typeof BackendPath)[keyof typeof BackendPath];

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

export const ViewKey = {
  STAGINGS_PREFLIGHT: "stagings-preflight",
  STAGINGS_NAMESPACES: "stagings-namespaces",
  ADMIN_USERS: "admin-users",
} as const;

export type ViewKey = (typeof ViewKey)[keyof typeof ViewKey];

export const TabId = {
  STAGINGS_PREFLIGHT: "tab-stagings-preflight",
  STAGINGS_NAMESPACES: "tab-stagings-namespaces",
  ADMIN_USERS: "tab-admin-users",
} as const;

export type TabId = (typeof TabId)[keyof typeof TabId];

export const TabTitle: Record<TabId, string> = {
  [TabId.STAGINGS_PREFLIGHT]: "Preflight",
  [TabId.STAGINGS_NAMESPACES]: "Namespaces",
  [TabId.ADMIN_USERS]: "Users",
};

export const AGENT_HOST = "127.0.0.1" as const;
export const DEFAULT_AGENT_PORT_RANGE = [47600, 47601, 47602, 47603, 47604, 47605] as const;
export const DEFAULT_API_BASE_URL = "http://localhost:8000" as const;
export const AGENT_APP_NAME = "qaa-tms-agent" as const;
export const AGENT_REQUEST_HEADER = "X-QAA-TMS" as const;
