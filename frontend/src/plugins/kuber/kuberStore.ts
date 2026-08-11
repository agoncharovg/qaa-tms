import { create } from "zustand";

import { StorageKey } from "@/constants";

interface KuberStorageState {
  selectedContext: string | null;
}

interface KuberState extends KuberStorageState {
  selectedNamespace: string | null;
  setSelectedContext: (context: string | null) => void;
  setSelectedNamespace: (namespace: string | null) => void;
}

const KuberStorageField = {
  SELECTED_CONTEXT: "selectedContext",
} as const;

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readStoredKuberState(): KuberStorageState {
  if (!isBrowser()) {
    return { selectedContext: null };
  }

  const rawValue = window.localStorage.getItem(StorageKey.KUBE);
  if (!rawValue) {
    return { selectedContext: null };
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<Record<(typeof KuberStorageField)[keyof typeof KuberStorageField], unknown>>;
    const selectedContext = parsed[KuberStorageField.SELECTED_CONTEXT];
    return {
      selectedContext: typeof selectedContext === "string" ? selectedContext : null,
    };
  } catch {
    return { selectedContext: null };
  }
}

function writeStoredKuberState(state: KuberStorageState): void {
  if (!isBrowser()) {
    return;
  }

  window.localStorage.setItem(StorageKey.KUBE, JSON.stringify(state));
}

const initialStoredState = readStoredKuberState();

export const useKuberStore = create<KuberState>()((set) => ({
  selectedContext: initialStoredState.selectedContext,
  selectedNamespace: null,

  setSelectedContext(context) {
    writeStoredKuberState({ selectedContext: context });
    set({
      selectedContext: context,
    });
  },

  setSelectedNamespace(namespace) {
    set({
      selectedNamespace: namespace,
    });
  },
}));

export function resetKuberStoreState(): void {
  if (isBrowser()) {
    window.localStorage.removeItem(StorageKey.KUBE);
  }

  useKuberStore.setState({
    selectedContext: null,
    selectedNamespace: null,
  });
}
