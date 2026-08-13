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

  const allowedTabs = new Set(visibleTabs(plugin, resolvedUser).map((tab) => tab.id));
  const tabIds = (value?.tabIds ?? []).filter((tabId): tabId is TabIdType => allowedTabs.has(tabId));
  const activeTabId =
    value?.activeTabId && tabIds.includes(value.activeTabId) ? value.activeTabId : tabIds[0] ?? null;

  return {
    activeTabId,
    tabIds,
  };
}

function sanitizeTabsByPlugin(
  value: Partial<TabsByPlugin> | undefined,
  user: PluginVisibilityUser | null | undefined = DEFAULT_VISIBILITY_USER
): TabsByPlugin {
  return Object.fromEntries(
    PLUGIN_IDS.map((pluginId) => [pluginId, sanitizePluginTabs(value?.[pluginId], pluginId, user)])
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

export function readStoredUiState(
  user: PluginVisibilityUser | null | undefined = DEFAULT_VISIBILITY_USER
): PersistedUiState {
  if (!isBrowser()) {
    return {
      ...createBootstrapWorkspaceTabsState(),
      tabsByPlugin: createDefaultTabsByPlugin(user),
    };
  }

  const rawValue = window.localStorage.getItem(StorageKey.TABS);
  if (!rawValue) {
    return {
      ...createBootstrapWorkspaceTabsState(),
      tabsByPlugin: createDefaultTabsByPlugin(user),
    };
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<PersistedUiState> & Partial<TabsByPlugin>;
    if (!("tabsByPlugin" in parsed)) {
      return {
        ...createBootstrapWorkspaceTabsState(),
        tabsByPlugin: createDefaultTabsByPlugin(user),
      };
    }

    const sanitizedTabsByPlugin = sanitizeTabsByPlugin(parsed.tabsByPlugin, user);
    const sanitizedWorkspaceTabsState = sanitizeWorkspaceTabsState(parsed, sanitizedTabsByPlugin);

    return {
      ...sanitizedWorkspaceTabsState,
      tabsByPlugin: syncActiveWorkspaceTab(sanitizedTabsByPlugin, sanitizedWorkspaceTabsState),
    };
  } catch {
    return {
      ...createBootstrapWorkspaceTabsState(),
      tabsByPlugin: createDefaultTabsByPlugin(user),
    };
  }
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

useUiStore.setState({
  sidebarCollapsed: readStoredSidebarCollapsed(),
  ...readStoredUiState(),
});

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
