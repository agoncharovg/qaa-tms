import { beforeEach, describe, expect, it } from "vitest";

import { resetQaaGeneratorStoreState, useQaaGeneratorStore } from "@/plugins/qaa-generator/qaaStore";

describe("useQaaGeneratorStore startRun", () => {
  beforeEach(() => {
    resetQaaGeneratorStoreState();
  });

  it("keeps existing live state when reopening the same run", () => {
    useQaaGeneratorStore.getState().startRun("run-123");
    useQaaGeneratorStore.getState().reduceLiveRun({
      event: {
        event_type: "RUN_QUEUED",
        message: null,
        payload: null,
        sequence: 1,
      },
      type: "append-event",
    });
    useQaaGeneratorStore.getState().reduceLiveRun({
      message: "Failed to fetch",
      type: "set-stream-error",
    });

    const firstState = useQaaGeneratorStore.getState().liveRun;

    useQaaGeneratorStore.getState().startRun("run-123");

    const secondState = useQaaGeneratorStore.getState().liveRun;
    expect(secondState).toBe(firstState);
    expect(secondState?.events).toHaveLength(1);
    expect(secondState?.streamError).toBe("Failed to fetch");
  });

  it("replaces live state when opening a different run", () => {
    useQaaGeneratorStore.getState().startRun("run-123");
    useQaaGeneratorStore.getState().reduceLiveRun({
      event: {
        event_type: "RUN_QUEUED",
        message: null,
        payload: null,
        sequence: 1,
      },
      type: "append-event",
    });

    useQaaGeneratorStore.getState().startRun("run-456");

    const liveRun = useQaaGeneratorStore.getState().liveRun;
    expect(liveRun?.runId).toBe("run-456");
    expect(liveRun?.events).toEqual([]);
    expect(liveRun?.streamError).toBeNull();
  });
});
