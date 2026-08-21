import { beforeEach, describe, expect, it } from "vitest";

import { PluginId, StorageKey, TabId } from "@/constants";
import {
  closeTabInPluginState,
  createDefaultTabsByPlugin,
  openTabInPluginState,
  readStoredSidebarCollapsed,
  readStoredTabsByPlugin,
  readStoredWorkspaceTabsState,
  resetUiStoreState,
  restoreUiStoreFromStorage,
  syncTabsForUser,
  switchTabInPluginState,
  useUiStore,
} from "@/store/uiStore";

function seedStoredStatisticsSmokeTab(): void {
  localStorage.setItem(
    StorageKey.TABS,
    JSON.stringify({
      activeWorkspaceTabId: TabId.STATISTICS_SMOKE,
      tabsByPlugin: {
        [PluginId.PROFILE]: {
          activeTabId: TabId.PROFILE,
          tabIds: [TabId.PROFILE],
        },
        [PluginId.STATISTICS]: {
          activeTabId: TabId.STATISTICS_SMOKE,
          tabIds: [TabId.STATISTICS_SMOKE],
        },
      },
      workspaceTabIds: [TabId.PROFILE, TabId.STATISTICS_SMOKE],
    })
  );
}

describe("uiStore", () => {
  beforeEach(() => {
    localStorage.clear();
    resetUiStoreState();
  });

  it("persists sidebar collapsed state", () => {
    useUiStore.getState().setSidebarCollapsed(true);

    expect(useUiStore.getState().sidebarCollapsed).toBe(true);
    expect(localStorage.getItem(StorageKey.SIDEBAR_COLLAPSED)).toBe("true");
    expect(readStoredSidebarCollapsed()).toBe(true);
  });

  it("opens, switches, and closes tabs per plugin", () => {
    const initialState = createDefaultTabsByPlugin();
    const openedState = openTabInPluginState(
      initialState[PluginId.STAGINGS],
      TabId.STAGINGS_NAMESPACES
    );

    expect(openedState.tabIds).toEqual([TabId.STAGINGS_NAMESPACES]);
    expect(openedState.activeTabId).toBe(TabId.STAGINGS_NAMESPACES);

    const reopenedState = openTabInPluginState(openedState, TabId.STAGINGS_PREFLIGHT);
    const switchedState = switchTabInPluginState(reopenedState, TabId.STAGINGS_NAMESPACES);

    expect(switchedState.activeTabId).toBe(TabId.STAGINGS_NAMESPACES);

    const closedState = closeTabInPluginState(switchedState, TabId.STAGINGS_NAMESPACES);

    expect(closedState.tabIds).toEqual([TabId.STAGINGS_PREFLIGHT]);
    expect(closedState.activeTabId).toBe(TabId.STAGINGS_PREFLIGHT);
  });

  it("tracks workspace tabs across plugins independently of the active sidebar plugin", () => {
    useUiStore.getState().openTab(PluginId.QAA_GENERATOR, TabId.QAA_GENERATE);
    useUiStore.getState().openTab(PluginId.STAGINGS, TabId.STAGINGS_HISTORY);

    expect(useUiStore.getState().workspaceTabIds).toEqual([
      TabId.QAA_GENERATE,
      TabId.STAGINGS_HISTORY,
    ]);
    expect(useUiStore.getState().activeWorkspaceTabId).toBe(TabId.STAGINGS_HISTORY);

    useUiStore.getState().switchTab(PluginId.QAA_GENERATOR, TabId.QAA_GENERATE);

    expect(useUiStore.getState().activeWorkspaceTabId).toBe(TabId.QAA_GENERATE);
    expect(useUiStore.getState().tabsByPlugin[PluginId.QAA_GENERATOR].activeTabId).toBe(
      TabId.QAA_GENERATE
    );
    expect(useUiStore.getState().tabsByPlugin[PluginId.STAGINGS].activeTabId).toBe(
      TabId.STAGINGS_HISTORY
    );
  });

  it("closes a middle active workspace tab without affecting the surrounding tabs", () => {
    useUiStore.getState().openTab(PluginId.STAGINGS, TabId.STAGINGS_HISTORY);
    useUiStore.getState().openTab(PluginId.QAA_GENERATOR, TabId.QAA_GENERATE);
    useUiStore.getState().openTab(PluginId.PROFILE, TabId.PROFILE);

    useUiStore.getState().switchTab(PluginId.QAA_GENERATOR, TabId.QAA_GENERATE);
    useUiStore.getState().closeTab(PluginId.QAA_GENERATOR, TabId.QAA_GENERATE);

    expect(useUiStore.getState().workspaceTabIds).toEqual([
      TabId.STAGINGS_HISTORY,
      TabId.PROFILE,
    ]);
    expect(useUiStore.getState().activeWorkspaceTabId).toBe(TabId.PROFILE);
    expect(useUiStore.getState().tabsByPlugin[PluginId.QAA_GENERATOR]).toEqual({
      activeTabId: null,
      tabIds: [],
    });
  });

  it("drops tabs from disabled plugins and admin-only tabs for non-admin users", () => {
    localStorage.setItem(
      StorageKey.TABS,
      JSON.stringify({
        activeWorkspaceTabId: TabId.QAA_GENERATE,
        tabsByPlugin: {
          [PluginId.ADMIN]: {
            activeTabId: TabId.ADMIN_USERS,
            tabIds: [TabId.ADMIN_USERS],
          },
          [PluginId.JENKINS]: {
            activeTabId: null,
            tabIds: [],
          },
          [PluginId.KUBER]: {
            activeTabId: null,
            tabIds: [],
          },
          [PluginId.PROFILE]: {
            activeTabId: TabId.PROFILE,
            tabIds: [TabId.PROFILE],
          },
          [PluginId.QAA_GENERATOR]: {
            activeTabId: TabId.QAA_ADMIN,
            tabIds: [TabId.QAA_GENERATE, TabId.QAA_ADMIN],
          },
          [PluginId.STAGINGS]: {
            activeTabId: TabId.STAGINGS_HISTORY,
            tabIds: [TabId.STAGINGS_HISTORY],
          },
        },
        workspaceTabIds: [
          TabId.ADMIN_USERS,
          TabId.PROFILE,
          TabId.QAA_GENERATE,
          TabId.STAGINGS_HISTORY,
        ],
      })
    );

    const sanitized = readStoredTabsByPlugin({
      enabled_plugins: [PluginId.QAA_GENERATOR],
      is_admin: false,
    });
    const workspace = readStoredWorkspaceTabsState({
      enabled_plugins: [PluginId.QAA_GENERATOR],
      is_admin: false,
    });

    expect(sanitized[PluginId.STAGINGS]).toEqual({
      activeTabId: null,
      tabIds: [],
    });
    expect(sanitized[PluginId.QAA_GENERATOR]).toEqual({
      activeTabId: TabId.QAA_GENERATE,
      tabIds: [TabId.QAA_GENERATE],
    });
    expect(sanitized[PluginId.ADMIN]).toEqual({
      activeTabId: null,
      tabIds: [],
    });
    expect(sanitized[PluginId.PROFILE]).toEqual({
      activeTabId: TabId.PROFILE,
      tabIds: [TabId.PROFILE],
    });
    expect(workspace).toEqual({
      activeWorkspaceTabId: TabId.QAA_GENERATE,
      workspaceTabIds: [TabId.PROFILE, TabId.QAA_GENERATE],
    });
  });

  it("keeps an active Statistics workspace tab across restore for users with Statistics enabled", () => {
    seedStoredStatisticsSmokeTab();

    restoreUiStoreFromStorage();
    syncTabsForUser({
      enabled_plugins: [PluginId.STATISTICS],
      is_admin: false,
    });

    expect(useUiStore.getState().tabsByPlugin[PluginId.STATISTICS]).toEqual({
      activeTabId: TabId.STATISTICS_SMOKE,
      tabIds: [TabId.STATISTICS_SMOKE],
    });
    expect(useUiStore.getState().workspaceTabIds).toEqual([
      TabId.PROFILE,
      TabId.STATISTICS_SMOKE,
    ]);
    expect(useUiStore.getState().activeWorkspaceTabId).toBe(TabId.STATISTICS_SMOKE);
  });

  it("drops an active Statistics workspace tab across restore for users without Statistics enabled", () => {
    seedStoredStatisticsSmokeTab();

    restoreUiStoreFromStorage();
    syncTabsForUser({
      enabled_plugins: [],
      is_admin: false,
    });

    expect(useUiStore.getState().tabsByPlugin[PluginId.STATISTICS]).toEqual({
      activeTabId: null,
      tabIds: [],
    });
    expect(useUiStore.getState().workspaceTabIds).toEqual([TabId.PROFILE]);
    expect(useUiStore.getState().activeWorkspaceTabId).toBe(TabId.PROFILE);
  });

  it("does not strip or persist tabs when syncTabsForUser receives a null user", () => {
    seedStoredStatisticsSmokeTab();

    restoreUiStoreFromStorage();
    const storedBefore = localStorage.getItem(StorageKey.TABS);

    syncTabsForUser(null);

    expect(useUiStore.getState().tabsByPlugin[PluginId.STATISTICS]).toEqual({
      activeTabId: TabId.STATISTICS_SMOKE,
      tabIds: [TabId.STATISTICS_SMOKE],
    });
    expect(useUiStore.getState().workspaceTabIds).toEqual([
      TabId.PROFILE,
      TabId.STATISTICS_SMOKE,
    ]);
    expect(useUiStore.getState().activeWorkspaceTabId).toBe(TabId.STATISTICS_SMOKE);
    expect(localStorage.getItem(StorageKey.TABS)).toBe(storedBefore);
  });
});
