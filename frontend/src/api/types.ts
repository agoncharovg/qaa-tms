import type {
  ContentType,
  JenkinsFreezeStatus,
  JenkinsResumeItemState,
  JenkinsResumeRunStatus,
  JenkinsNodeKind,
  JenkinsResumeOutcome,
  JenkinsStatus,
  JobStatus,
  JobStreamEvent,
  KubeconfigAction,
  KubeconfigReason,
  NamespaceLogStatus,
  NamespaceOrigin,
  OperationStatus,
  OperationType,
  PreflightKey,
  PluginId,
  Product,
  QaaRunProfile,
  QaaRunStatus,
  TabId,
  ViewKey,
} from "@/constants";

export interface User {
  id: number;
  username: string;
  display_name: string;
  is_admin: boolean;
  auto_login: boolean;
  enabled_plugins: PluginId[];
  qaa_generator_token_set?: boolean;
  created_at: string;
  updated_at: string;
}

export interface MePluginsUpdateRequest {
  enabled_plugins: PluginId[];
}

export interface MePluginsResponse {
  enabled_plugins: PluginId[];
}

export interface MeUpdateRequest {
  display_name?: string;
  password?: string;
  auto_login?: boolean;
}

export interface UserCreateRequest {
  username: string;
  password: string;
  display_name: string;
  is_admin?: boolean;
  auto_login?: boolean;
}

export interface UserUpdateRequest {
  display_name?: string;
  is_admin?: boolean;
  auto_login?: boolean;
  password?: string;
}

export interface UserListResponse {
  items: User[];
  total: number;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
  user: User;
}

export interface ServerSettingsRead {
  qaa_generator_base_url: string;
  qaa_generator_superuser_token_set: boolean;
  qaa_generator_port_forward_enabled: boolean;
  qaa_generator_port_forward_namespace: string;
  qaa_generator_port_forward_resource: string;
  qaa_generator_port_forward_local_port: number;
  qaa_generator_port_forward_remote_port: number;
}

export interface ServerSettingsUpdateRequest {
  qaa_generator_base_url?: string;
  qaa_generator_superuser_token?: string;
  qaa_generator_port_forward_enabled?: boolean;
  qaa_generator_port_forward_namespace?: string;
  qaa_generator_port_forward_resource?: string;
  qaa_generator_port_forward_local_port?: number;
  qaa_generator_port_forward_remote_port?: number;
}

export interface AgentPingResponse {
  app: string;
  version: string;
  stagingsInstalled: boolean;
  stagingsSha: string | null;
  os: string;
}

export interface PreflightItem {
  key: PreflightKey;
  ok: boolean;
  detail: string;
  howTo: string;
}

export interface AgentPreflightUnavailable {
  detected: false;
  ports: number[];
}

export interface AgentPreflightAvailable {
  detected: true;
  port: number;
  agent: AgentPingResponse;
  checklist: PreflightItem[];
}

export type AgentPreflightState = AgentPreflightAvailable | AgentPreflightUnavailable;

export interface AgentSettings {
  jenkins_url: string;
  jenkins_username: string;
  jenkins_token_set: boolean;
  jenkins_root_groups: JenkinsRootGroup[];
  qaa_generator_token_set: boolean;
  jenkins_root_folders: string[];
  jenkins_history_limit: number;
  jenkins_request_timeout: number;
  jenkins_tree_depth: number;
  jenkins_stuck_min_idle_hours: number;
  staging_bin: string | null;
  stagings_repo: string | null;
  staging_kubeconfig: string;
  staging_kubeconfig_url: string;
  kubeconfig_active_path: string;
  staging_kubeconfig_max_age_hours: number;
  kubectl_bin: string;
  kubeconfig: string;
  kubectl_request_timeout: string;
}

