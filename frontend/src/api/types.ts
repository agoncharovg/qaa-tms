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
  role_id?: number | null;
  group_id?: number | null;
  role?: { id: number; key: string | null; display_name: string } | null;
  group?: { id: number; key: string | null; display_name: string } | null;
  effective_permissions?: string[];
  created_at: string;
  updated_at: string;
}

export interface MeRead extends User {
  role: { id: number; key: string | null; display_name: string } | null;
  group: { id: number; key: string | null; display_name: string } | null;
  effective_permissions: string[];
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
}

export interface ServerSettingsUpdateRequest {
  qaa_generator_base_url?: string;
  qaa_generator_superuser_token?: string;
}

export interface AgentPingResponse {
  app: string;
  version: string;
  stagingsInstalled: boolean;
  stagingsSha: string | null;
  selfUpdateSupported?: boolean;
  os: string;
}

export interface AgentManifest {
  version: string;
  minSupported: string;
  downloadUrl: string;
  sha256: string;
  os: string | null;
}

export interface AgentUpdateAccepted {
  status: "accepted";
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

export interface JenkinsAllureSkipCandidatesRequest {
  reportUrls: string[];
  product: string | null;
}

export interface JenkinsAllureSkipCandidate {
  full_name: string;
  name: string;
  product: string | null;
}

export interface JenkinsAllureSkipCandidatesError {
  report_url: string;
  message: string;
}

export interface JenkinsAllureSkipCandidatesResponse {
  candidates: JenkinsAllureSkipCandidate[];
  errors: JenkinsAllureSkipCandidatesError[];
}

export interface NotebookBookmarkNode {
  name: string;
  noteCount: number;
  flags: Record<string, unknown>;
  children: NotebookBookmarkNode[];
}

export interface NotebookContentsResponse {
  bookmarks: NotebookBookmarkNode[];
}

export interface NotebookNoteSummary {
  name: string;
  previewLines: string[];
  flags: Record<string, unknown>;
}

export interface NotebookNotesResponse {
  bookmark: string;
  notes: NotebookNoteSummary[];
}

export interface NotebookNoteReadResponse {
  bookmark: string;
  name: string;
  text: string;
  previewLines: string[];
  flags: Record<string, unknown>;
}

export interface NotebookReminder {
  bookmark: string;
  name: string;
  remindAt: string;
  previewLines: string[];
}

export interface NotebookRemindersResponse {
  reminders: NotebookReminder[];
}

export interface NotebookSearchMatch {
  bookmark: string;
  name: string;
  previewLines: string[];
}

export interface NotebookSearchResponse {
  query: string;
  matches: NotebookSearchMatch[];
}

export type RequestsMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

export type RequestsBodyMode = "none" | "json" | "raw" | "form";

export type RequestsCredentialType =
  | "bearer"
  | "api_key_permanent"
  | "login_password"
  | "client_admin";

export interface RequestsFolderNode {
  name: string;
  itemCount: number;
  flags: Record<string, unknown>;
  children: RequestsFolderNode[];
}

export interface RequestsTreeResponse {
  folders: RequestsFolderNode[];
}

export interface RequestsHeaderField {
  name: string;
  value: string;
  enabled: boolean;
}

export interface RequestsHeaderValue {
  name: string;
  value: string;
}

export interface RequestsQueryParam {
  name: string;
  value: string;
  enabled: boolean;
}

export interface RequestsRequestBody {
  mode: RequestsBodyMode;
  content: string;
}

export interface RequestsItemInput {
  folder: string;
  name?: string;
  method: RequestsMethod;
  url: string;
  headers: RequestsHeaderField[];
  queryParams: RequestsQueryParam[];
  body: RequestsRequestBody;
  credentialId: string | null;
}

export interface RequestsItemUpdateInput {
  folder: string;
  method?: RequestsMethod;
  url?: string;
  headers?: RequestsHeaderField[];
  queryParams?: RequestsQueryParam[];
  body?: RequestsRequestBody;
  credentialId?: string | null;
}

export interface RequestsItemSummary {
  name: string;
  method: RequestsMethod;
  url: string;
  credentialId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RequestsItemsResponse {
  folder: string;
  items: RequestsItemSummary[];
}

export interface RequestsItemReadResponse {
  folder: string;
  name: string;
  method: RequestsMethod;
  url: string;
  headers: RequestsHeaderField[];
  queryParams: RequestsQueryParam[];
  body: RequestsRequestBody;
  credentialId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RequestsRequestSummary {
  method: RequestsMethod;
  url: string;
  headers: RequestsHeaderValue[];
  queryParams: RequestsHeaderValue[];
}

export interface RequestsExecuteResponse {
  statusCode: number | null;
  reasonPhrase: string | null;
  elapsedMs: number | null;
  sizeBytes: number;
  headers: RequestsHeaderValue[];
  bodyText: string;
  truncated: boolean;
  error: string | null;
  requestSummary: RequestsRequestSummary;
}

export interface RequestsBearerCredentialPublic {
  id: string;
  name: string;
  type: "bearer";
  createdAt: string;
  updatedAt: string;
  config: {
    hasToken: boolean;
  };
}

export interface RequestsApiKeyPermanentCredentialPublic {
  id: string;
  name: string;
  type: "api_key_permanent";
  createdAt: string;
  updatedAt: string;
  config: {
    verifyUrl: string;
    scheme: string;
    hasPermanentToken: boolean;
  };
}

export interface RequestsLoginPasswordCredentialPublic {
  id: string;
  name: string;
  type: "login_password";
  createdAt: string;
  updatedAt: string;
  config: {
    loginUrl: string;
    username: string;
    referer: string;
    hasPassword: boolean;
  };
}

export interface RequestsClientAdminCredentialPublic {
  id: string;
  name: string;
  type: "client_admin";
  createdAt: string;
  updatedAt: string;
  config: {
    adminCredentialId: string;
    adminTokenUrl: string;
    clientId: number;
    issueByCurrentUser: boolean;
  };
}

export type RequestsCredentialPublic =
  | RequestsBearerCredentialPublic
  | RequestsApiKeyPermanentCredentialPublic
  | RequestsLoginPasswordCredentialPublic
  | RequestsClientAdminCredentialPublic;

export interface RequestsCredentialsListResponse {
  credentials: RequestsCredentialPublic[];
}

export interface RequestsCredentialResolveResponse {
  ok: boolean;
  expiresAt: string | null;
  error: string | null;
}

export interface RequestsHistoryResponseSummary {
  statusCode: number | null;
  elapsedMs: number | null;
  sizeBytes: number;
  error: string | null;
}

export interface RequestsHistoryEntry {
  id: string;
  at: string;
  requestSummary: RequestsRequestSummary;
  responseSummary: RequestsHistoryResponseSummary;
}

export interface RequestsHistoryListResponse {
  entries: RequestsHistoryEntry[];
}

export interface NotificatorChannel {
  id: number;
  channel_id: string;
  description: string | null;
}

export interface NotificatorChoice {
  code: string;
  label: string;
}

export interface NotificatorChoices {
  notification_types: NotificatorChoice[];
}

export interface NotificatorNamedEntity {
  id: number;
  name: string;
}

export interface NotificatorRecurrentFailRef {
  id: number;
  description: string | null;
}

export interface NotificatorUser {
  id: number;
  sam_account_name?: string | null;
  user_principal_name?: string | null;
  username?: string | null;
  display_name?: string | null;
}

export interface NotificatorNotificationConfig {
  id: number;
  product_team_id: number;
  product_team: string;
  notification_type: string;
  notification_type_label: string;
  enabled: boolean;
  channels: NotificatorChannel[];
  users: NotificatorUser[];
}

export interface NotificatorNotificationConfigInput {
  product_team: number;
  notification_type: string;
  enabled: boolean;
  channels: number[];
  users: number[];
}

export interface NotificatorProductTeam {
  id: number;
  name: string;
  email: string;
  pagerduty_ep: string | null;
  product: NotificatorNamedEntity | null;
  manager: NotificatorUser | null;
  members: NotificatorUser[];
  notification_configs_count: number;
  sub_products_count: number;
}

export interface NotificatorProduct {
  id: number;
  name: string;
  description: string | null;
  teams_count: number;
  sub_products_count: number;
  qaa_members_count: number;
}

export interface NotificatorProductInput {
  name: string;
  description: string | null;
}

export interface NotificatorSubProduct {
  id: number;
  name: string;
  product: NotificatorNamedEntity | null;
  team: NotificatorNamedEntity | null;
}

export interface NotificatorSubProductInput {
  name: string;
  product: number | null;
  team: number | null;
}

export interface NotificatorSlackChannel {
  id: number;
  channel_id: string;
  description: string | null;
}

export interface NotificatorSlackChannelInput {
  channel_id: string;
  description: string | null;
}

export interface NotificatorFullUser {
  id: number;
  username: string;
  user_principal_name: string | null;
  sam_account_name: string | null;
  slack_id: string | null;
  department: string | null;
  company: string | null;
  title: string | null;
  notifications_enabled: boolean;
  teams: NotificatorNamedEntity[];
  events_subscriptions: NotificatorNamedEntity[];
  manager: NotificatorUser | null;
}

export interface NotificatorQaaMember {
  id: number;
  product: NotificatorNamedEntity;
  user: NotificatorUser;
}

export interface NotificatorFailureMentionRule {
  id: number;
  pattern: string;
  match_target: string;
  environment: string;
  message_template: string;
  enabled: boolean;
  users: NotificatorUser[];
}

export interface NotificatorEvent {
  id: number;
  name: string;
  description: string;
  enabled: boolean;
}

export interface NotificatorMuteStatusSummary {
  id: number;
  created_at: string | null;
  expires_at: string | null;
}

export interface NotificatorRecurrentFail {
  id: number;
  description: string;
  time_threshold: number;
  number_of_fails: number;
  environment: string;
  is_enabled: boolean;
  channels: NotificatorChannel[];
  slack_mention: NotificatorUser[];
  fail_reasons: NotificatorNamedEntity | null;
  product: NotificatorNamedEntity | null;
  mute_statuses: NotificatorMuteStatusSummary[];
}

export interface NotificatorFailReason {
  id: number;
  name: string;
}

export interface NotificatorMuteStatus {
  id: number;
  created_at: string | null;
  expires_at: string | null;
  configuration: NotificatorRecurrentFailRef | null;
}

export interface NotificatorHistoryItem {
  id?: number | null;
  author: string;
  when_muted: string | null;
  muted_until: string | null;
  config_id: string;
}


export interface LeonidSharedResourceLimitType {
  id: number;
  name: string;
}

export interface LeonidSharedResourceLimit {
  id: number;
  resource_name: string;
  limit_type: number;
  limit_value: number;
  reset_date: string | null;
}

export interface LeonidSharedResourceLimitInput {
  resource_name: string;
  limit_type: number;
  limit_value: number;
  reset_date: string | null;
}

export interface LeonidSharedResource {
  id: number;
  resource_limit: number;
  value: string;
  count: number;
  enabled: boolean;
}

export interface LeonidSkippedTest {
  full_name: string;
}

export interface LeonidSkippedSuite {
  id: number;
  author: string;
  reason: string;
  product: string;
  created_at: string;
  expires_at: string;
  cancelled_at: string | null;
  cancelled_by: string | null;
  status: "active" | "expired" | "cancelled";
  tests: LeonidSkippedTest[];
}

export interface LeonidSkippedSuiteInput {
  reason: string;
  product: string;
  expires_at: string;
  tests: LeonidSkippedTest[];
}

export interface LeonidSharedResourceInput {
  resource_limit: number;
  value: string;
  count: number;
  enabled: boolean;
}

export interface LeonidObjectDefinition {
  id: number;
  object_name: string;
  comment: string | null;
  enabled: boolean;
}

export interface LeonidObjectDefinitionInput {
  object_name: string;
  comment: string | null;
  enabled: boolean;
}

export interface LeonidObjectValue {
  id: number;
  object: number;
  environment: number;
  value: string;
  comment: string | null;
  enabled: boolean;
}

export interface LeonidObjectValueInput {
  object: number;
  environment: number;
  value: string;
  comment: string | null;
  enabled: boolean;
}

export interface LeonidPipelineParam {
  id: number;
  name: string;
  job_path: string;
  // Leonid stores params as an arbitrary JSON value (list or object).
  params: unknown;
}

export interface LeonidPipelineParamInput {
  name: string;
  job_path: string;
  params: unknown;
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

export interface KubeExecRequest {
  namespace: string;
  context?: string | null;
  container?: string | null;
  command: string;
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
  image?: string;
  mark?: string;
  marks?: string;
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
  // Lifecycle events (RUN_QUEUED, RUN_STARTING, RUN_STARTED, ...) carry no
  // message — the external qaa-generator service sends null for them.
  message: string | null;
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

export interface JenkinsFolderResponse {
  roots: JenkinsNode[];
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

export interface JenkinsFolderCacheRead {
  roots: JenkinsNode[];
  signature: string;
  path: string;
  fetchedAt: string | null;
  stale: boolean;
  refreshLease: string | null;
}

export interface JenkinsFolderCachePut {
  signature: string;
  path: string;
  roots: JenkinsNode[];
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
export interface SecurityPermission {
  id: number;
  key: string;
  display_name: string;
  description: string | null;
  system: boolean;
}

export interface SecurityPermissionListResponse {
  items: SecurityPermission[];
  total: number;
}

export interface SecurityRole {
  id: number;
  key: string | null;
  display_name: string;
  description: string | null;
  system: boolean;
  mutable: boolean;
  permissions: string[];
}

export interface SecurityRoleListResponse {
  items: SecurityRole[];
  total: number;
}

export interface SecurityGroupMember {
  id: number;
  username: string;
  display_name: string;
}

export interface SecurityGroup {
  id: number;
  key: string | null;
  display_name: string;
  description: string | null;
  system: boolean;
  members: SecurityGroupMember[];
  member_count: number;
  permissions: string[];
  role_ids: number[];
}

export interface SecurityGroupListResponse {
  items: SecurityGroup[];
  total: number;
}

export interface UserPermissionsResponse {
  inherited: string[];
  extra: string[];
  effective: string[];
}

export interface SecurityEventRead {
  id: number;
  event_type: string;
  target_type: string;
  target_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
  actor_user: { id: number; username: string; display_name: string } | null;
}

export interface SecurityAuditListResponse {
  items: SecurityEventRead[];
  total: number;
}

export interface AuthzCheckResult {
  permission: string;
  allowed: boolean;
}

export interface AuthzCheckResponse {
  results: AuthzCheckResult[];
}
