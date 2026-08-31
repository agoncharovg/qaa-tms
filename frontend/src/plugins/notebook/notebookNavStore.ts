import { create } from "zustand";

export interface NotebookNoteTarget {
  bookmark: string;
  name: string;
}

interface NotebookNavState {
  pendingSelection: NotebookNoteTarget | null;
  requestNotebookNote: (target: NotebookNoteTarget) => void;
  clearPendingSelection: () => void;
}

export const useNotebookNavStore = create<NotebookNavState>((set) => ({
  pendingSelection: null,
  requestNotebookNote(target) {
    set({ pendingSelection: target });
  },
  clearPendingSelection() {
    set({ pendingSelection: null });
  },
}));
