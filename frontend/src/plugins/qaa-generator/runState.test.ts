import { describe, expect, it } from "vitest";

import type { QaaRunEvent } from "@/api/types";
import { createQaaLiveRunState, reduceQaaLiveRunState } from "@/plugins/qaa-generator/runState";

function buildEvent(sequence: number, eventType: string, message: string | null = null): QaaRunEvent {
  return { event_type: eventType, message, payload: null, sequence };
}

function appendAll(runId: string, events: QaaRunEvent[]) {
  return events.reduce(
    (state, event) => reduceQaaLiveRunState(state, { event, type: "append-event" }),
    createQaaLiveRunState(runId)
  );
}

describe("reduceQaaLiveRunState append-event", () => {
  it("dedupes replayed events by sequence", () => {
    // The external stream replays its full history on every reconnection.
    const first = [buildEvent(1, "RUN_QUEUED"), buildEvent(2, "RUN_STARTING")];
    const state = appendAll("run-1", [...first, ...first, ...first]);

    expect(state.events).toHaveLength(2);
    expect(state.events.map((event) => event.sequence)).toEqual([1, 2]);
  });

  it("keeps events ordered by sequence when frames arrive out of order", () => {
    const state = appendAll("run-1", [
      buildEvent(3, "STAGE_COMPLETED"),
      buildEvent(1, "RUN_QUEUED"),
      buildEvent(2, "STAGE_STARTED"),
    ]);

    expect(state.events.map((event) => event.sequence)).toEqual([1, 2, 3]);
  });

  it("returns the same state reference when a duplicate sequence arrives", () => {
    const state = appendAll("run-1", [buildEvent(1, "RUN_QUEUED")]);
    const next = reduceQaaLiveRunState(state, {
      event: buildEvent(1, "RUN_QUEUED"),
      type: "append-event",
    });

    expect(next).toBe(state);
  });
});
