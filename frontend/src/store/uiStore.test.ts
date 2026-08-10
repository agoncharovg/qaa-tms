import { beforeEach, describe, expect, it } from "vitest";

import { PluginId, StorageKey, TabId } from "@/constants";
import {
  closeTabInPluginState,
  createDefaultTabsByPlugin,
  openTabInPluginState,
  readStoredSidebarCollapsed,
  readStoredTabsByPlugin,
  resetUiStoreState,
  switchTabInPluginState,
  useUiStore,
} from "@/store/uiStore";

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

    expect(openedState.tabIds).toEqual([TabId.STAGINGS_PREFLIGHT, TabId.STAGINGS_NAMESPACES]);
    expect(openedState.activeTabId).toBe(TabId.STAGINGS_NAMESPACES);

    const switchedState = switchTabInPluginState(openedState, TabId.STAGINGS_PREFLIGHT);

    expect(switchedState.activeTabId).toBe(TabId.STAGINGS_PREFLIGHT);

    const closedState = closeTabInPluginState(switchedState, TabId.STAGINGS_PREFLIGHT);

    expect(closedState.tabIds).toEqual([TabId.STAGINGS_NAMESPACES]);
    expect(closedState.activeTabId).toBe(TabId.STAGINGS_NAMESPACES);
  });

  it("restores the default tab when a visible plugin was persisted with no open tabs", () => {
    localStorage.setItem(
      StorageKey.TABS,
      JSON.stringify({
        [PluginId.ADMIN]: {
          activeTabId: TabId.ADMIN_PLUGINS,
          tabIds: [TabId.ADMIN_PLUGINS],
        },
        [PluginId.STAGINGS]: {
          activeTabId: null,
          tabIds: [],
        },
      })
    );

    const sanitized = readStoredTabsByPlugin({
      enabled_plugins: [PluginId.STAGINGS],
      is_admin: false,
    });

    expect(sanitized[PluginId.STAGINGS]).toEqual({
      activeTabId: TabId.STAGINGS_PREFLIGHT,
      tabIds: [TabId.STAGINGS_PREFLIGHT],
    });
  });

  it("drops tabs from disabled plugins and admin-only tabs for non-admin users", () => {
    localStorage.setItem(
      StorageKey.TABS,
      JSON.stringify({
        [PluginId.ADMIN]: {
          activeTabId: TabId.ADMIN_USERS,
          tabIds: [TabId.ADMIN_USERS],
        },
        [PluginId.STAGINGS]: {
          activeTabId: TabId.STAGINGS_HISTORY,
          tabIds: [TabId.STAGINGS_HISTORY],
        },
      })
    );

    const sanitized = readStoredTabsByPlugin({
      enabled_plugins: [],
      is_admin: false,
    });

    expect(sanitized[PluginId.STAGINGS]).toEqual({
      activeTabId: null,
      tabIds: [],
    });
    expect(sanitized[PluginId.ADMIN]).toEqual({
      activeTabId: TabId.ADMIN_PLUGINS,
      tabIds: [TabId.ADMIN_PLUGINS],
    });
  });
});
