import { create } from "zustand";

import type { WorkspaceTabDefinition } from "@/api/types";
import {
  ContentType,
  SectionKey,
  StorageKey,
  TabId,
  TabTitle,
  ViewKey,
  type SectionKey as SectionKeyType,
  type TabId as TabIdType,
} from "@/constants";

export interface SectionTabState {
  activeTabId: TabIdType | null;
  tabIds: TabIdType[];
}

export type TabsBySection = Record<SectionKeyType, SectionTabState>;

interface UiState {
  closeTab: (section: SectionKeyType, tabId: TabIdType) => void;
  openTab: (section: SectionKeyType, tabId: TabIdType) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  sidebarCollapsed: boolean;
  switchTab: (section: SectionKeyType, tabId: TabIdType) => void;
  tabsBySection: TabsBySection;
  toggleSidebar: () => void;
}

export const TAB_DEFINITIONS: Record<TabIdType, WorkspaceTabDefinition> = {
  [TabId.STAGINGS_PREFLIGHT]: {
    closeable: true,
    contentType: ContentType.REACT_VIEW,
    id: TabId.STAGINGS_PREFLIGHT,
    section: SectionKey.STAGINGS,
    title: TabTitle[TabId.STAGINGS_PREFLIGHT],
    viewKey: ViewKey.STAGINGS_PREFLIGHT,
  },
  [TabId.STAGINGS_DEPLOY]: {
    closeable: true,
    contentType: ContentType.REACT_VIEW,
    id: TabId.STAGINGS_DEPLOY,
    section: SectionKey.STAGINGS,
    title: TabTitle[TabId.STAGINGS_DEPLOY],
    viewKey: ViewKey.STAGINGS_DEPLOY,
  },
  [TabId.STAGINGS_HISTORY]: {
    closeable: true,
    contentType: ContentType.REACT_VIEW,
    id: TabId.STAGINGS_HISTORY,
    section: SectionKey.STAGINGS,
    title: TabTitle[TabId.STAGINGS_HISTORY],
    viewKey: ViewKey.STAGINGS_HISTORY,
  },
  [TabId.STAGINGS_NAMESPACES]: {
    closeable: true,
    contentType: ContentType.REACT_VIEW,
    id: TabId.STAGINGS_NAMESPACES,
    section: SectionKey.STAGINGS,
    title: TabTitle[TabId.STAGINGS_NAMESPACES],
    viewKey: ViewKey.STAGINGS_NAMESPACES,
  },
  [TabId.ADMIN_USERS]: {
    closeable: true,
    contentType: ContentType.REACT_VIEW,
    id: TabId.ADMIN_USERS,
    section: SectionKey.ADMIN,
    title: TabTitle[TabId.ADMIN_USERS],
    viewKey: ViewKey.ADMIN_USERS,
  },
};

