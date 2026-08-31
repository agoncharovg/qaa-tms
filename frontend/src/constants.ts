export const PluginId = {
  STAGINGS: "stagings",
  KUBER: "kuber",
  QAA_GENERATOR: "qaa-generator",
  JENKINS: "jenkins",
  LEONID: "leonid",
  NOTEBOOK: "notebook",
  REQUESTS: "requests",
  NOTIFICATOR: "notificator",
  STATISTICS: "statistics",
  ADMIN: "admin",
  PROFILE: "profile",
} as const;

export type PluginId = (typeof PluginId)[keyof typeof PluginId];

export const PluginOrigin = {
  BUILTIN: "builtin",
  LOCAL: "local",
} as const;

export type PluginOrigin = (typeof PluginOrigin)[keyof typeof PluginOrigin];

export const NavSection = {
  PRIMARY: "primary",
  ACCOUNT: "account",
} as const;

export type NavSection = (typeof NavSection)[keyof typeof NavSection];

export const IconName = {
  CLUSTER: "cluster",
  JENKINS: "jenkins",
  LEONID: "leonid",
  NOTEBOOK: "notebook",
  REQUESTS: "requests",
  NOTIFICATOR: "notificator",
  ROCKET: "rocket",
  SPARKLES: "sparkles",
  SETTINGS: "settings",
  STATISTICS: "statistics",
  USER: "user",
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
  COLOR_SCHEME: "qaa-tms.color-scheme",
  TABS: "qaa-tms.tabs",
  KUBE: "qaa-tms.kube",
  JENKINS_PINNED: "qaa-tms.jenkins-pinned",
  APP_API_BASE_URL: "qaa-tms.api-base-url",
  APP_AGENT_PORTS: "qaa-tms.agent-ports",
  SMOKE_REFRESH: "qaa-tms.smoke-refresh-ms",
} as const;

export type StorageKey = (typeof StorageKey)[keyof typeof StorageKey];

export const BackendPath = {
  AGENT_MANIFEST: "/api/v1/agent/manifest",
  AGENT_DOWNLOAD: "/api/v1/agent/download",
  AGENT_INSTALL_SCRIPT: "/api/v1/agent/install.sh",
  AUTH_LOGIN: "/api/v1/auth/login",
  JENKINS_SCOPE: "/api/v1/jenkins/scope",
  JENKINS_TREE: "/api/v1/jenkins/tree",
  JENKINS_BUILDS: "/api/v1/jenkins/builds",
  JENKINS_FOLDER: "/api/v1/jenkins/folder",
  JENKINS_FREEZES: "/api/v1/jenkins/freezes",
  JENKINS_RESUME_RUNS: "/api/v1/jenkins/resume-runs",
  LEONID_SHARED_RESOURCE_LIMIT_TYPES: "/api/v1/leonid/shared_resource_limit_types",
  LEONID_SHARED_RESOURCE_LIMITS: "/api/v1/leonid/shared_resource_limits",
  LEONID_SHARED_RESOURCES: "/api/v1/leonid/shared_resources",
  LEONID_SKIPPED_SUITES: "/api/v1/leonid/skipped_suites",
  LEONID_OBJECT_DEFINITIONS: "/api/v1/leonid/object_definitions",
  LEONID_OBJECT_VALUES: "/api/v1/leonid/object_values",
  LEONID_PIPELINE_PARAMS: "/api/v1/leonid/pipeline_params",
  NOTIFICATOR_CHOICES: "/api/v1/notificator/choices",
  NOTIFICATOR_CONFIGS: "/api/v1/notificator/notification_configs",
  NOTIFICATOR_TEAMS: "/api/v1/notificator/teams",
  NOTIFICATOR_PRODUCTS: "/api/v1/notificator/products",
  NOTIFICATOR_SUB_PRODUCTS: "/api/v1/notificator/sub_products",
  NOTIFICATOR_SLACK_CHANNELS: "/api/v1/notificator/slack_channels",
  NOTIFICATOR_USERS: "/api/v1/notificator/users",
  NOTIFICATOR_QAA_MEMBERS: "/api/v1/notificator/qaa_members",
  NOTIFICATOR_FAILURE_MENTION_RULES: "/api/v1/notificator/failure_mention_rules",
  NOTIFICATOR_EVENTS: "/api/v1/notificator/events",
  NOTIFICATOR_RECURRENT_FAILS: "/api/v1/notificator/recurrent_fails",
  NOTIFICATOR_FAIL_REASONS: "/api/v1/notificator/fail_reasons",
  NOTIFICATOR_MUTE_STATUSES: "/api/v1/notificator/mute_statuses",
  NOTIFICATOR_HISTORY: "/api/v1/notificator/history",
  ME: "/api/v1/me",
  ME_PLUGINS: "/api/v1/me/plugins",
  SETTINGS: "/api/v1/settings",
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
  SERVICE_TOKEN_REGENERATE: "/regenerate",
  REVOKE: "/revoke",
  HEALTH: "/health",
  READY: "/ready",
  SECURITY_PERMISSIONS: "/api/v1/security/permissions",
  SECURITY_ROLES: "/api/v1/security/roles",
  SECURITY_GROUPS: "/api/v1/security/groups",
  SECURITY_AUDIT: "/api/v1/security/audit",
  AUTHZ_CHECK: "/api/v1/authz/check",
} as const;

