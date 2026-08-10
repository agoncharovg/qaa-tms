import { create } from "zustand";

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

export interface PluginTabState {
  activeTabId: TabIdType | null;
  tabIds: TabIdType[];
}

export type TabsByPlugin = Record<PluginIdType, PluginTabState>;

type PluginVisibilityUser = Pick<User, "enabled_plugins" | "is_admin">;

interface UiState {
  closeTab: (pluginId: PluginIdType, tabId: TabIdType) => void;
  openTab: (pluginId: PluginIdType, tabId: TabIdType) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  sidebarCollapsed: boolean;
  switchTab: (pluginId: PluginIdType, tabId: TabIdType) => void;
  tabsByPlugin: TabsByPlugin;
  toggleSidebar: () => void;
}

const DEFAULT_VISIBILITY_USER: PluginVisibilityUser = {
  enabled_plugins: [PluginId.STAGINGS],
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

export function readStoredSidebarCollapsed(): boolean {
  if (!isBrowser()) {
    return false;
  }

  return window.localStorage.getItem(StorageKey.SIDEBAR_COLLAPSED) === "true";
}

function writeStoredSidebarCollapsed(collapsed: boolean): void {
  if (!isBrowser()) {
    return;
  }

  window.localStorage.setItem(StorageKey.SIDEBAR_COLLAPSED, String(collapsed));
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

export function openTabInPluginState(
  pluginState: PluginTabState,
  tabId: TabIdType
): PluginTabState {
  if (pluginState.tabIds.includes(tabId)) {
    return {
      ...pluginState,
      activeTabId: tabId,
    };
  }

  return {
    activeTabId: tabId,
    tabIds: [...pluginState.tabIds, tabId],
  };
}

export function closeTabInPluginState(
  pluginState: PluginTabState,
  tabId: TabIdType
): PluginTabState {
  const closeIndex = pluginState.tabIds.indexOf(tabId);
  if (closeIndex === -1) {
    return pluginState;
  }

  const nextTabIds = pluginState.tabIds.filter((existingTabId) => existingTabId !== tabId);
  if (nextTabIds.length === 0) {
    return {
      activeTabId: null,
      tabIds: [],
    };
  }

  if (pluginState.activeTabId !== tabId) {
    return {
      activeTabId: pluginState.activeTabId,
      tabIds: nextTabIds,
    };
  }

  const fallbackTabId = nextTabIds[closeIndex] ?? nextTabIds[closeIndex - 1] ?? null;
  return {
    activeTabId: fallbackTabId,
    tabIds: nextTabIds,
  };
}

export function switchTabInPluginState(
  pluginState: PluginTabState,
  tabId: TabIdType
): PluginTabState {
  if (!pluginState.tabIds.includes(tabId)) {
    return pluginState;
  }

  return {
    ...pluginState,
    activeTabId: tabId,
  };
}

const initialTabsByPlugin = readStoredTabsByPlugin();

export const useUiStore = create<UiState>()((set) => ({
  closeTab(pluginId, tabId) {
    set((state) => {
      const nextTabsByPlugin = {
        ...state.tabsByPlugin,
        [pluginId]: closeTabInPluginState(state.tabsByPlugin[pluginId], tabId),
      };
      writeStoredTabsByPlugin(nextTabsByPlugin);
      return {
        tabsByPlugin: nextTabsByPlugin,
      };
    });
  },

  openTab(pluginId, tabId) {
    set((state) => {
      if (tabDefinitions[tabId].pluginId !== pluginId) {
        return state;
      }

      const nextTabsByPlugin = {
        ...state.tabsByPlugin,
        [pluginId]: openTabInPluginState(state.tabsByPlugin[pluginId], tabId),
      };
      writeStoredTabsByPlugin(nextTabsByPlugin);
      return {
        tabsByPlugin: nextTabsByPlugin,
      };
    });
  },

  setSidebarCollapsed(collapsed) {
    writeStoredSidebarCollapsed(collapsed);
    set({
      sidebarCollapsed: collapsed,
    });
  },

  sidebarCollapsed: readStoredSidebarCollapsed(),

  switchTab(pluginId, tabId) {
    set((state) => {
      const nextTabsByPlugin = {
        ...state.tabsByPlugin,
        [pluginId]: switchTabInPluginState(state.tabsByPlugin[pluginId], tabId),
      };
      writeStoredTabsByPlugin(nextTabsByPlugin);
      return {
        tabsByPlugin: nextTabsByPlugin,
      };
    });
  },

  tabsByPlugin: initialTabsByPlugin,

  toggleSidebar() {
    set((state) => {
      const nextValue = !state.sidebarCollapsed;
      writeStoredSidebarCollapsed(nextValue);
      return {
        sidebarCollapsed: nextValue,
      };
    });
  },
}));

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