export const SECTION_TAB_CATALOG: Record<SectionKeyType, TabIdType[]> = {
  [SectionKey.STAGINGS]: [
    TabId.STAGINGS_PREFLIGHT,
    TabId.STAGINGS_DEPLOY,
    TabId.STAGINGS_HISTORY,
    TabId.STAGINGS_NAMESPACES,
  ],
  [SectionKey.ADMIN]: [TabId.ADMIN_USERS],
};

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function createDefaultTabsBySection(): TabsBySection {
  return {
    [SectionKey.ADMIN]: {
      activeTabId: TabId.ADMIN_USERS,
      tabIds: [TabId.ADMIN_USERS],
    },
    [SectionKey.STAGINGS]: {
      activeTabId: TabId.STAGINGS_PREFLIGHT,
      tabIds: [TabId.STAGINGS_PREFLIGHT],
    },
  };
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

export function readStoredTabsBySection(): TabsBySection {
  if (!isBrowser()) {
    return createDefaultTabsBySection();
  }

  const rawValue = window.localStorage.getItem(StorageKey.TABS);
  if (!rawValue) {
    return createDefaultTabsBySection();
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<TabsBySection>;
    return {
      [SectionKey.ADMIN]: sanitizeSectionTabs(parsed[SectionKey.ADMIN], SectionKey.ADMIN),
      [SectionKey.STAGINGS]: sanitizeSectionTabs(parsed[SectionKey.STAGINGS], SectionKey.STAGINGS),
    };
  } catch {
    return createDefaultTabsBySection();
  }
}

function writeStoredTabsBySection(tabsBySection: TabsBySection): void {
  if (!isBrowser()) {
    return;
  }

  window.localStorage.setItem(StorageKey.TABS, JSON.stringify(tabsBySection));
}

function sanitizeSectionTabs(
  value: SectionTabState | undefined,
  section: SectionKeyType
): SectionTabState {
  const allowedTabs = new Set(SECTION_TAB_CATALOG[section]);
  const defaultState = createDefaultTabsBySection()[section];
  const tabIds = (value?.tabIds ?? []).filter((tabId): tabId is TabIdType => allowedTabs.has(tabId));
  const activeTabId =
    value?.activeTabId && tabIds.includes(value.activeTabId) ? value.activeTabId : tabIds[0] ?? null;

  if (tabIds.length === 0 && value?.activeTabId === null) {
    return {
      activeTabId: null,
      tabIds: [],
    };
  }

  if (tabIds.length === 0) {
    return defaultState;
  }

  return {
    activeTabId,
    tabIds,
  };
}

export function openTabInSectionState(
  sectionState: SectionTabState,
  tabId: TabIdType
): SectionTabState {
  if (sectionState.tabIds.includes(tabId)) {
    return {
      ...sectionState,
      activeTabId: tabId,
    };
  }

  return {
    activeTabId: tabId,
    tabIds: [...sectionState.tabIds, tabId],
  };
}

export function closeTabInSectionState(
  sectionState: SectionTabState,
  tabId: TabIdType
): SectionTabState {
  const closeIndex = sectionState.tabIds.indexOf(tabId);
  if (closeIndex === -1) {
    return sectionState;
  }

  const nextTabIds = sectionState.tabIds.filter((existingTabId) => existingTabId !== tabId);
  if (nextTabIds.length === 0) {
    return {
      activeTabId: null,
      tabIds: [],
    };
  }

  if (sectionState.activeTabId !== tabId) {
    return {
      activeTabId: sectionState.activeTabId,
      tabIds: nextTabIds,
    };
  }

  const fallbackTabId = nextTabIds[closeIndex] ?? nextTabIds[closeIndex - 1] ?? null;
  return {
    activeTabId: fallbackTabId,
    tabIds: nextTabIds,
  };
}

export function switchTabInSectionState(
  sectionState: SectionTabState,
  tabId: TabIdType
): SectionTabState {
  if (!sectionState.tabIds.includes(tabId)) {
    return sectionState;
  }

  return {
    ...sectionState,
    activeTabId: tabId,
  };
}

const initialTabsBySection = readStoredTabsBySection();

export const useUiStore = create<UiState>()((set) => ({
  closeTab(section, tabId) {
    set((state) => {
      const nextTabsBySection = {
        ...state.tabsBySection,
        [section]: closeTabInSectionState(state.tabsBySection[section], tabId),
      };
      writeStoredTabsBySection(nextTabsBySection);
      return {
        tabsBySection: nextTabsBySection,
      };
    });
  },

  openTab(section, tabId) {
    set((state) => {
      const nextTabsBySection = {
        ...state.tabsBySection,
        [section]: openTabInSectionState(state.tabsBySection[section], tabId),
      };
      writeStoredTabsBySection(nextTabsBySection);
      return {
        tabsBySection: nextTabsBySection,
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

  switchTab(section, tabId) {
    set((state) => {
      const nextTabsBySection = {
        ...state.tabsBySection,
        [section]: switchTabInSectionState(state.tabsBySection[section], tabId),
      };
      writeStoredTabsBySection(nextTabsBySection);
      return {
        tabsBySection: nextTabsBySection,
      };
    });
  },

  tabsBySection: initialTabsBySection,

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

export function getTabsForSection(section: SectionKeyType, tabsBySection: TabsBySection): WorkspaceTabDefinition[] {
  return tabsBySection[section].tabIds.map((tabId) => TAB_DEFINITIONS[tabId]);
}

export function resetUiStoreState(): void {
  if (isBrowser()) {
    window.localStorage.removeItem(StorageKey.SIDEBAR_COLLAPSED);
    window.localStorage.removeItem(StorageKey.TABS);
  }

  useUiStore.setState({
    sidebarCollapsed: false,
    tabsBySection: createDefaultTabsBySection(),
  });
}
