import type {
  ContentType,
  JobStatus,
  JobStreamEvent,
  NamespaceLogStatus,
  NamespaceOrigin,
  OperationStatus,
  OperationType,
  PreflightKey,
  Product,
  SectionKey,
  TabId,
  ViewKey,
} from "@/constants";

export interface User {
  id: number;
  username: string;
  display_name: string;
  is_admin: boolean;
  auto_login: boolean;
  created_at: string;
  updated_at: string;
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
  section: SectionKey;
  title: string;
  contentType: ContentType;
  viewKey?: ViewKey;
  iframeSrc?: string;
  html?: string;
  closeable: boolean;
}