export interface AgentSettingsUpdate {
  jenkins_url?: string;
  jenkins_username?: string;
  jenkins_token?: string;
  jenkins_root_groups?: JenkinsRootGroup[];
  qaa_generator_token?: string;
  jenkins_root_folders?: string[];
  jenkins_history_limit?: number;
  jenkins_request_timeout?: number;
  jenkins_tree_depth?: number;
  jenkins_stuck_min_idle_hours?: number;
  staging_bin?: string | null;
  stagings_repo?: string | null;
  staging_kubeconfig?: string;
  staging_kubeconfig_url?: string;
  kubeconfig_active_path?: string;
  staging_kubeconfig_max_age_hours?: number;
  kubectl_bin?: string;
  kubeconfig?: string;
  kubectl_request_timeout?: string;
}

export interface KubeconfigStatus {
  path: string;
  activePath: string;
  exists: boolean;
  contentValid: boolean;
  tokenExpiresAt: string | null;
  tokenExpired: boolean;
  modifiedAt: string | null;
  ageSeconds: number | null;
  maxAgeSeconds: number;
  stale: boolean;
  active: boolean;
  healthy: boolean;
  recommendedAction: KubeconfigAction;
  reasons: KubeconfigReason[];
  url: string;
}

export interface KubeconfigRefreshRequest {
  activate: boolean;
}

export interface DeployFlags {
  clean: boolean;
  full: boolean;
  dryRun: boolean;
  noSync: boolean;
  stage: number | null;
}

export interface DeployRequest {
  ns: string;
  services: string[];
  images: Record<string, string>;
  flags: DeployFlags;
}

export interface DestroyRequest {
  ns: string;
}

export interface AdoptRequest {
  ns: string;
}

export interface SyncFlags {
  service?: string;
  verbose?: boolean;
  pull?: boolean;
  apply?: boolean;
}

export interface SyncRequest {
  flags: SyncFlags;
}

export interface KubeUseContextRequest {
  context: string;
}

export interface KubeDeletePodRequest {
  context: string | null;
  namespace: string;
}

export interface E2eSuite {
  name: string;
  marks: string;
}

export interface E2eSuitesResponse {
  product: Product;
  suites: E2eSuite[];
  exitCode: number;
}

export interface E2eRunRequest {
  ns: string;
  product: Product;
  suites: string[];
  threads?: number;
}

export interface JobCreateResponse {
  jobId: string;
  opId: string;
}

export interface QaaRunCreateRequest {
  jira_key: string;
  dry_run: boolean;
  skip_pr: boolean;
  skip_exec: boolean;
  branch: string | null;
  profile: QaaRunProfile;
}

