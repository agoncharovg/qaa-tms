import type { User, WorkspaceTabDefinition } from "@/api/types";
import {
  PluginId,
  StorageKey,
  type PluginId as PluginIdType,
  type TabId as TabIdType,
} from "@/constants";
import {
  defaultTabIdByPlugin,
  enabledOptionalPluginIdSet,
  PLUGIN_IDS,
  pluginById,
  pluginVisible,
  tabCatalog,
  tabDefinitions,
  visibleTabs,
} from "@/plugins/catalog";
import {
  closeTabInPluginState,
  createBootstrapWorkspaceTabsState,
  createEmptyPluginState,
  openTabInPluginState,
  readStoredSidebarCollapsed,
  switchTabInPluginState,
  type PluginTabState,
  type TabsByPlugin,
  type WorkspaceTabsState,
  useUiStore,
  writeStoredUiState,
} from "@/store/uiStoreCore";

type PluginVisibilityUser = Pick<User, "enabled_plugins" | "is_admin">;

const DEFAULT_VISIBILITY_USER: PluginVisibilityUser = {
  enabled_plugins: [PluginId.STAGINGS, PluginId.KUBER, PluginId.QAA_GENERATOR, PluginId.JENKINS],
  is_admin: false,
};

interface PersistedUiState extends WorkspaceTabsState {
  tabsByPlugin: TabsByPlugin;
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function resolveVisibilityUser(user: PluginVisibilityUser | null | undefined): PluginVisibilityUser {
  if (!user) {
    return DEFAULT_VISIBILITY_USER;
  }

  return {
    enabled_plugins: user.enabled_plugins,
    is_admin: user.is_admin,
  };
}

function createDefaultStateForPlugin(
  pluginId: PluginIdType,
  user: PluginVisibilityUser | null | undefined
): PluginTabState {
  const resolvedUser = resolveVisibilityUser(user);
  const plugin = pluginById(pluginId);
  if (!plugin) {
    return createEmptyPluginState();
  }

  const enabledOptionalIds = enabledOptionalPluginIdSet(resolvedUser.enabled_plugins);
  if (!pluginVisible(plugin, resolvedUser, enabledOptionalIds)) {
    return createEmptyPluginState();
  }

  return createEmptyPluginState();
}

function sanitizePluginState(
  value: PluginTabState | undefined,
  allowedTabIds: ReadonlySet<TabIdType>
): PluginTabState {
  const tabIds = (value?.tabIds ?? []).filter((tabId): tabId is TabIdType => allowedTabIds.has(tabId));
  const activeTabId =
    value?.activeTabId && tabIds.includes(value.activeTabId) ? value.activeTabId : tabIds[0] ?? null;

  return {
    activeTabId,
    tabIds,
  };
}

export function createDefaultTabsByPlugin(
  user: PluginVisibilityUser | null | undefined = DEFAULT_VISIBILITY_USER
): TabsByPlugin {
  return Object.fromEntries(
    PLUGIN_IDS.map((pluginId) => [pluginId, createDefaultStateForPlugin(pluginId, user)])
  ) as TabsByPlugin;
}

export function sanitizePluginTabs(
  value: PluginTabState | undefined,
  pluginId: PluginIdType,
  user: PluginVisibilityUser | null | undefined = DEFAULT_VISIBILITY_USER
): PluginTabState {
  const resolvedUser = resolveVisibilityUser(user);
  const plugin = pluginById(pluginId);
  if (!plugin) {
    return createEmptyPluginState();
  }

  const enabledOptionalIds = enabledOptionalPluginIdSet(resolvedUser.enabled_plugins);
  if (!pluginVisible(plugin, resolvedUser, enabledOptionalIds)) {
    return createEmptyPluginState();
  }

  return sanitizePluginState(value, new Set(visibleTabs(plugin, resolvedUser).map((tab) => tab.id)));
}

function sanitizeTabsByPlugin(
  value: Partial<TabsByPlugin> | undefined,
  user: PluginVisibilityUser | null | undefined = DEFAULT_VISIBILITY_USER
): TabsByPlugin {
  return Object.fromEntries(
    PLUGIN_IDS.map((pluginId) => [pluginId, sanitizePluginTabs(value?.[pluginId], pluginId, user)])
  ) as TabsByPlugin;
}

function sanitizePluginTabsStructurally(
  value: PluginTabState | undefined,
  pluginId: PluginIdType
): PluginTabState {
  const plugin = pluginById(pluginId);
  if (!plugin) {
    return createEmptyPluginState();
  }

  return sanitizePluginState(value, new Set(tabCatalog[pluginId]));
}

function sanitizeTabsByPluginStructurally(value: Partial<TabsByPlugin> | undefined): TabsByPlugin {
  return Object.fromEntries(
    PLUGIN_IDS.map((pluginId) => [pluginId, sanitizePluginTabsStructurally(value?.[pluginId], pluginId)])
  ) as TabsByPlugin;
}

function sanitizeWorkspaceTabsState(
  value: Partial<WorkspaceTabsState> | undefined,
  tabsByPlugin: TabsByPlugin
): WorkspaceTabsState {
  const allowedTabIds = new Set(
    Object.values(tabsByPlugin).flatMap((pluginState) => pluginState.tabIds)
  );
  const workspaceTabIds = (value?.workspaceTabIds ?? []).filter(
    (tabId, index, source): tabId is TabIdType =>
      allowedTabIds.has(tabId) && source.indexOf(tabId) === index
  );
  const activeWorkspaceTabId =
    value?.activeWorkspaceTabId && workspaceTabIds.includes(value.activeWorkspaceTabId)
      ? value.activeWorkspaceTabId
      : workspaceTabIds[0] ?? null;

  if (!activeWorkspaceTabId) {
    return {
      activeWorkspaceTabId: null,
      workspaceTabIds,
    };
  }

  const definition = tabDefinitions[activeWorkspaceTabId];
  if (!definition) {
    return {
      activeWorkspaceTabId: null,
      workspaceTabIds: workspaceTabIds.filter((tabId) => tabId !== activeWorkspaceTabId),
    };
  }

  const pluginState = tabsByPlugin[definition.pluginId];
  if (!pluginState.tabIds.includes(activeWorkspaceTabId)) {
    return {
      activeWorkspaceTabId: null,
      workspaceTabIds: workspaceTabIds.filter((tabId) => tabId !== activeWorkspaceTabId),
    };
  }

  return {
    activeWorkspaceTabId,
    workspaceTabIds,
  };
}

function syncActiveWorkspaceTab(
  tabsByPlugin: TabsByPlugin,
  workspaceTabsState: WorkspaceTabsState
): TabsByPlugin {
  if (!workspaceTabsState.activeWorkspaceTabId) {
    return tabsByPlugin;
  }

  const definition = tabDefinitions[workspaceTabsState.activeWorkspaceTabId];
  if (!definition) {
    return tabsByPlugin;
  }

  const pluginState = tabsByPlugin[definition.pluginId];
  if (!pluginState.tabIds.includes(workspaceTabsState.activeWorkspaceTabId)) {
    return tabsByPlugin;
  }

  return {
    ...tabsByPlugin,
    [definition.pluginId]: switchTabInPluginState(pluginState, workspaceTabsState.activeWorkspaceTabId),
  };
}

function createEmptyPersistedUiState(
  user: PluginVisibilityUser | null | undefined = DEFAULT_VISIBILITY_USER
): PersistedUiState {
  return {
    ...createBootstrapWorkspaceTabsState(),
    tabsByPlugin: createDefaultTabsByPlugin(user),
  };
}

function readRawStoredUiState(): Partial<PersistedUiState> | null {
  if (!isBrowser()) {
    return null;
  }

  const rawValue = window.localStorage.getItem(StorageKey.TABS);
  if (!rawValue) {
    return null;
  }

  try {
    return JSON.parse(rawValue) as Partial<PersistedUiState> & Partial<TabsByPlugin>;
  } catch {
    return null;
  }
}

export function readStoredUiState(
  user: PluginVisibilityUser | null | undefined = DEFAULT_VISIBILITY_USER
): PersistedUiState {
  const parsed = readRawStoredUiState();
  if (!parsed || !("tabsByPlugin" in parsed)) {
    return createEmptyPersistedUiState(user);
  }

  const sanitizedTabsByPlugin = sanitizeTabsByPlugin(parsed.tabsByPlugin, user);
  const sanitizedWorkspaceTabsState = sanitizeWorkspaceTabsState(parsed, sanitizedTabsByPlugin);

  return {
    ...sanitizedWorkspaceTabsState,
    tabsByPlugin: syncActiveWorkspaceTab(sanitizedTabsByPlugin, sanitizedWorkspaceTabsState),
  };
}

function readStoredUiStateStructurally(): PersistedUiState {
  const parsed = readRawStoredUiState();
  if (!parsed || !("tabsByPlugin" in parsed)) {
    return createEmptyPersistedUiState();
  }

  const sanitizedTabsByPlugin = sanitizeTabsByPluginStructurally(parsed.tabsByPlugin);
  const sanitizedWorkspaceTabsState = sanitizeWorkspaceTabsState(parsed, sanitizedTabsByPlugin);

  return {
    ...sanitizedWorkspaceTabsState,
    tabsByPlugin: syncActiveWorkspaceTab(sanitizedTabsByPlugin, sanitizedWorkspaceTabsState),
  };
}

export function readStoredTabsByPlugin(
  user: PluginVisibilityUser | null | undefined = DEFAULT_VISIBILITY_USER
): TabsByPlugin {
  return readStoredUiState(user).tabsByPlugin;
}

export function readStoredWorkspaceTabsState(
  user: PluginVisibilityUser | null | undefined = DEFAULT_VISIBILITY_USER
): WorkspaceTabsState {
  const { activeWorkspaceTabId, workspaceTabIds } = readStoredUiState(user);
  return {
    activeWorkspaceTabId,
    workspaceTabIds,
  };
}

export function restoreUiStoreFromStorage(): void {
  useUiStore.setState({
    sidebarCollapsed: readStoredSidebarCollapsed(),
    ...readStoredUiStateStructurally(),
  });
}

restoreUiStoreFromStorage();

export function getTabsForPlugin(
  pluginId: PluginIdType,
  tabsByPlugin: TabsByPlugin
): WorkspaceTabDefinition[] {
  return tabsByPlugin[pluginId].tabIds.map((tabId) => tabDefinitions[tabId]);
}

export function getOpenWorkspaceTabs(workspaceTabIds: TabIdType[]): WorkspaceTabDefinition[] {
  return workspaceTabIds.map((tabId) => tabDefinitions[tabId]).filter(Boolean);
}

export function syncTabsForUser(user: PluginVisibilityUser | null | undefined): void {
  if (!user) {
    return;
  }

  const currentState = useUiStore.getState();
  const nextTabsByPlugin = sanitizeTabsByPlugin(currentState.tabsByPlugin, user);
  const nextWorkspaceTabsState = sanitizeWorkspaceTabsState(currentState, nextTabsByPlugin);
  const syncedTabsByPlugin = syncActiveWorkspaceTab(nextTabsByPlugin, nextWorkspaceTabsState);
  writeStoredUiState({
    activeWorkspaceTabId: nextWorkspaceTabsState.activeWorkspaceTabId,
    tabsByPlugin: syncedTabsByPlugin,
    workspaceTabIds: nextWorkspaceTabsState.workspaceTabIds,
  });
  useUiStore.setState({
    activeWorkspaceTabId: nextWorkspaceTabsState.activeWorkspaceTabId,
    tabsByPlugin: syncedTabsByPlugin,
    workspaceTabIds: nextWorkspaceTabsState.workspaceTabIds,
  });
}

export function ensureDefaultTabForPlugin(pluginId: PluginIdType): void {
  const defaultTabId = defaultTabIdByPlugin[pluginId];
  if (!defaultTabId) {
    return;
  }

  const pluginState = useUiStore.getState().tabsByPlugin[pluginId];
  if (pluginState.tabIds.length > 0) {
    return;
  }

  useUiStore.getState().openTab(pluginId, defaultTabId);
}

export function activatePluginWorkspaceTab(pluginId: PluginIdType): TabIdType | null {
  const pluginState = useUiStore.getState().tabsByPlugin[pluginId];
  const tabId = pluginState.activeTabId ?? pluginState.tabIds[0] ?? defaultTabIdByPlugin[pluginId] ?? null;
  if (!tabId) {
    return null;
  }

  if (pluginState.tabIds.includes(tabId)) {
    useUiStore.getState().switchTab(pluginId, tabId);
  } else {
    useUiStore.getState().openTab(pluginId, tabId);
  }

  return tabId;
}

export function resetUiStoreState(
  user: PluginVisibilityUser | null | undefined = DEFAULT_VISIBILITY_USER
): void {
  if (isBrowser()) {
    window.localStorage.removeItem(StorageKey.SIDEBAR_COLLAPSED);
    window.localStorage.removeItem(StorageKey.TABS);
  }

  useUiStore.setState({
    activeWorkspaceTabId: null,
    sidebarCollapsed: false,
    tabsByPlugin: createDefaultTabsByPlugin(user),
    workspaceTabIds: [],
  });
}

export { tabCatalog as PLUGIN_TAB_CATALOG, tabDefinitions as TAB_DEFINITIONS };
export {
  closeTabInPluginState,
  createEmptyPluginState,
  openTabInPluginState,
  readStoredSidebarCollapsed,
  switchTabInPluginState,
  useUiStore,
};
export type { PluginTabState, TabsByPlugin, WorkspaceTabsState };
