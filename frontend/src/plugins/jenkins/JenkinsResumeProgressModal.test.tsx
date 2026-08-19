import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { JenkinsResumeRunRead } from "@/api/types";
import { JenkinsResumeItemState, JenkinsResumeRunStatus } from "@/constants";
import { JenkinsResumeProgressModal } from "@/plugins/jenkins/JenkinsResumeProgressModal";
import { renderWithProviders } from "@/test/render";

function buildResumeRun(
  status: JenkinsResumeRunRead["status"] = JenkinsResumeRunStatus.RUNNING,
  restartPipelines = true
): JenkinsResumeRunRead {
  return {
    cancelledBy: status === JenkinsResumeRunStatus.CANCELLED ? "admin" : null,
    createdAt: "2026-08-18T10:00:00Z",
    createdBy: "test",
    currentName: status === JenkinsResumeRunStatus.RUNNING ? "Smoke" : null,
    currentPath:
      status === JenkinsResumeRunStatus.RUNNING
        ? "job/.QAA/job/E2E/job/PREPROD/job/Smoke"
        : null,
    errorCount: status === JenkinsResumeRunStatus.DONE ? 1 : 0,
    finishedAt: status === JenkinsResumeRunStatus.RUNNING ? null : "2026-08-18T10:05:00Z",
    freezeId: "freeze-1",
    id: "run-1",
    restartPipelines,
    items: [
      {
        fullName: ".QAA/E2E/PREPROD/Smoke",
        name: "Smoke",
        path: "job/.QAA/job/E2E/job/PREPROD/job/Smoke",
        reason: null,
        scheduled: false,
        state: JenkinsResumeItemState.STARTED,
      },
      {
        fullName: ".QAA/E2E/PREPROD/Disabled",
        name: "Disabled",
        path: "job/.QAA/job/E2E/job/PREPROD/job/Disabled",
        reason: "Disabled before the freeze",
        scheduled: false,
        state: JenkinsResumeItemState.SKIPPED,
      },
    ],
    signature: "scope-1234",
    skippedCount: 1,
    stale: false,
    startedCount: 1,
    status,
    total: 2,
  };
}

describe("JenkinsResumeProgressModal", () => {
  it("renders the running progress details and blocks local dismissal", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();

    renderWithProviders(
      <JenkinsResumeProgressModal onCancel={onCancel} onClose={vi.fn()} run={buildResumeRun()} />
    );

    expect(screen.getByText(/Started by test/)).toBeInTheDocument();
    expect(screen.getAllByText("Smoke")).toHaveLength(2);
    expect(screen.getByText("1/2 started")).toBeInTheDocument();
    expect(screen.getByText("Disabled before the freeze")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("renders enabled wording when restart is disabled", () => {
    renderWithProviders(
      <JenkinsResumeProgressModal
        onCancel={vi.fn()}
        onClose={vi.fn()}
        run={buildResumeRun(JenkinsResumeRunStatus.RUNNING, false)}
      />
    );

    expect(screen.getByText("Enabling now")).toBeInTheDocument();
    expect(screen.getByText("1/2 enabled")).toBeInTheDocument();
    expect(screen.getAllByText("Enabled")).not.toHaveLength(0);
  });

  it("renders the terminal summary with a local close action", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    renderWithProviders(
      <JenkinsResumeProgressModal
        onCancel={vi.fn()}
        onClose={onClose}
        run={buildResumeRun(JenkinsResumeRunStatus.DONE)}
      />
    );

    expect(screen.getByText("Resume completed.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
