import { useEffect } from "react";

import type {
  LocalPluginRead,
  LocalPluginsResponse,
  LocalPluginTabRead,
  LocalPluginWarning,
} from "@/api/types";
import { buildAgentBaseUrl, createAgentHeaders } from "@/api/agentClient";
import {
  AgentPath,
  CompanionStatusKind,
  HttpMethod,
  NavSection,
  PluginOrigin,
  type IconName,
  type PluginId as PluginIdType,
  type TabId as TabIdType,
  type ViewKey,
} from "@/constants";
import { definePlugin, isSupportedContractVersion } from "@/core/plugins/definePlugin";
import type { MountContext, Unmount } from "@/core/plugins/host";
import { PluginKind, type PluginManifest } from "@/core/plugins/types";
import { useCompanionStatus } from "@/plugins/companion/useCompanionStatus";
import { validatePluginManifests } from "@/plugins/discovery";
import { setLocalPlugins } from "@/plugins/pluginRegistryStore";
import { useAuthStore } from "@/store/authStore";

const COMPANION_AVAILABLE_KINDS: ReadonlySet<string> = new Set([
  CompanionStatusKind.OK,
  CompanionStatusKind.UPDATE_AVAILABLE,
  CompanionStatusKind.UPDATE_REQUIRED,
]);

interface LocalPluginModule {
  contractVersion: number;
  mount(viewKey: string, ctx: MountContext): Unmount;
}

interface LoadLocalPluginsOptions {
  agentBaseUrl: string;
  signal?: AbortSignal;
  token: string;
}

interface LoadLocalPluginModuleOptions {
  agentBaseUrl: string;
  plugin: LocalPluginRead;
  signal?: AbortSignal;
  token: string;
}

interface LocalPluginsLoaderDeps {
  createBlobUrl: (source: string) => string;
  fetchImpl: typeof fetch;
  importBlobUrl: (url: string) => Promise<unknown>;
  importModule: (options: LoadLocalPluginModuleOptions) => Promise<unknown>;
  revokeBlobUrl: (url: string) => void;
}

type LocalPluginsLoaderOverrides = Partial<LocalPluginsLoaderDeps>;

interface DefaultImportModuleDeps {
  createBlobUrl: LocalPluginsLoaderDeps["createBlobUrl"];
  fetchImpl: LocalPluginsLoaderDeps["fetchImpl"];
  importBlobUrl: LocalPluginsLoaderDeps["importBlobUrl"];
  revokeBlobUrl: LocalPluginsLoaderDeps["revokeBlobUrl"];
}

function defaultImportBlobUrl(url: string): Promise<unknown> {
  return import(/* @vite-ignore */ url);
}

function defaultCreateBlobUrl(source: string): string {
  return URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
}

function defaultRevokeBlobUrl(url: string): void {
  URL.revokeObjectURL(url);
}

async function defaultImportModule(
  { agentBaseUrl, plugin, signal, token }: LoadLocalPluginModuleOptions,
  { createBlobUrl, fetchImpl, importBlobUrl, revokeBlobUrl }: DefaultImportModuleDeps
): Promise<unknown> {
  const entryUrl = new URL(plugin.entryUrl, agentBaseUrl).href;
  const response = await fetchImpl(entryUrl, {
    headers: createAgentHeaders(token),
    signal,
  });

  if (!response.ok) {
    throw new Error(`GET ${entryUrl} failed with status ${String(response.status)}.`);
  }

  // Local plugin entry bundles must be single-file self-contained ESM because blob imports
  // cannot resolve relative or bare specifiers back through the authenticated asset route.
  const source = await response.text();
  const blobUrl = createBlobUrl(source);

  try {
    return await importBlobUrl(blobUrl);
  } finally {
    revokeBlobUrl(blobUrl);
  }
}