export type BackendPath = (typeof BackendPath)[keyof typeof BackendPath];

export function buildBackendUserPath(userId: number): string {
  return `${BackendPath.USERS}/${userId}`;
}

export function buildBackendJenkinsScopePath(): string {
  return BackendPath.JENKINS_SCOPE;
}

export function buildBackendJenkinsTreePath(signature: string): string {
  const params = new URLSearchParams({ signature });
  return `${BackendPath.JENKINS_TREE}?${params.toString()}`;
}

export function buildBackendJenkinsBuildsPath(signature: string, path: string): string {
  const params = new URLSearchParams({ path, signature });
  return `${BackendPath.JENKINS_BUILDS}?${params.toString()}`;
}

export function buildBackendJenkinsFolderPath(
  signature: string,
  path: string,
  ttlSeconds: number
): string {
  const params = new URLSearchParams({
    path,
    signature,
    ttl_seconds: String(ttlSeconds),
  });
  return `${BackendPath.JENKINS_FOLDER}?${params.toString()}`;
}

export function buildBackendJenkinsFreezesPath(
  signature: string,
  status?: JenkinsFreezeStatus
): string {
  const params = new URLSearchParams({ signature });
  if (status) {
    params.set("status", status);
  }
  return `${BackendPath.JENKINS_FREEZES}?${params.toString()}`;
}

export function buildBackendJenkinsFreezePath(freezeId: string): string {
  return `${BackendPath.JENKINS_FREEZES}/${encodeURIComponent(freezeId)}`;
}

export function buildBackendJenkinsFreezeSnapshotPath(freezeId: string): string {
  return `${buildBackendJenkinsFreezePath(freezeId)}/snapshot`;
}

export function buildBackendJenkinsFreezeResolvePath(freezeId: string): string {
  return `${buildBackendJenkinsFreezePath(freezeId)}/resolve`;
}

export function buildBackendJenkinsResumeRunsPath(
  signature: string,
  status?: JenkinsResumeRunStatus
): string {
  const params = new URLSearchParams({ signature });
  if (status) {
    params.set("status", status);
  }
  return `${BackendPath.JENKINS_RESUME_RUNS}?${params.toString()}`;
}

export function buildBackendJenkinsResumeRunPath(runId: string): string {
  return `${BackendPath.JENKINS_RESUME_RUNS}/${encodeURIComponent(runId)}`;
}

