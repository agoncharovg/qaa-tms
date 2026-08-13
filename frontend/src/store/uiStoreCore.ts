import { create } from "zustand";

import {
  PluginId,
  StorageKey,
  type PluginId as PluginIdType,
  type TabId as TabIdType,
} from "@/constants";
import { tabDefinitions } from "@/plugins/catalog";

export interface PluginTabState {
  activeTabId: TabIdType | null;
  tabIds: TabIdType[];
}

export interface WorkspaceTabsState {
  activeWorkspaceTabId: TabIdType | null;
  workspaceTabIds: TabIdType[];
}

export type TabsByPlugin = Record<PluginIdType, PluginTabState>;

interface UiState extends WorkspaceTabsState {
  closeTab: (pluginId: PluginIdType, tabId: TabIdType) => void;
  openTab: (pluginId: PluginIdType, tabId: TabIdType) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  sidebarCollapsed: boolean;
  switchTab: (pluginId: PluginIdType, tabId: TabIdType) => void;
  tabsByPlugin: TabsByPlugin;
  toggleSidebar: () => void;
}

interface PersistedUiState extends WorkspaceTabsState {
  tabsByPlugin: TabsByPlugin;
}

export function createEmptyPluginState(): PluginTabState {
  return {
    activeTabId: null,
    tabIds: [],
  };
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

export function writeStoredUiState(state: PersistedUiState): void {
  if (!isBrowser()) {
    return;
  }

  window.localStorage.setItem(StorageKey.TABS, JSON.stringify(state));
}

export function createBootstrapTabsByPlugin(): TabsByPlugin {
  return {
    [PluginId.ADMIN]: createEmptyPluginState(),
    [PluginId.JENKINS]: createEmptyPluginState(),
    [PluginId.KUBER]: createEmptyPluginState(),
    [PluginId.QAA_GENERATOR]: createEmptyPluginState(),
    [PluginId.STAGINGS]: createEmptyPluginState(),
  };
}

export function createBootstrapWorkspaceTabsState(): WorkspaceTabsState {
  return {
    activeWorkspaceTabId: null,
    workspaceTabIds: [],
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
    return createEmptyPluginState();
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

function openTabInWorkspaceState(
  workspaceState: WorkspaceTabsState,
  tabId: TabIdType
): WorkspaceTabsState {
  return {
    activeWorkspaceTabId: tabId,
    workspaceTabIds: workspaceState.workspaceTabIds.includes(tabId)
      ? workspaceState.workspaceTabIds
      : [...workspaceState.workspaceTabIds, tabId],
  };
}

function closeTabInWorkspaceState(
  workspaceState: WorkspaceTabsState,
  tabId: TabIdType
): WorkspaceTabsState {
  const closeIndex = workspaceState.workspaceTabIds.indexOf(tabId);
  if (closeIndex === -1) {
    return workspaceState;
  }

  const nextWorkspaceTabIds = workspaceState.workspaceTabIds.filter(
    (existingTabId) => existingTabId !== tabId
  );
  if (nextWorkspaceTabIds.length === 0) {
    return createBootstrapWorkspaceTabsState();
  }

  if (workspaceState.activeWorkspaceTabId !== tabId) {
    return {
      activeWorkspaceTabId: workspaceState.activeWorkspaceTabId,
      workspaceTabIds: nextWorkspaceTabIds,
    };
  }

  const fallbackTabId =
    nextWorkspaceTabIds[closeIndex] ?? nextWorkspaceTabIds[closeIndex - 1] ?? null;

  return {
    activeWorkspaceTabId: fallbackTabId,
    workspaceTabIds: nextWorkspaceTabIds,
  };
}

function switchTabInWorkspaceState(
  workspaceState: WorkspaceTabsState,
  tabId: TabIdType
): WorkspaceTabsState {
  return {
    activeWorkspaceTabId: tabId,
    workspaceTabIds: workspaceState.workspaceTabIds.includes(tabId)
      ? workspaceState.workspaceTabIds
      : [...workspaceState.workspaceTabIds, tabId],
  };
}

function syncPluginActiveTab(
  tabsByPlugin: TabsByPlugin,
  activeWorkspaceTabId: TabIdType | null
): TabsByPlugin {
  if (!activeWorkspaceTabId) {
    return tabsByPlugin;
  }

  const definition = tabDefinitions[activeWorkspaceTabId];
  if (!definition) {
    return tabsByPlugin;
  }

  const pluginState = tabsByPlugin[definition.pluginId];
  if (!pluginState.tabIds.includes(activeWorkspaceTabId)) {
    return tabsByPlugin;
  }

  return {
    ...tabsByPlugin,
    [definition.pluginId]: switchTabInPluginState(pluginState, activeWorkspaceTabId),
  };
}

export const useUiStore = create<UiState>()((set) => ({
  activeWorkspaceTabId: null,

  closeTab(pluginId, tabId) {
    set((state) => {
      const nextTabsByPlugin = {
        ...state.tabsByPlugin,
        [pluginId]: closeTabInPluginState(state.tabsByPlugin[pluginId], tabId),
      };
      const nextWorkspaceState = closeTabInWorkspaceState(state, tabId);
      const syncedTabsByPlugin = syncPluginActiveTab(
        nextTabsByPlugin,
        nextWorkspaceState.activeWorkspaceTabId
      );
      writeStoredUiState({
        activeWorkspaceTabId: nextWorkspaceState.activeWorkspaceTabId,
        tabsByPlugin: syncedTabsByPlugin,
        workspaceTabIds: nextWorkspaceState.workspaceTabIds,
      });
      return {
        activeWorkspaceTabId: nextWorkspaceState.activeWorkspaceTabId,
        tabsByPlugin: syncedTabsByPlugin,
        workspaceTabIds: nextWorkspaceState.workspaceTabIds,
      };
    });
  },

  openTab(pluginId, tabId) {
    set((state) => {
      const nextTabsByPlugin = {
        ...state.tabsByPlugin,
        [pluginId]: openTabInPluginState(state.tabsByPlugin[pluginId], tabId),
      };
      const nextWorkspaceState = openTabInWorkspaceState(state, tabId);
      const syncedTabsByPlugin = syncPluginActiveTab(nextTabsByPlugin, tabId);
      writeStoredUiState({
        activeWorkspaceTabId: nextWorkspaceState.activeWorkspaceTabId,
        tabsByPlugin: syncedTabsByPlugin,
        workspaceTabIds: nextWorkspaceState.workspaceTabIds,
      });
      return {
        activeWorkspaceTabId: nextWorkspaceState.activeWorkspaceTabId,
        tabsByPlugin: syncedTabsByPlugin,
        workspaceTabIds: nextWorkspaceState.workspaceTabIds,
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
      if (!state.tabsByPlugin[pluginId].tabIds.includes(tabId)) {
        return state;
      }

      const nextTabsByPlugin = {
        ...state.tabsByPlugin,
        [pluginId]: switchTabInPluginState(state.tabsByPlugin[pluginId], tabId),
      };
      const nextWorkspaceState = switchTabInWorkspaceState(state, tabId);
      const syncedTabsByPlugin = syncPluginActiveTab(nextTabsByPlugin, tabId);
      writeStoredUiState({
        activeWorkspaceTabId: nextWorkspaceState.activeWorkspaceTabId,
        tabsByPlugin: syncedTabsByPlugin,
        workspaceTabIds: nextWorkspaceState.workspaceTabIds,
      });
      return {
        activeWorkspaceTabId: nextWorkspaceState.activeWorkspaceTabId,
        tabsByPlugin: syncedTabsByPlugin,
        workspaceTabIds: nextWorkspaceState.workspaceTabIds,
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

  workspaceTabIds: [],
}));