function resolveLocalPluginsLoaderDeps(
  overrides: LocalPluginsLoaderOverrides = {}
): LocalPluginsLoaderDeps {
  const fetchImpl = overrides.fetchImpl ?? fetch;
  const createBlobUrl = overrides.createBlobUrl ?? defaultCreateBlobUrl;
  const importBlobUrl = overrides.importBlobUrl ?? defaultImportBlobUrl;
  const revokeBlobUrl = overrides.revokeBlobUrl ?? defaultRevokeBlobUrl;

  return {
    createBlobUrl,
    fetchImpl,
    importBlobUrl,
    importModule:
      overrides.importModule ??
      ((options) =>
        defaultImportModule(options, {
          createBlobUrl,
          fetchImpl,
          importBlobUrl,
          revokeBlobUrl,
        })),
    revokeBlobUrl,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isLocalPluginTabRead(value: unknown): value is LocalPluginTabRead {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.viewKey === "string"
  );
}

function isLocalPluginRead(value: unknown): value is LocalPluginRead {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.label === "string" &&
    typeof value.icon === "string" &&
    typeof value.route === "string" &&
    typeof value.order === "number" &&
    Number.isFinite(value.order) &&
    Number.isInteger(value.contractVersion) &&
    typeof value.requiresAgent === "boolean" &&
    typeof value.entry === "string" &&
    typeof value.entryUrl === "string" &&
    (value.navSection === undefined ||
      value.navSection === NavSection.PRIMARY ||
      value.navSection === NavSection.ACCOUNT) &&
    Array.isArray(value.tabs) &&
    value.tabs.every(isLocalPluginTabRead)
  );
}

function isLocalPluginWarning(value: unknown): value is LocalPluginWarning {
  return isRecord(value) && typeof value.dir === "string" && typeof value.error === "string";
}

function readLocalPluginsResponse(payload: unknown): LocalPluginsResponse {
  if (!isRecord(payload) || !Array.isArray(payload.plugins)) {
    throw new Error("Invalid local-plugins response: missing plugins array.");
  }

  return {
    plugins: payload.plugins.filter(isLocalPluginRead),
    warnings: Array.isArray(payload.warnings) ? payload.warnings.filter(isLocalPluginWarning) : [],
  };
}

function readLocalPluginModule(pluginId: string, importedModule: unknown): LocalPluginModule {
  const candidate = isRecord(importedModule) ? importedModule.default : undefined;
  if (
    !isRecord(candidate) ||
    !Number.isInteger(candidate.contractVersion) ||
    typeof candidate.mount !== "function"
  ) {
    throw new Error(
      `local plugin "${pluginId}" default export must satisfy the LocalPluginModule contract.`
    );
  }

  return candidate as unknown as LocalPluginModule;
}

function buildLocalPluginTab(
  module: LocalPluginModule,
  tab: LocalPluginTabRead
): PluginManifest["tabs"][number] {
  return {
    id: tab.id as TabIdType,
    mount(ctx) {
      return module.mount(tab.viewKey, ctx);
    },
    title: tab.title,
    viewKey: tab.viewKey as ViewKey,
  };
}

function buildLocalPluginManifest(
  plugin: LocalPluginRead,
  module: LocalPluginModule
): PluginManifest {
  if (!isSupportedContractVersion(plugin.contractVersion)) {
    throw new Error(
      `local plugin "${plugin.id}" contractVersion ${String(plugin.contractVersion)} is unsupported.`
    );
  }

  if (!isSupportedContractVersion(module.contractVersion)) {
    throw new Error(
      `local plugin "${plugin.id}" contractVersion ${String(module.contractVersion)} is unsupported.`
    );
  }

  if (plugin.contractVersion !== module.contractVersion) {
    throw new Error(
      `local plugin "${plugin.id}" metadata contractVersion ${String(plugin.contractVersion)} does not match module contractVersion ${String(module.contractVersion)}.`
    );
  }

  return validatePluginManifests([
    definePlugin({
      contractVersion: module.contractVersion,
      icon: plugin.icon as IconName,
      id: plugin.id as PluginIdType,
      kind: PluginKind.OPTIONAL,
      label: plugin.label,
      navSection: plugin.navSection,
      order: plugin.order,
      origin: PluginOrigin.LOCAL,
      requiresAgent: plugin.requiresAgent,
      route: plugin.route,
      tabs: plugin.tabs.map((tab) => buildLocalPluginTab(module, tab)),
    }),
  ])[0];
}

