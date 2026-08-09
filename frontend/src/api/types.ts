import type { PreflightKey, SectionKey, TabId, ViewKey, ContentType } from "@/constants";

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

export interface OperationRecipe {
  product?: string | null;
  services: string[];
  images: Record<string, string>;
  suites: string[];
  flags: Record<string, unknown>;
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
