import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
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

function expectInitialRunsRequest(): void {
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
}

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
        qaa_generator_token_set: false,
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

  it("keeps filters visible while the runs table is loading", () => {
    listQaaRunsMock.mockReset();
    listQaaRunsMock.mockReturnValue(new Promise(() => {}));

    renderWithProviders(<RunsPanel />);

    expect(screen.getByRole("textbox", { name: /Jira key/i })).toBeInTheDocument();
    expect(screen.getByText("Loading QAA runs.")).toBeInTheDocument();
  });

  it("keeps partial jira filtering local and only queries the backend for full keys", async () => {
    const user = userEvent.setup();

    renderWithProviders(<RunsPanel />);

    expect(await screen.findByText("QAA-123")).toBeInTheDocument();
    expectInitialRunsRequest();

    const jiraKeyInput = screen.getByRole("textbox", { name: /Jira key/i });
    await user.click(jiraKeyInput);
    await user.type(jiraKeyInput, "123");

    expect(jiraKeyInput).toHaveFocus();
    await waitFor(() => {
      expect(listQaaRunsMock).toHaveBeenCalledTimes(1);
    });

    await user.clear(jiraKeyInput);
    await user.type(jiraKeyInput, "QAA-123");

    await waitFor(() => {
      expect(listQaaRunsMock).toHaveBeenLastCalledWith(
        "token-123",
        {
          createdFrom: undefined,
          createdTo: undefined,
          cursor: null,
          effectiveActor: undefined,
          jiraKey: "QAA-123",
          limit: 20,
          status: undefined,
        },
        expect.anything()
      );
    });
  });

  it("advances with the cursor and opens a run in Live", async () => {
    const user = userEvent.setup();

    renderWithProviders(<RunsPanel />);

    expect(await screen.findByText("QAA-123")).toBeInTheDocument();
    expectInitialRunsRequest();

    await user.click(await screen.findByRole("button", { name: "Next" }));
    await waitFor(() => {
      expect(listQaaRunsMock).toHaveBeenLastCalledWith(
        "token-123",
        {
          createdFrom: undefined,
          createdTo: undefined,
          cursor: "cursor-2",
          effectiveActor: undefined,
          jiraKey: undefined,
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
