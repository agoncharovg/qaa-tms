import { create } from "zustand";

import { StorageKey } from "@/constants";

interface KuberStorageState {
  selectedContext: string | null;
  selectedNamespace: string | null;
}

interface KuberState extends KuberStorageState {
  setSelectedContext: (context: string | null) => void;
  setSelectedNamespace: (namespace: string | null) => void;
}

const KuberStorageField = {
  SELECTED_CONTEXT: "selectedContext",
  SELECTED_NAMESPACE: "selectedNamespace",
} as const;

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readStoredKuberState(): KuberStorageState {
  if (!isBrowser()) {
    return { selectedContext: null, selectedNamespace: null };
  }

  const rawValue = window.localStorage.getItem(StorageKey.KUBE);
  if (!rawValue) {
    return { selectedContext: null, selectedNamespace: null };
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<Record<(typeof KuberStorageField)[keyof typeof KuberStorageField], unknown>>;
    const selectedContext = parsed[KuberStorageField.SELECTED_CONTEXT];
    const selectedNamespace = parsed[KuberStorageField.SELECTED_NAMESPACE];
    return {
      selectedContext: typeof selectedContext === "string" ? selectedContext : null,
      selectedNamespace: typeof selectedNamespace === "string" ? selectedNamespace : null,
    };
  } catch {
    return { selectedContext: null, selectedNamespace: null };
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
  selectedNamespace: initialStoredState.selectedNamespace,

  setSelectedContext(context) {
    set((state) => {
      writeStoredKuberState({
        selectedContext: context,
        selectedNamespace: state.selectedNamespace,
      });

      return {
        selectedContext: context,
      };
    });
  },

  setSelectedNamespace(namespace) {
    set((state) => {
      writeStoredKuberState({
        selectedContext: state.selectedContext,
        selectedNamespace: namespace,
      });

      return {
        selectedNamespace: namespace,
      };
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
