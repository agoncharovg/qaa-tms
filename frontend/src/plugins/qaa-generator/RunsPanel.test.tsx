import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const listQaaRunsMock = vi.hoisted(() => vi.fn());
const getQaaRunMock = vi.hoisted(() => vi.fn());
const getQaaRunArtifactsMock = vi.hoisted(() => vi.fn());
const startRunMock = vi.hoisted(() => vi.fn());

vi.mock("@/api/backendClient", () => ({
  backendClient: {
    getQaaRun: getQaaRunMock,
    getQaaRunArtifacts: getQaaRunArtifactsMock,
    listQaaRuns: listQaaRunsMock,
  },
}));

vi.mock("@/plugins/qaa-generator/useQaaRunLive", () => ({
  useQaaRunLive: () => ({
    startRun: startRunMock,
  }),
}));

import { RunsPanel } from "@/plugins/qaa-generator/RunsPanel";
import { PluginId, TabId } from "@/constants";
import { renderWithProviders } from "@/test/render";
import { resetAuthStoreState, useAuthStore } from "@/store/authStore";
import { resetUiStoreState, useUiStore } from "@/store/uiStore";

const QAA_ENABLED_PLUGINS = [PluginId.QAA_GENERATOR];
const FIRST_QAA_RUNS_PAGE = {
  items: [
    {
      created_at: "2026-08-11T10:00:00Z",
      effective_actor: "email:user@example.com",
      jira_key: "QAA-123",
      run_id: "run-123",
      status: "running",
      updated_at: "2026-08-11T10:01:00Z",
    },
  ],
  next_cursor: "cursor-2",
} as const;
const SECOND_QAA_RUNS_PAGE = {
  items: [
    {
      created_at: "2026-08-11T10:05:00Z",
      effective_actor: "email:user@example.com",
      jira_key: "QAA-456",
      run_id: "run-456",
      status: "paused",
      updated_at: "2026-08-11T10:06:00Z",
    },
  ],
  next_cursor: null,
} as const;

describe("RunsPanel", () => {
  beforeEach(() => {
    listQaaRunsMock.mockReset();
    getQaaRunMock.mockReset();
    getQaaRunArtifactsMock.mockReset();
    startRunMock.mockReset();
    localStorage.clear();
    resetAuthStoreState();
    resetUiStoreState();

    useAuthStore.setState({
      currentUser: {
        auto_login: false,
        created_at: "2026-08-11T00:00:00Z",
        display_name: "QAA User",
        enabled_plugins: QAA_ENABLED_PLUGINS,
        id: 3,
        is_admin: false,
        updated_at: "2026-08-11T00:00:00Z",
        username: "user@example.com",
      },
      token: "token-123",
    });

    listQaaRunsMock.mockImplementation(
      (_token: string, params: { cursor?: string | null }) => {
        if (params.cursor === "cursor-2") {
          return Promise.resolve(SECOND_QAA_RUNS_PAGE);
        }

        return Promise.resolve(FIRST_QAA_RUNS_PAGE);
      }
    );
    getQaaRunMock.mockImplementation((_token: string, runId: string) => {
      return Promise.resolve({
        created_at: "2026-08-11T10:00:00Z",
        effective_actor: "email:user@example.com",
        jira_key: runId === "run-456" ? "QAA-456" : "QAA-123",
        run_id: runId,
        status: runId === "run-456" ? "paused" : "running",
        updated_at: "2026-08-11T10:01:00Z",
      });
    });
    getQaaRunArtifactsMock.mockResolvedValue({
      archive: { filename: "run-123.zip" },
      pr_url: "https://example.invalid/pr/123",
      report_text: "Generated report",
    });
  });

  it("passes filters, advances with the cursor, and opens a run in Live", async () => {
    const user = userEvent.setup();

    renderWithProviders(<RunsPanel />);

    expect(await screen.findByText("QAA-123")).toBeInTheDocument();
    expect(listQaaRunsMock).toHaveBeenCalledWith(
      "token-123",
      {
        createdFrom: undefined,
        createdTo: undefined,
        cursor: null,
        effectiveActor: undefined,
        jiraKey: undefined,
        limit: 20,
        status: undefined,
      },
      expect.anything()
    );

    fireEvent.change(screen.getByRole("textbox", { name: /Jira key/i }), {
      target: { value: "QAA" },
    });
    await waitFor(() => {
      expect(listQaaRunsMock).toHaveBeenLastCalledWith(
        "token-123",
        {
          createdFrom: undefined,
          createdTo: undefined,
          cursor: null,
          effectiveActor: undefined,
          jiraKey: "QAA",
          limit: 20,
          status: undefined,
        },
        expect.anything()
      );
    });

    await user.click(await screen.findByRole("button", { name: "Next" }));
    await waitFor(() => {
      expect(listQaaRunsMock).toHaveBeenLastCalledWith(
        "token-123",
        {
          createdFrom: undefined,
          createdTo: undefined,
          cursor: "cursor-2",
          effectiveActor: undefined,
          jiraKey: "QAA",
          limit: 20,
          status: undefined,
        },
        expect.anything()
      );
    });

    await user.click(screen.getByText("run-456"));
    const openInLiveButton = await screen.findByRole("button", { name: "Open in Live" });
    await user.click(openInLiveButton);

    expect(startRunMock).toHaveBeenCalledWith("run-456");
    expect(useUiStore.getState().tabsByPlugin[PluginId.QAA_GENERATOR].activeTabId).toBe(
      TabId.QAA_LIVE
    );
  });
});
