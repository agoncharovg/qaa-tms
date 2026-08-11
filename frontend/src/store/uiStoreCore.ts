import { create } from "zustand";

import {
  PluginId,
  StorageKey,
  TabId,
  type PluginId as PluginIdType,
  type TabId as TabIdType,
} from "@/constants";

export interface PluginTabState {
  activeTabId: TabIdType | null;
  tabIds: TabIdType[];
}

export type TabsByPlugin = Record<PluginIdType, PluginTabState>;

interface UiState {
  closeTab: (pluginId: PluginIdType, tabId: TabIdType) => void;
  openTab: (pluginId: PluginIdType, tabId: TabIdType) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  sidebarCollapsed: boolean;
  switchTab: (pluginId: PluginIdType, tabId: TabIdType) => void;
  tabsByPlugin: TabsByPlugin;
  toggleSidebar: () => void;
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
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

function writeStoredTabsByPlugin(tabsByPlugin: TabsByPlugin): void {
  if (!isBrowser()) {
    return;
  }

  window.localStorage.setItem(StorageKey.TABS, JSON.stringify(tabsByPlugin));
}

function createBootstrapTabsByPlugin(): TabsByPlugin {
  return {
    [PluginId.ADMIN]: {
      activeTabId: TabId.ADMIN_PLUGINS,
      tabIds: [TabId.ADMIN_PLUGINS],
    },
    [PluginId.KUBER]: {
      activeTabId: TabId.KUBE_CLUSTERS,
      tabIds: [TabId.KUBE_CLUSTERS],
    },
    [PluginId.QAA_GENERATOR]: {
      activeTabId: TabId.QAA_GENERATE,
      tabIds: [TabId.QAA_GENERATE],
    },
    [PluginId.STAGINGS]: {
      activeTabId: TabId.STAGINGS_PREFLIGHT,
      tabIds: [TabId.STAGINGS_PREFLIGHT],
    },
  };
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

  tabsByPlugin: createBootstrapTabsByPlugin(),

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