export function buildBackendJenkinsResumeRunCancelPath(runId: string): string {
  return `${buildBackendJenkinsResumeRunPath(runId)}/cancel`;
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


export function buildBackendQaaServiceTokenRegeneratePath(tokenId: string): string {
  return `${BackendPath.QAA_ADMIN_SERVICE_TOKENS}/${encodeURIComponent(tokenId)}${BackendPath.SERVICE_TOKEN_REGENERATE}`;
}

export function buildBackendLeonidSharedResourceLimitTypesPath(limitTypeId?: number): string {
  if (typeof limitTypeId === "number") {
    return `${BackendPath.LEONID_SHARED_RESOURCE_LIMIT_TYPES}/${encodeURIComponent(String(limitTypeId))}`;
  }

  return BackendPath.LEONID_SHARED_RESOURCE_LIMIT_TYPES;
}

export function buildBackendLeonidSharedResourceLimitsPath(limitId?: number): string {
  if (typeof limitId === "number") {
    return `${BackendPath.LEONID_SHARED_RESOURCE_LIMITS}/${encodeURIComponent(String(limitId))}`;
  }

  return BackendPath.LEONID_SHARED_RESOURCE_LIMITS;
}

export function buildBackendLeonidSharedResourcesPath(resourceId?: number): string {
  if (typeof resourceId === "number") {
    return `${BackendPath.LEONID_SHARED_RESOURCES}/${encodeURIComponent(String(resourceId))}`;
  }

  return BackendPath.LEONID_SHARED_RESOURCES;
}

export function buildBackendLeonidSharedResourceTogglePath(resourceId: number): string {
  return `${buildBackendLeonidSharedResourcesPath(resourceId)}/toggle_enabled`;
}

export function buildBackendLeonidSkippedSuitesPath(suiteId?: number): string {
  if (typeof suiteId === "number") {
    return `${BackendPath.LEONID_SKIPPED_SUITES}/${encodeURIComponent(String(suiteId))}`;
  }

  return BackendPath.LEONID_SKIPPED_SUITES;
}

export function buildBackendLeonidSkippedSuiteCancelPath(suiteId: number): string {
  return `${buildBackendLeonidSkippedSuitesPath(suiteId)}/cancel`;
}

export function buildBackendLeonidObjectDefinitionsPath(definitionId?: number): string {
  if (typeof definitionId === "number") {
    return `${BackendPath.LEONID_OBJECT_DEFINITIONS}/${encodeURIComponent(String(definitionId))}`;
  }

  return BackendPath.LEONID_OBJECT_DEFINITIONS;
}

export function buildBackendLeonidObjectDefinitionTogglePath(definitionId: number): string {
  return `${buildBackendLeonidObjectDefinitionsPath(definitionId)}/toggle_enabled`;
}

export function buildBackendLeonidObjectValuesPath(valueId?: number): string {
  if (typeof valueId === "number") {
    return `${BackendPath.LEONID_OBJECT_VALUES}/${encodeURIComponent(String(valueId))}`;
  }

  return BackendPath.LEONID_OBJECT_VALUES;
}

export function buildBackendLeonidObjectValueTogglePath(valueId: number): string {
  return `${buildBackendLeonidObjectValuesPath(valueId)}/toggle_enabled`;
}

export function buildBackendLeonidPipelineParamsPath(pipelineParamId?: number): string {
  if (typeof pipelineParamId === "number") {
    return `${BackendPath.LEONID_PIPELINE_PARAMS}/${encodeURIComponent(String(pipelineParamId))}`;
  }

  return BackendPath.LEONID_PIPELINE_PARAMS;
}

function buildBackendNotificatorItemPath(basePath: string, itemId?: number): string {
  if (typeof itemId === "number") {
    return `${basePath}/${encodeURIComponent(String(itemId))}`;
  }

  return basePath;
}

export function buildBackendNotificatorChoicesPath(): string {
  return BackendPath.NOTIFICATOR_CHOICES;
}

export function buildBackendNotificatorConfigsPath(options?: {
  configId?: number;
  productTeam?: string;
}): string {
  const path = buildBackendNotificatorItemPath(BackendPath.NOTIFICATOR_CONFIGS, options?.configId);
  if (!options?.productTeam || typeof options.configId === "number") {
    return path;
  }

  const params = new URLSearchParams({
    product_team: options.productTeam,
  });
  return `${path}?${params.toString()}`;
}

export function buildBackendNotificatorTeamsPath(teamId?: number): string {
  return buildBackendNotificatorItemPath(BackendPath.NOTIFICATOR_TEAMS, teamId);
}

export function buildBackendNotificatorProductsPath(productId?: number): string {
  return buildBackendNotificatorItemPath(BackendPath.NOTIFICATOR_PRODUCTS, productId);
}

export function buildBackendNotificatorSubProductsPath(subProductId?: number): string {
  return buildBackendNotificatorItemPath(BackendPath.NOTIFICATOR_SUB_PRODUCTS, subProductId);
}

export function buildBackendNotificatorSlackChannelsPath(channelId?: number): string {
  return buildBackendNotificatorItemPath(BackendPath.NOTIFICATOR_SLACK_CHANNELS, channelId);
}

export function buildBackendNotificatorUsersPath(userId?: number): string {
  return buildBackendNotificatorItemPath(BackendPath.NOTIFICATOR_USERS, userId);
}

export function buildBackendNotificatorQaaMembersPath(memberId?: number): string {
  return buildBackendNotificatorItemPath(BackendPath.NOTIFICATOR_QAA_MEMBERS, memberId);
}

export function buildBackendNotificatorFailureMentionRulesPath(ruleId?: number): string {
  return buildBackendNotificatorItemPath(BackendPath.NOTIFICATOR_FAILURE_MENTION_RULES, ruleId);
}

export function buildBackendNotificatorEventsPath(eventId?: number): string {
  return buildBackendNotificatorItemPath(BackendPath.NOTIFICATOR_EVENTS, eventId);
}

export function buildBackendNotificatorRecurrentFailsPath(recurrentFailId?: number): string {
  return buildBackendNotificatorItemPath(BackendPath.NOTIFICATOR_RECURRENT_FAILS, recurrentFailId);
}

export function buildBackendNotificatorFailReasonsPath(failReasonId?: number): string {
  return buildBackendNotificatorItemPath(BackendPath.NOTIFICATOR_FAIL_REASONS, failReasonId);
}

export function buildBackendNotificatorMuteStatusesPath(muteStatusId?: number): string {
  return buildBackendNotificatorItemPath(BackendPath.NOTIFICATOR_MUTE_STATUSES, muteStatusId);
}

export function buildBackendNotificatorHistoryPath(historyItemId?: number): string {
  return buildBackendNotificatorItemPath(BackendPath.NOTIFICATOR_HISTORY, historyItemId);
}

export const AgentPath = {
  PING: "/ping",
  SETTINGS: "/settings",
  PREFLIGHT: "/preflight",
  UPDATE: "/update",
  JENKINS_SCOPE: "/jenkins/scope",
  JENKINS_TREE: "/jenkins/tree",
  JENKINS_BUILDS: "/jenkins/builds",
  JENKINS_FOLDER: "/jenkins/folder",
  JENKINS_ALLURE_SKIP_CANDIDATES: "/jenkins/allure/skip-candidates",
  JENKINS_FREEZE: "/jenkins/freeze",
  JENKINS_RESUME: "/jenkins/resume",
  JENKINS_RESUME_RUN: "/jenkins/resume-run",
  NOTEBOOK_BOOKMARK: "/notebook/bookmark",
  NOTEBOOK_CONTENTS: "/notebook/contents",
  NOTEBOOK_NOTE: "/notebook/note",
  NOTEBOOK_SEARCH: "/notebook/search",
  NOTEBOOK_REMINDERS: "/notebook/reminders",
  REQUESTS_COLLECTIONS: "/requests/collections",
  REQUESTS_FOLDER: "/requests/folder",
  REQUESTS_ITEM: "/requests/item",
  REQUESTS_EXECUTE: "/requests/execute",
  REQUESTS_ENVIRONMENTS: "/requests/environments",
  REQUESTS_VARIABLES: "/requests/variables",
  REQUESTS_ENVIRONMENT_ACTIVE: "/requests/environments/active",
  REQUESTS_CREDENTIALS: "/requests/credentials",
  REQUESTS_CREDENTIAL_RESOLVE: "/requests/credentials/resolve",
  REQUESTS_HISTORY: "/requests/history",
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
  EXEC: "/exec",
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

export function buildAgentJenkinsScopePath(): string {
  return AgentPath.JENKINS_SCOPE;
}

export function buildAgentJenkinsBuildsPath(path: string): string {
  const params = new URLSearchParams({
    path,
  });
  return `${AgentPath.JENKINS_BUILDS}?${params.toString()}`;
}

export function buildAgentJenkinsFolderPath(path: string): string {
  const params = new URLSearchParams({
    path,
  });
  return `${AgentPath.JENKINS_FOLDER}?${params.toString()}`;
}
export function buildAgentJenkinsAllureSkipCandidatesPath(): string {
  return AgentPath.JENKINS_ALLURE_SKIP_CANDIDATES;
}


export function buildAgentNotebookNotesPath(bookmark: string): string {
  const params = new URLSearchParams({
    bookmark,
  });
  return `${AgentPath.NOTEBOOK_NOTE}?${params.toString()}`;
}

export function buildAgentNotebookNotePath(bookmark: string, name: string): string {
  const params = new URLSearchParams({
    bookmark,
  });
  return `${AgentPath.NOTEBOOK_NOTE}/${encodeURIComponent(name)}?${params.toString()}`;
}

export function buildAgentNotebookBookmarkPath(bookmark: string): string {
  const params = new URLSearchParams({
    bookmark,
  });
  return `${AgentPath.NOTEBOOK_BOOKMARK}?${params.toString()}`;
}

export function buildAgentNotebookSearchPath(query: string): string {
  const params = new URLSearchParams({
    query,
  });
  return `${AgentPath.NOTEBOOK_SEARCH}?${params.toString()}`;
}

export function buildAgentRequestsItemsPath(folder: string): string {
  const params = new URLSearchParams({
    folder,
  });
  return `${AgentPath.REQUESTS_ITEM}?${params.toString()}`;
}

export function buildAgentRequestsItemPath(folder: string, name: string): string {
  const params = new URLSearchParams({
    folder,
  });
  return `${AgentPath.REQUESTS_ITEM}/${encodeURIComponent(name)}?${params.toString()}`;
}

export function buildAgentRequestsFolderDeletePath(folder: string): string {
  const params = new URLSearchParams({
    folder,
  });
  return `${AgentPath.REQUESTS_FOLDER}?${params.toString()}`;
}

export function buildAgentRequestsCredentialPath(id: string): string {
  return `${AgentPath.REQUESTS_CREDENTIALS}/${encodeURIComponent(id)}`;
}
export function buildAgentRequestsEnvironmentPath(id: string): string {
  return `${AgentPath.REQUESTS_ENVIRONMENTS}/${encodeURIComponent(id)}`;
}

export function buildAgentRequestsVariablePath(id: string): string {
  return `${AgentPath.REQUESTS_VARIABLES}/${encodeURIComponent(id)}`;
}

export function buildAgentRequestsHistoryEntryPath(id: string): string {
  return `${AgentPath.REQUESTS_HISTORY}/${encodeURIComponent(id)}`;
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

export function buildAgentKubePodExecPath(pod: string): string {
  return `${AgentPath.KUBE_PODS}/${encodeURIComponent(pod)}${AgentPath.EXEC}`;
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
  KUBE_EXEC: "kube_exec",
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
  [OperationType.KUBE_EXEC]: "Exec in pod",
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
  LAST_EVENT_ID: "Last-Event-ID",
} as const;

export type HttpHeader = (typeof HttpHeader)[keyof typeof HttpHeader];

export const MediaType = {
  JSON: "application/json",
  TEXT_EVENT_STREAM: "text/event-stream",
} as const;

export type MediaType = (typeof MediaType)[keyof typeof MediaType];

export const HttpStatus = {
  ACCEPTED: 202,
  CONFLICT: 409,
  NO_CONTENT: 204,
} as const;

export type HttpStatus = (typeof HttpStatus)[keyof typeof HttpStatus];

export const ViewKey = {
  STAGINGS_PREFLIGHT: "stagings-preflight",
  JENKINS_TREE: "jenkins-tree",
  JENKINS_BOARD: "jenkins-board",
  LEONID_SHARED_RESOURCES: "leonid-shared-resources",
  LEONID_SKIPPED_TESTS: "leonid-skipped-tests",
  LEONID_OBJECTS: "leonid-objects",
  LEONID_PIPELINE_CONFIGS: "leonid-pipeline-configs",
  NOTEBOOK_BROWSE: "notebook-browse",
  NOTEBOOK_REMINDERS: "notebook-reminders",
  NOTEBOOK_SEARCH: "notebook-search",
  REQUESTS_BUILDER: "requests-builder",
  REQUESTS_CREDENTIALS: "requests-credentials",
  REQUESTS_ENVIRONMENTS: "requests-environments",
  REQUESTS_HISTORY: "requests-history",
  NOTIFICATOR_CONTRACT_MANAGER: "notificator-contract-manager",
  NOTIFICATOR_NOTIFICATIONS: "notificator-notifications",
  STATISTICS_SMOKE: "statistics-smoke",
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
  ADMIN_USERS: "admin-users",
  ADMIN_INTEGRATIONS: "admin-integrations",
  ADMIN_SECURITY: "admin-security",
  PROFILE: "profile",
} as const;

export type ViewKey = (typeof ViewKey)[keyof typeof ViewKey];

export const TabId = {
  STAGINGS_PREFLIGHT: "tab-stagings-preflight",
  JENKINS_TREE: "tab-jenkins-tree",
  JENKINS_BOARD: "tab-jenkins-board",
  LEONID_SHARED_RESOURCES: "tab-leonid-shared-resources",
  LEONID_SKIPPED_TESTS: "tab-leonid-skipped-tests",
  LEONID_OBJECTS: "tab-leonid-objects",
  LEONID_PIPELINE_CONFIGS: "tab-leonid-pipeline-configs",
  NOTEBOOK_BROWSE: "tab-notebook-browse",
  NOTEBOOK_SEARCH: "tab-notebook-search",
  REQUESTS_BUILDER: "tab-requests-builder",
  REQUESTS_CREDENTIALS: "tab-requests-credentials",
  REQUESTS_ENVIRONMENTS: "tab-requests-environments",
  REQUESTS_HISTORY: "tab-requests-history",
  NOTIFICATOR_CONTRACT_MANAGER: "tab-notificator-contract-manager",
  NOTIFICATOR_NOTIFICATIONS: "tab-notificator-notifications",
  STATISTICS_SMOKE: "tab-statistics-smoke",
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
  ADMIN_USERS: "tab-admin-users",
  ADMIN_INTEGRATIONS: "tab-admin-integrations",
  ADMIN_SECURITY: "tab-admin-security",
  PROFILE: "tab-profile",
} as const;

export type TabId = (typeof TabId)[keyof typeof TabId];

export const TabTitle: Record<TabId, string> = {
  [TabId.STAGINGS_PREFLIGHT]: "Preflight",
  [TabId.JENKINS_TREE]: "Tree",
  [TabId.JENKINS_BOARD]: "Pinned",
  [TabId.LEONID_SHARED_RESOURCES]: "Shared resources",
  [TabId.LEONID_SKIPPED_TESTS]: "Skipped tests",
  [TabId.LEONID_OBJECTS]: "Objects",
  [TabId.LEONID_PIPELINE_CONFIGS]: "Pipeline configs",
  [TabId.NOTEBOOK_BROWSE]: "Notes",
  [TabId.NOTEBOOK_SEARCH]: "Search",
  [TabId.REQUESTS_BUILDER]: "Collections",
  [TabId.REQUESTS_CREDENTIALS]: "Credentials",
  [TabId.REQUESTS_ENVIRONMENTS]: "Environments",
  [TabId.REQUESTS_HISTORY]: "History",
  [TabId.NOTIFICATOR_CONTRACT_MANAGER]: "Contract manager",
  [TabId.NOTIFICATOR_NOTIFICATIONS]: "Notifications",
  [TabId.STATISTICS_SMOKE]: "Smoke",
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
  [TabId.ADMIN_USERS]: "Users",
  [TabId.ADMIN_INTEGRATIONS]: "QAA generator",
  [TabId.ADMIN_SECURITY]: "Security",
  [TabId.PROFILE]: "Profile",
};

export const ProfileSection = {
  ACCOUNT: "account",
  PLUGINS: "plugins",
  SETTINGS: "settings",
} as const;

export type ProfileSection = (typeof ProfileSection)[keyof typeof ProfileSection];

export const ProfileSectionLabel: Record<ProfileSection, string> = {
  [ProfileSection.ACCOUNT]: "Account",
  [ProfileSection.PLUGINS]: "Plugins",
  [ProfileSection.SETTINGS]: "Settings",
};

export const PROFILE_SECTION_ORDER = [
  ProfileSection.ACCOUNT,
  ProfileSection.PLUGINS,
  ProfileSection.SETTINGS,
] as const;

export const QueryKey = {
  ME: "me",
  AGENT_DISCOVERY: "agent-discovery",
  AGENT_MANIFEST: "agent-manifest",
  AGENT_PREFLIGHT: "agent-preflight",
  AGENT_SETTINGS: "agent-settings",
  AGENT_JOB: "agent-job",
  NOTEBOOK_CONTENTS: "notebook-contents",
  NOTEBOOK_NOTES: "notebook-notes",
  NOTEBOOK_NOTE: "notebook-note",
  NOTEBOOK_REMINDERS: "notebook-reminders",
  NOTEBOOK_SEARCH: "notebook-search",
  REQUESTS_COLLECTIONS: "requests-collections",
  REQUESTS_ITEMS: "requests-items",
  REQUESTS_ITEM: "requests-item",
  REQUESTS_CREDENTIALS: "requests-credentials",
  REQUESTS_ENVIRONMENTS: "requests-environments",
  REQUESTS_HISTORY: "requests-history",
  AGENT_NAMESPACES: "agent-namespaces",
  AGENT_NAMESPACE_STATUS: "agent-namespace-status",
  AGENT_NAMESPACE_CREDS: "agent-namespace-creds",
  AGENT_E2E_SUITES: "agent-e2e-suites",
  LEONID_SHARED_RESOURCE_LIMIT_TYPES: "leonid-shared-resource-limit-types",
  LEONID_SHARED_RESOURCE_LIMITS: "leonid-shared-resource-limits",
  LEONID_SHARED_RESOURCES: "leonid-shared-resources",
  LEONID_SKIPPED_SUITES: "leonid-skipped-suites",
  LEONID_OBJECT_DEFINITIONS: "leonid-object-definitions",
  LEONID_OBJECT_VALUES: "leonid-object-values",
  NOTIFICATOR_CHOICES: "notificator-choices",
  NOTIFICATOR_NOTIFICATION_CONFIGS: "notificator-notification-configs",
  NOTIFICATOR_TEAMS: "notificator-teams",
  NOTIFICATOR_PRODUCTS: "notificator-products",
  NOTIFICATOR_SUB_PRODUCTS: "notificator-sub-products",
  NOTIFICATOR_SLACK_CHANNELS: "notificator-slack-channels",
  NOTIFICATOR_USERS: "notificator-users",
  NOTIFICATOR_QAA_MEMBERS: "notificator-qaa-members",
  NOTIFICATOR_FAILURE_MENTION_RULES: "notificator-failure-mention-rules",
  NOTIFICATOR_EVENTS: "notificator-events",
  NOTIFICATOR_RECURRENT_FAILS: "notificator-recurrent-fails",
  NOTIFICATOR_FAIL_REASONS: "notificator-fail-reasons",
  NOTIFICATOR_MUTE_STATUSES: "notificator-mute-statuses",
  NOTIFICATOR_HISTORY: "notificator-history",
  LEONID_PIPELINE_PARAMS: "leonid-pipeline-params",
  JENKINS_SCOPE: "jenkins-scope",
  JENKINS_TREE: "jenkins-tree",
  JENKINS_TREE_CACHE: "jenkins-tree-cache",
  JENKINS_BUILDS: "jenkins-builds",
  JENKINS_FOLDER: "jenkins-folder",
  JENKINS_FOLDER_CACHE: "jenkins-folder-cache",
  JENKINS_FREEZES: "jenkins-freezes",
  JENKINS_RESUME_RUN: "jenkins-resume-run",
  KUBECONFIG_STATUS: "kubeconfig-status",
  KUBE_CONTEXTS: "kube-contexts",
  KUBE_NAMESPACES: "kube-namespaces",
  KUBE_PODS: "kube-pods",
  KUBE_POD_DESCRIBE: "kube-pod-describe",
  KUBE_TOP: "kube-top",
  ME_PLUGINS: "me-plugins",
  SERVER_SETTINGS: "server-settings",
  USERS: "users",
  OPERATIONS: "operations",
  OPERATION_DETAIL: "operation-detail",
  OPERATION_REPLAY: "operation-replay",
  QAA_RUNS: "qaa-runs",
  QAA_RUN_DETAIL: "qaa-run-detail",
  QAA_RUN_ARTIFACTS: "qaa-run-artifacts",
  QAA_USERS: "qaa-users",
  SECURITY_ROLES: "security-roles",
  SECURITY_GROUPS: "security-groups",
  SECURITY_PERMISSIONS: "security-permissions",
  SECURITY_AUDIT: "security-audit",
  USER_PERMISSIONS: "user-permissions",
} as const;

export type QueryKey = (typeof QueryKey)[keyof typeof QueryKey];

export const CompanionStatusKind = {
  LOADING: "loading",
  ERROR: "error",
  NOT_INSTALLED: "not-installed",
  UPDATE_REQUIRED: "update-required",
  UPDATE_AVAILABLE: "update-available",
  OK: "ok",
} as const;

export type CompanionStatusKind =
  (typeof CompanionStatusKind)[keyof typeof CompanionStatusKind];

export const QaaAdminSubTab = {
  USERS: "users",
  SERVICES: "services",
} as const;

export type QaaAdminSubTab = (typeof QaaAdminSubTab)[keyof typeof QaaAdminSubTab];

export const QaaSubjectKind = {
  USER: "user",
  SERVICE: "service",
} as const;

export type QaaSubjectKind = (typeof QaaSubjectKind)[keyof typeof QaaSubjectKind];

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
export const DEFAULT_JENKINS_TREE_REFETCH_MS = 900000 as const;
export const DEFAULT_JENKINS_BUILDS_REFETCH_MS = 60000 as const;
export const JENKINS_RESUME_RUN_REFETCH_MS = 1500 as const;

// Statistics/Smoke live dashboard: online status of the SMOKE folder pipelines.
export const SMOKE_REFRESH_OPTIONS_MS = [60000, 120000, 300000] as const;
export const DEFAULT_SMOKE_REFRESH_MS = 60000 as const;
// The E2E preprod SMOKE folder (https://jenkins.p.gc.onl/job/.QAA/job/E2E/job/PREPROD/job/SMOKE/).
// This path sits inside the agent's allowed Jenkins scope (.QAA/E2E/PREPROD).
export const DEFAULT_SMOKE_FOLDER_PATH = "job/.QAA/job/E2E/job/PREPROD/job/SMOKE" as const;
export const SMOKE_TIMELINE_WINDOW_MS = 3600000 as const;
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

export const JenkinsFreezeStatus = {
  ACTIVE: "active",
  RESOLVED: "resolved",
  MERGED: "merged",
} as const;

export type JenkinsFreezeStatus = (typeof JenkinsFreezeStatus)[keyof typeof JenkinsFreezeStatus];

export const JenkinsResumeOutcome = {
  ENABLED: "enabled",
  ERROR: "error",
  MISSING: "missing",
  RESTORED: "restored",
} as const;

export type JenkinsResumeOutcome = (typeof JenkinsResumeOutcome)[keyof typeof JenkinsResumeOutcome];

export const JenkinsResumeRunStatus = {
  RUNNING: "running",
  DONE: "done",
  CANCELLED: "cancelled",
  FAILED: "failed",
} as const;

export type JenkinsResumeRunStatus =
  (typeof JenkinsResumeRunStatus)[keyof typeof JenkinsResumeRunStatus];

export const JenkinsResumeItemState = {
  PENDING: "pending",
  STARTED: "started",
  SKIPPED: "skipped",
  ERROR: "error",
} as const;

export type JenkinsResumeItemState =
  (typeof JenkinsResumeItemState)[keyof typeof JenkinsResumeItemState];

export const JenkinsResumeItemStateColor: Record<JenkinsResumeItemState, string> = {
  [JenkinsResumeItemState.ERROR]: "red",
  [JenkinsResumeItemState.PENDING]: "gray",
  [JenkinsResumeItemState.SKIPPED]: "gray",
  [JenkinsResumeItemState.STARTED]: "green",
};

export const JenkinsResumeItemStateLabel: Record<JenkinsResumeItemState, string> = {
  [JenkinsResumeItemState.ERROR]: "Error",
  [JenkinsResumeItemState.PENDING]: "Pending",
  [JenkinsResumeItemState.SKIPPED]: "Skipped",
  [JenkinsResumeItemState.STARTED]: "Started",
};

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

export const JenkinsFreezeCopy = {
  BADGE: "Frozen",
  FREEZE_ACTION: "Freeze folder...",
  FREEZE_CONFIRM: "Freeze folder",
  FREEZE_REASON_LABEL: "Reason",
  FREEZE_REASON_PLACEHOLDER: "Explain why this subtree is being frozen.",
  FREEZE_REASON_REQUIRED: "Reason is required.",
  FREEZE_TITLE: "Freeze Jenkins folder",
  FREEZE_KILL_BUILDS: "Kill running builds",
  FREEZE_MERGE_DESCRIPTION: "Choose which intersecting freezes the new freeze should absorb.",
  FREEZE_MERGE_TITLE: "Merge existing freezes",
  FREEZE_CANCEL: "Cancel",
  FREEZE_ROW_LOADING: "Updating freeze state",
  RESUME_ACTION: "Resume folder",
  RESUME_CONFIRM: "Resume folder",
  RESUME_CONFIRM_MESSAGE:
    "Restore {restore} pipeline(s) in {folder}. {build} will be rebuilt now; {scheduled} scheduled pipeline(s) will only be re-enabled.",
  RESUME_RESTART_PIPELINES: "Automatically restart resumed pipelines",
  RESUME_CONFIRM_TITLE: "Resume Jenkins folder",
  RESUME_PARTIAL_MESSAGE:
    "Restored {restored}, enabled {enabled}, missing {missing}, errors {error}. The freeze stays active so you can retry the failed pipelines.",
  RESUME_PARTIAL_TITLE: "Folder partially resumed",
  RESUME_SUCCESS_MESSAGE: "Restored {restored}, enabled {enabled}, missing {missing}, errors {error}.",
  RESUME_SUCCESS_TITLE: "Folder resumed",
} as const;

export const JenkinsResumeRunCopy = {
  CANCEL: "Cancel",
  CANCELLED_SUMMARY: "Resume cancelled.",
  CLOSE: "Close",
  DONE_SUMMARY: "Resume completed.",
  FINISHING: "Finishing...",
  NOW_STARTING: "Starting now",
  NOW_ENABLING: "Enabling now",
  PROGRESS: "Progress",
  SKIPPED: "Skipped",
  STARTED_BY: "Started by {user} · {when}",
  STARTED_COUNT: "{started}/{total} started",
  ENABLED: "Enabled",
  ENABLED_COUNT: "{started}/{total} enabled",
  TITLE: "Resume campaign",
  WHO_CANCELLED: "Cancelled by {user}",
} as const;

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
