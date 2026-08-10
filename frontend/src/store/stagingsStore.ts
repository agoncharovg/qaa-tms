import { create } from "zustand";

import type { OperationReplay } from "@/api/types";
import {
  buildDeployRequestFromDraft,
  createDeployDraftFromReplay,
  createEmptyDeployDraft,
  type DeployDraft,
} from "@/plugins/stagings/deployDraft";
import {
  createLiveJobState,
  reduceLiveJobState,
  type LiveJobAction,
  type LiveJobState,
} from "@/plugins/stagings/liveJobState";

interface StagingsState {
  clearLiveJob: () => void;
  deployDraft: DeployDraft;
  liveJob: LiveJobState | null;
  prefillDeployDraft: (replay: Pick<OperationReplay, "ns" | "recipe">) => void;
  reduceLiveJob: (action: LiveJobAction) => void;
  resetDeployDraft: () => void;
  selectedOperationId: string | null;
  setDeployDraft: (draft: DeployDraft) => void;
  setSelectedOperationId: (operationId: string | null) => void;
  startLiveJob: (jobId: string, opId: string) => void;
}

const initialDeployDraft = createEmptyDeployDraft();

export const useStagingsStore = create<StagingsState>()((set) => ({
  clearLiveJob() {
    set({
      liveJob: null,
    });
  },

  deployDraft: initialDeployDraft,
  liveJob: null,

  prefillDeployDraft(replay) {
    set({
      deployDraft: createDeployDraftFromReplay(replay),
    });
  },

  reduceLiveJob(action) {
    set((state) => ({
      liveJob: state.liveJob ? reduceLiveJobState(state.liveJob, action) : state.liveJob,
    }));
  },

  resetDeployDraft() {
    set({
      deployDraft: createEmptyDeployDraft(),
    });
  },

  selectedOperationId: null,

  setDeployDraft(draft) {
    set({
      deployDraft: draft,
    });
  },

  setSelectedOperationId(operationId) {
    set({
      selectedOperationId: operationId,
    });
  },

  startLiveJob(jobId, opId) {
    set({
      liveJob: createLiveJobState(jobId, opId),
    });
  },
}));

export function resetStagingsStoreState(): void {
  useStagingsStore.setState({
    deployDraft: createEmptyDeployDraft(),
    liveJob: null,
    selectedOperationId: null,
  });
}

export { buildDeployRequestFromDraft };