export interface QaaRunSummary {
  run_id: string;
  jira_key: string;
  status: QaaRunStatus;
  effective_actor?: string | null;
  profile?: QaaRunProfile | null;
  dry_run?: boolean;
  skip_pr?: boolean;
  skip_exec?: boolean;
  branch?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface QaaRunRead extends QaaRunSummary {
  created_at: string;
  updated_at: string;
}

export interface QaaRunArtifacts {
  report_text?: string | null;
  pr_url?: string | null;
  archive?: Record<string, unknown> | null;
}

export interface QaaRunListResponse {
  items: QaaRunSummary[];
  next_cursor: string | null;
}

export interface QaaRunEvent {
  sequence: number;
  event_type: string;
  message: string;
  payload: Record<string, unknown> | null;
}

export interface QaaRunControlResponse {
  run_id: string;
}

export interface QaaUser {
  id: string;
  email?: string | null;
  slack_user_id?: string | null;
  name?: string | null;
  description?: string | null;
  kind?: string | null;
  token_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  [key: string]: unknown;
}

export interface QaaUserCreateRequest {
  email?: string;
  slack_user_id?: string;
  name?: string;
  description?: string;
}

export interface QaaUserUpdateRequest {
  email?: string | null;
  slack_user_id?: string | null;
  name?: string | null;
  description?: string | null;
}

export interface QaaUserListResponse {
  items: QaaUser[];
  next_cursor?: string | null;
  total?: number;
  [key: string]: unknown;
}

export interface QaaUserTokenCreateResponse {
  user: QaaUser;
  token: string;
}

export interface QaaUserTokenRegenerateResponse {
  token: string;
}

export interface QaaServiceTokenCreateRequest {
  name: string;
}

export interface QaaServiceTokenRevokeResponse {
  revoked: boolean;
}

export interface JobRead {
  jobId: string;
  opId: string;
  status: JobStatus;
  argv: string[];
  exitCode: number | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface ClusterNamespace {
  name: string;
  status: string;
  createdAt: string | null;
  hasLocalOverlay: boolean;
}

export interface LocalOverlay {
  name: string;
}

export interface NamespaceList {
  raw: string;
  clusterNamespaces: ClusterNamespace[];
  localOverlays: LocalOverlay[];
  exitCode: number;
}

export interface NamespaceStatus {
  ns: string;
  raw: string;
  exitCode: number;
}

export interface NamespaceCreds {
  ns: string;
  raw: string;
  exitCode: number;
}

export interface NamespaceDeployRecipe {
  ns: string;
  recipe: {
    product?: Product | null;
    services: string[];
    images: Record<string, string>;
    suites: string[];
    flags: DeployFlags;
  };
}

export interface KubeContext {
  name: string;
  cluster: string;
  user: string;
  namespace: string | null;
  current: boolean;
}

export interface KubeContextsResponse {
  contexts: KubeContext[];
  currentContext: string | null;
  exitCode: number;
}

export interface KubeNamespace {
  name: string;
  phase: string | null;
}

export interface KubeNamespacesResponse {
  namespaces: KubeNamespace[];
  exitCode: number;
}

export interface KubePod {
  name: string;
  phase: string | null;
  ready: string;
  restarts: number;
  containers: string[];
  node: string | null;
  createdAt: string | null;
}

export interface KubePodsResponse {
  pods: KubePod[];
  exitCode: number;
}

export interface KubePodDescribe {
  name: string;
  raw: string;
  exitCode: number;
}

export interface KubeTopResponse {
  raw: string;
  exitCode: number;
}

export interface KubeCommandResult {
  raw: string;
  exitCode: number;
}

export interface JenkinsNode {
  name: string;
  path: string;
  url: string;
  kind: JenkinsNodeKind;
  status: JenkinsStatus | null;
  color: string | null;
  synthetic: boolean;
  scheduled: boolean;
  builds: JenkinsBuild[];
  children: JenkinsNode[];
}

export interface JenkinsRootGroup {
  label: string;
  path: string;
}

export interface JenkinsTreeResponse {
  signature: string;
  roots: JenkinsNode[];
}

export interface JenkinsBuild {
  number: number;
  result: string | null;
  building: boolean;
  timestamp: number;
  durationMs: number;
  url: string;
  allureUrl: string;
}

export interface JenkinsBuildsResponse {
  builds: JenkinsBuild[];
}

export interface JenkinsFreezeSnapshotItem {
  path: string;
  fullName: string;
  name: string;
  wasDisabled: boolean;
  scheduled: boolean;
  wasBuilding: boolean;
}

export interface JenkinsFreezeRequest {
  folderPath: string;
  killBuilds: boolean;
}

export interface JenkinsFreezeResponse {
  snapshot: JenkinsFreezeSnapshotItem[];
}

export interface JenkinsResumeRequest {
  snapshot: JenkinsFreezeSnapshotItem[];
}

export interface JenkinsResumeOutcomeItem {
  fullName: string;
  outcome: JenkinsResumeOutcome;
  detail: string | null;
}

export interface JenkinsResumeResponse {
  outcomes: JenkinsResumeOutcomeItem[];
}

export interface JenkinsResumeRunRequest {
  runId: string;
  snapshot: JenkinsFreezeSnapshotItem[];
  restartPipelines: boolean;
}

export interface JenkinsResumeRunAccepted {
  runId: string;
}

export interface JenkinsFreezeCreateRequest {
  folderPath: string;
  folderName: string;
  signature: string;
  reason: string;
  killBuilds: boolean;
}

export interface JenkinsFreezeSnapshotPutRequest {
  snapshot: JenkinsFreezeSnapshotItem[];
  mergeFreezeIds: string[];
}

export interface JenkinsFreezeRead {
  id: string;
  folderPath: string;
  folderName: string;
  signature: string;
  reason: string;
  killBuilds: boolean;
  status: JenkinsFreezeStatus;
  applied: boolean;
  snapshot: JenkinsFreezeSnapshotItem[];
  createdBy: string;
  createdAt: string;
  resolvedBy: string | null;
  resolvedAt: string | null;
  mergedIntoId: string | null;
}

export interface JenkinsResumeItem {
  path: string;
  name: string;
  fullName: string;
  scheduled: boolean;
  state: JenkinsResumeItemState;
  reason: string | null;
}

export interface JenkinsResumeRunCreateRequest {
  freezeId: string;
  restartPipelines: boolean;
  folderPath?: string;
}

export interface JenkinsResumeRunRead {
  id: string;
  freezeId: string;
  restartPipelines: boolean;
  signature: string;
  status: JenkinsResumeRunStatus;
  total: number;
  startedCount: number;
  skippedCount: number;
  errorCount: number;
  currentPath: string | null;
  currentName: string | null;
  items: JenkinsResumeItem[];
  createdBy: string;
  createdAt: string;
  cancelledBy: string | null;
  finishedAt: string | null;
  stale: boolean;
}

export interface JenkinsScopeResponse {
  signature: string;
  rootGroups: JenkinsRootGroup[];
  rootFolders: string[];
  treeDepth: number;
  historyLimit: number;
}

export interface JenkinsTreeCacheRead {
  roots: JenkinsNode[];
  signature: string;
  fetchedAt: string | null;
  stale: boolean;
  refreshLease: string | null;
}

export interface JenkinsTreeCachePut {
  signature: string;
  roots: JenkinsNode[];
  refreshLease: string | null;
}

export interface JenkinsBuildsCacheRead {
  builds: JenkinsBuild[];
  signature: string;
  path: string;
  fetchedAt: string | null;
  stale: boolean;
  refreshLease: string | null;
}

export interface JenkinsBuildsCachePut {
  signature: string;
  path: string;
  builds: JenkinsBuild[];
  refreshLease: string | null;
}

export interface JobLogEvent {
  type: "line";
  line: string;
}

export interface JobTerminalEvent {
  type: "terminal";
  status: JobStatus;
  exitCode: number | null;
}

export interface JobLogStreamMessage {
  event: Extract<JobStreamEvent, "log">;
  data: JobLogEvent;
}

export interface JobTerminalStreamMessage {
  event: Extract<JobStreamEvent, "terminal">;
  data: JobTerminalEvent;
}

export type JobStreamMessage = JobLogStreamMessage | JobTerminalStreamMessage;

export interface NamespaceLogsState {
  deploy: string;
  exitCode: number | null;
  lines: string[];
  status: NamespaceLogStatus;
  streamError: string | null;
}

export interface NamespaceListEntry {
  name: string;
  statusLabel: string;
  origin: NamespaceOrigin;
  createdAt?: string | null;
  hasLocalOverlay?: boolean;
}

export interface OperationRecipe {
  product?: Product | null;
  services: string[];
  images: Record<string, string>;
  suites: string[];
  flags: Record<string, unknown>;
}

export interface OperationSummary {
  id: string;
  user_id: number;
  type: OperationType;
  ns: string | null;
  recipe: OperationRecipe;
  status: OperationStatus;
  started_at: string;
  finished_at: string | null;
  exit_code: number | null;
  agent_host: string | null;
  agent_version: string | null;
  stagings_sha: string | null;
  created_at: string;
}

export interface OperationRead extends OperationSummary {
  log: string | null;
}

export interface OperationReplay {
  id: string;
  type: OperationType;
  ns: string | null;
  recipe: OperationRecipe;
}

export interface OperationListResponse {
  items: OperationSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface WorkspaceTabDefinition {
  id: TabId;
  pluginId: PluginId;
  title: string;
  contentType: ContentType;
  viewKey?: ViewKey;
  iframeSrc?: string;
  html?: string;
  closeable: boolean;
  adminOnly?: boolean;
}