async function fetchLocalPluginsResponse(
  { agentBaseUrl, signal, token }: LoadLocalPluginsOptions,
  fetchImpl: typeof fetch
): Promise<LocalPluginsResponse> {
  const response = await fetchImpl(`${agentBaseUrl}${AgentPath.PLUGINS}`, {
    headers: createAgentHeaders(token),
    method: HttpMethod.GET,
    signal,
  });

  if (!response.ok) {
    throw new Error(`GET ${AgentPath.PLUGINS} failed with status ${String(response.status)}.`);
  }

  return readLocalPluginsResponse(await response.json());
}

async function loadLocalPlugin(
  plugin: LocalPluginRead,
  { agentBaseUrl, signal, token }: LoadLocalPluginsOptions,
  importModule: LocalPluginsLoaderDeps["importModule"]
): Promise<PluginManifest> {
  const importedModule = await importModule({
    agentBaseUrl,
    plugin,
    signal,
    token,
  });
  return buildLocalPluginManifest(plugin, readLocalPluginModule(plugin.id, importedModule));
}

export async function loadLocalPluginsFromAgent(
  options: LoadLocalPluginsOptions,
  deps: LocalPluginsLoaderOverrides = {}
): Promise<PluginManifest[]> {
  const resolvedDeps = resolveLocalPluginsLoaderDeps(deps);
  const response = await fetchLocalPluginsResponse(options, resolvedDeps.fetchImpl);

  for (const warning of response.warnings) {
    console.warn(`Local plugin warning for "${warning.dir}": ${warning.error}`);
  }

  const loadedPlugins = await Promise.all(
    response.plugins.map(async (plugin) => {
      try {
        return await loadLocalPlugin(plugin, options, resolvedDeps.importModule);
      } catch (error) {
        console.warn(
          `Skipping local plugin "${plugin.id}": ${error instanceof Error ? error.message : String(error)}`
        );
        return null;
      }
    })
  );

  return loadedPlugins.filter((plugin): plugin is PluginManifest => plugin !== null);
}

export function useResolvedAgentBaseUrl(enabled = true): string | null {
  const companionStatus = useCompanionStatus({ enabled });
  if (
    companionStatus.port === null ||
    !COMPANION_AVAILABLE_KINDS.has(companionStatus.kind)
  ) {
    return null;
  }

  return buildAgentBaseUrl(companionStatus.port);
}

export function LocalPluginsLifecycle() {
  const currentUser = useAuthStore((state) => state.currentUser);
  const token = useAuthStore((state) => state.token);
  const agentBaseUrl = useResolvedAgentBaseUrl(Boolean(currentUser && token));

  useEffect(() => {
    if (!currentUser || !token || !agentBaseUrl) {
      setLocalPlugins([]);
      return;
    }

    const abortController = new AbortController();

    void loadLocalPluginsFromAgent({
      agentBaseUrl,
      signal: abortController.signal,
      token,
    })
      .then((plugins) => {
        if (!abortController.signal.aborted) {
          setLocalPlugins(plugins);
        }
      })
      .catch((error) => {
        if (abortController.signal.aborted) {
          return;
        }

        console.warn(
          `Failed to load local plugins from ${agentBaseUrl}: ${error instanceof Error ? error.message : String(error)}`
        );
        setLocalPlugins([]);
      });

    return () => {
      abortController.abort();
    };
  }, [agentBaseUrl, currentUser, token]);

  return null;
}
