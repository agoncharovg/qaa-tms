import { beforeEach, describe, expect, it } from "vitest";

import { SectionKey, StorageKey, TabId } from "@/constants";
import {
  closeTabInSectionState,
  createDefaultTabsBySection,
  openTabInSectionState,
  readStoredSidebarCollapsed,
  resetUiStoreState,
  switchTabInSectionState,
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

  it("opens, switches, and closes tabs per section", () => {
    const initialState = createDefaultTabsBySection();
    const openedState = openTabInSectionState(initialState[SectionKey.STAGINGS], TabId.STAGINGS_NAMESPACES);

    expect(openedState.tabIds).toEqual([TabId.STAGINGS_PREFLIGHT, TabId.STAGINGS_NAMESPACES]);
    expect(openedState.activeTabId).toBe(TabId.STAGINGS_NAMESPACES);

    const switchedState = switchTabInSectionState(openedState, TabId.STAGINGS_PREFLIGHT);

    expect(switchedState.activeTabId).toBe(TabId.STAGINGS_PREFLIGHT);

    const closedState = closeTabInSectionState(switchedState, TabId.STAGINGS_PREFLIGHT);

    expect(closedState.tabIds).toEqual([TabId.STAGINGS_NAMESPACES]);
    expect(closedState.activeTabId).toBe(TabId.STAGINGS_NAMESPACES);
  });
});
