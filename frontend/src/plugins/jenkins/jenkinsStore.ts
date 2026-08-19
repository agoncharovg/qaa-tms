import { create } from "zustand";

import { StorageKey } from "@/constants";

interface JenkinsStorageState {
  expandedNodeKeys: string[] | null;
  pinnedPaths: string[];
}

interface JenkinsState extends JenkinsStorageState {
  isPinned: (path: string) => boolean;
  pin: (path: string) => void;
  setExpandedNodeKeys: (nodeKeys: string[]) => void;
  toggleExpandedNodeKey: (nodeKey: string) => void;
  unpin: (path: string) => void;
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function normalizeStoredPaths(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item, index, items): item is string => {
    if (typeof item !== "string") {
      return false;
    }
    const normalizedItem = item.trim();
    return normalizedItem.length > 0 && items.indexOf(item) === index;
  });
}

function readStoredState(): JenkinsStorageState {
  if (!isBrowser()) {
    return { expandedNodeKeys: null, pinnedPaths: [] };
  }

  const rawValue = window.localStorage.getItem(StorageKey.JENKINS_PINNED);
  if (!rawValue) {
    return { expandedNodeKeys: null, pinnedPaths: [] };
  }

  try {
    const parsed = JSON.parse(rawValue) as { expandedNodeKeys?: unknown; pinnedPaths?: unknown };
    const hasExpandedNodeKeys = Object.prototype.hasOwnProperty.call(parsed, "expandedNodeKeys");
    return {
      expandedNodeKeys: hasExpandedNodeKeys ? normalizeStoredPaths(parsed.expandedNodeKeys) : null,
      pinnedPaths: normalizeStoredPaths(parsed.pinnedPaths),
    };
  } catch {
    return { expandedNodeKeys: null, pinnedPaths: [] };
  }
}

function writeStoredState(state: JenkinsStorageState): void {
  if (!isBrowser()) {
    return;
  }

  window.localStorage.setItem(StorageKey.JENKINS_PINNED, JSON.stringify(state));
}

const initialState = readStoredState();

export const useJenkinsStore = create<JenkinsState>()((set, get) => ({
  expandedNodeKeys: initialState.expandedNodeKeys,
  pinnedPaths: initialState.pinnedPaths,

  isPinned(path) {
    return get().pinnedPaths.includes(path);
  },

  pin(path) {
    const normalizedPath = path.trim();
    if (!normalizedPath) {
      return;
    }
    if (get().pinnedPaths.includes(normalizedPath)) {
      return;
    }

    const pinnedPaths = [...get().pinnedPaths, normalizedPath];
    writeStoredState({ expandedNodeKeys: get().expandedNodeKeys, pinnedPaths });
    set({ pinnedPaths });
  },

  setExpandedNodeKeys(nodeKeys) {
    const expandedNodeKeys = normalizeStoredPaths(nodeKeys);
    writeStoredState({ expandedNodeKeys, pinnedPaths: get().pinnedPaths });
    set({ expandedNodeKeys });
  },

  toggleExpandedNodeKey(nodeKey) {
    const normalizedNodeKey = nodeKey.trim();
    if (!normalizedNodeKey) {
      return;
    }

    const currentNodeKeys = get().expandedNodeKeys ?? [];
    const expandedNodeKeys = currentNodeKeys.includes(normalizedNodeKey)
      ? currentNodeKeys.filter((candidate) => candidate !== normalizedNodeKey)
      : [...currentNodeKeys, normalizedNodeKey];
    writeStoredState({ expandedNodeKeys, pinnedPaths: get().pinnedPaths });
    set({ expandedNodeKeys });
  },

  unpin(path) {
    const pinnedPaths = get().pinnedPaths.filter((candidate) => candidate !== path);
    writeStoredState({ expandedNodeKeys: get().expandedNodeKeys, pinnedPaths });
    set({ pinnedPaths });
  },
}));

export function resetJenkinsStoreState(): void {
  if (isBrowser()) {
    window.localStorage.removeItem(StorageKey.JENKINS_PINNED);
  }

  useJenkinsStore.setState({ expandedNodeKeys: null, pinnedPaths: [] });
}
