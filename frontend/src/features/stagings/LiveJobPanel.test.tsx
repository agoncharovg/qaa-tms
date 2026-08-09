import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";

import { LiveJobPanel } from "@/features/stagings/LiveJobPanel";
import { createLiveJobState } from "@/features/stagings/liveJobState";
import { JobStatus } from "@/constants";
import { renderWithProviders } from "@/test/render";

describe("LiveJobPanel", () => {
  it("renders streamed lines and the terminal status", () => {
    const liveJob = createLiveJobState("job-123", "op-123");
    liveJob.lines = ["line one", "line two"];
    liveJob.status = JobStatus.SUCCESS;
    liveJob.exitCode = 0;

    renderWithProviders(
      <LiveJobPanel
        cancelPending={false}
        emptyMessage="Nothing yet"
        liveJob={liveJob}
        onCancel={vi.fn()}
        onViewHistory={vi.fn()}
      />
    );

    expect(screen.getByText("Success")).toBeInTheDocument();
    expect(screen.getByText("Exit code: 0")).toBeInTheDocument();
    expect(screen.getByLabelText("Live job output")).toHaveTextContent("line one");
    expect(screen.getByLabelText("Live job output")).toHaveTextContent("line two");
    expect(screen.getByRole("button", { name: "View in history" })).toBeInTheDocument();
  });
});
