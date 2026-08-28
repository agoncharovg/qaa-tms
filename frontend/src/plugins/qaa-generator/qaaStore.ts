import { create } from "zustand";

import {
  createQaaLiveRunState,
  reduceQaaLiveRunState,
  type QaaLiveRunAction,
  type QaaLiveRunState,
} from "@/plugins/qaa-generator/runState";

interface QaaGeneratorState {
  clearLiveRun: () => void;
  liveRun: QaaLiveRunState | null;
  reduceLiveRun: (action: QaaLiveRunAction) => void;
  startRun: (runId: string) => void;
}

export const useQaaGeneratorStore = create<QaaGeneratorState>()((set) => ({
  clearLiveRun() {
    set({
      liveRun: null,
    });
  },

  liveRun: null,

  reduceLiveRun(action) {
    set((state) => ({
      liveRun: state.liveRun ? reduceQaaLiveRunState(state.liveRun, action) : state.liveRun,
    }));
  },

  startRun(runId) {
    set((state) => ({
      liveRun:
        state.liveRun?.runId === runId
          ? state.liveRun
          : createQaaLiveRunState(runId),
    }));
  },
}));

export function resetQaaGeneratorStoreState(): void {
  useQaaGeneratorStore.setState({
    liveRun: null,
  });
}
