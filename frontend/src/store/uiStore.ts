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
  openTabInPluginState,
  readStoredSidebarCollapsed,
  switchTabInPluginState,
  type PluginTabState,
  type TabsByPlugin,
  useUiStore,
} from "@/store/uiStoreCore";

type PluginVisibilityUser = Pick<User, "enabled_plugins" | "is_admin">;

const DEFAULT_VISIBILITY_USER: PluginVisibilityUser = {
  enabled_plugins: [PluginId.STAGINGS, PluginId.KUBER, PluginId.QAA_GENERATOR, PluginId.JENKINS],
  is_admin: false,
};

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

function createEmptyPluginState(): PluginTabState {
  return {
    activeTabId: null,
    tabIds: [],
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

  const defaultTabId = visibleTabs(plugin, resolvedUser)[0]?.id ?? null;
  if (!defaultTabId) {
    return createEmptyPluginState();
  }

  return {
    activeTabId: defaultTabId,
    tabIds: [defaultTabId],
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

  const allowedTabs = new Set(visibleTabs(plugin, resolvedUser).map((tab) => tab.id));
  const defaultState = createDefaultStateForPlugin(pluginId, resolvedUser);
  const tabIds = (value?.tabIds ?? []).filter((tabId): tabId is TabIdType => allowedTabs.has(tabId));
  const activeTabId =
    value?.activeTabId && tabIds.includes(value.activeTabId) ? value.activeTabId : tabIds[0] ?? null;

  if (tabIds.length === 0) {
    return defaultState;
  }

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

export function readStoredTabsByPlugin(
  user: PluginVisibilityUser | null | undefined = DEFAULT_VISIBILITY_USER
): TabsByPlugin {
  if (!isBrowser()) {
    return createDefaultTabsByPlugin(user);
  }

  const rawValue = window.localStorage.getItem(StorageKey.TABS);
  if (!rawValue) {
    return createDefaultTabsByPlugin(user);
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<TabsByPlugin>;
    return sanitizeTabsByPlugin(parsed, user);
  } catch {
    return createDefaultTabsByPlugin(user);
  }
}

function writeStoredTabsByPlugin(tabsByPlugin: TabsByPlugin): void {
  if (!isBrowser()) {
    return;
  }

  window.localStorage.setItem(StorageKey.TABS, JSON.stringify(tabsByPlugin));
}

useUiStore.setState({
  sidebarCollapsed: readStoredSidebarCollapsed(),
  tabsByPlugin: readStoredTabsByPlugin(),
});

export function getTabsForPlugin(
  pluginId: PluginIdType,
  tabsByPlugin: TabsByPlugin
): WorkspaceTabDefinition[] {
  return tabsByPlugin[pluginId].tabIds.map((tabId) => tabDefinitions[tabId]);
}

export function syncTabsForUser(user: PluginVisibilityUser | null | undefined): void {
  const nextTabsByPlugin = sanitizeTabsByPlugin(useUiStore.getState().tabsByPlugin, user);
  writeStoredTabsByPlugin(nextTabsByPlugin);
  useUiStore.setState({
    tabsByPlugin: nextTabsByPlugin,
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

export function resetUiStoreState(
  user: PluginVisibilityUser | null | undefined = DEFAULT_VISIBILITY_USER
): void {
  if (isBrowser()) {
    window.localStorage.removeItem(StorageKey.SIDEBAR_COLLAPSED);
    window.localStorage.removeItem(StorageKey.TABS);
  }

  useUiStore.setState({
    sidebarCollapsed: false,
    tabsByPlugin: createDefaultTabsByPlugin(user),
  });
}

export { tabCatalog as PLUGIN_TAB_CATALOG, tabDefinitions as TAB_DEFINITIONS };
export {
  closeTabInPluginState,
  openTabInPluginState,
  readStoredSidebarCollapsed,
  switchTabInPluginState,
  useUiStore,
};
export type { PluginTabState, TabsByPlugin };
