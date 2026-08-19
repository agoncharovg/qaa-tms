import { create } from "zustand";

import { StorageKey } from "@/constants";

interface JenkinsStorageState {
  pinnedPaths: string[];
}

interface JenkinsState extends JenkinsStorageState {
  isPinned: (path: string) => boolean;
  pin: (path: string) => void;
  unpin: (path: string) => void;
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readStoredState(): JenkinsStorageState {
  if (!isBrowser()) {
    return { pinnedPaths: [] };
  }

  const rawValue = window.localStorage.getItem(StorageKey.JENKINS_PINNED);
  if (!rawValue) {
    return { pinnedPaths: [] };
  }

  try {
    const parsed = JSON.parse(rawValue) as { pinnedPaths?: unknown };
    return {
      pinnedPaths: Array.isArray(parsed.pinnedPaths)
        ? parsed.pinnedPaths.filter(
            (value): value is string => typeof value === "string" && value.trim().length > 0
          )
        : [],
    };
  } catch {
    return { pinnedPaths: [] };
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
  pinnedPaths: initialState.pinnedPaths,

  isPinned(path) {
    return get().pinnedPaths.includes(path);
  },

  pin(path) {
    if (!path.trim()) {
      return;
    }
    if (get().pinnedPaths.includes(path)) {
      return;
    }

    const pinnedPaths = [...get().pinnedPaths, path];
    writeStoredState({ pinnedPaths });
    set({ pinnedPaths });
  },

  unpin(path) {
    const pinnedPaths = get().pinnedPaths.filter((candidate) => candidate !== path);
    writeStoredState({ pinnedPaths });
    set({ pinnedPaths });
  },
}));

export function resetJenkinsStoreState(): void {
  if (isBrowser()) {
    window.localStorage.removeItem(StorageKey.JENKINS_PINNED);
  }

  useJenkinsStore.setState({ pinnedPaths: [] });
}
