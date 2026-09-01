export type Unmount = () => void;

export interface ThemeTokens {
  colorScheme: string;
  primaryColor: string;
  background: string;
  surface: string;
  text: string;
  dimmed: string;
  border: string;
  radius: string;
  spacing: string;
  fontFamily: string;
}

export interface HostApi {
  contractVersion: number;
  theme: {
    getTokens(): ThemeTokens;
    subscribe(cb: (tokens: ThemeTokens) => void): Unmount;
  };
  view: {
    setTitle(title: string): void;
    setBusy(busy: boolean): void;
    requestResize(px: number): void;
  };
  nav: {
    openTab?(tabId: string): void;
  };
}

export interface AgentAccess {
  baseUrl: string;
  fetch(path: string, init?: RequestInit): Promise<Response>;
}

export interface MountContext {
  container: HTMLElement;
  viewKey: string;
  host: HostApi;
  agent: AgentAccess;
  agentBaseUrl?: string;
}

export const PluginKind = {
  SYSTEM: "system",
  OPTIONAL: "optional",
} as const;

export type PluginKind = (typeof PluginKind)[keyof typeof PluginKind];

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

export interface PluginTabMetadata {
  id: string;
  title: string;
  viewKey: string;
  adminOnly?: boolean;
}

export interface PluginManifestMetadata {
  id: string;
  label: string;
  icon: string;
  route: string;
  order: number;
  kind: PluginKind;
  origin: PluginOrigin;
  contractVersion: number;
  navSection?: NavSection;
  adminOnly?: boolean;
  tabs: PluginTabMetadata[];
  requiresAgent?: boolean;
}

export interface LocalPluginTabMetadata {
  id: string;
  title: string;
  viewKey: string;
}

export interface LocalPluginManifestMetadata {
  id: string;
  label: string;
  icon: string;
  route: string;
  order: number;
  contractVersion: number;
  requiresAgent: boolean;
  entry: string;
  navSection?: NavSection;
  tabs: LocalPluginTabMetadata[];
}

export interface LocalPluginRead extends LocalPluginManifestMetadata {
  entryUrl: string;
}

export interface LocalPluginWarning {
  dir: string;
  error: string;
}

export interface LocalPluginsResponse {
  plugins: LocalPluginRead[];
  warnings: LocalPluginWarning[];
}

export interface LocalPluginModule {
  contractVersion: number;
  mount(viewKey: string, ctx: MountContext): Unmount;
}
