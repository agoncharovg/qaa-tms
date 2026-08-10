import { describe, expect, it } from "vitest";

import { createLiveJobState, reduceLiveJobState } from "@/plugins/stagings/liveJobState";

describe("reduceLiveJobState", () => {
  it("appends log lines and transitions to terminal status", () => {
    const queuedState = createLiveJobState("job-123", "op-123");
    const withLine = reduceLiveJobState(queuedState, {
      line: "Deploying service iam-api",
      type: "append-line",
    });
    const finishedState = reduceLiveJobState(withLine, {
      terminal: {
        exitCode: 1,
        status: "failed",
        type: "terminal",
      },
      type: "terminal",
    });

    expect(withLine.lines).toEqual(["Deploying service iam-api"]);
    expect(finishedState.status).toBe("failed");
    expect(finishedState.exitCode).toBe(1);
  });
});
