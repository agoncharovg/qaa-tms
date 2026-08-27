import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "@mantine/core";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const backendClientMock = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getOperation: vi.fn(),
  getOperationReplay: vi.fn(),
  listOperations: vi.fn(),
  login: vi.fn(),
}));

const agentClientMock = vi.hoisted(() => ({
  cancelJob: vi.fn(),
  deploy: vi.fn(),
  getJob: vi.fn(),
  streamJob: vi.fn(),
}));

const getPreflightMock = vi.hoisted(() => vi.fn());

vi.mock("@/api/backendClient", () => ({
  backendClient: backendClientMock,
}));

vi.mock("@/api/agentClient", () => ({
  agentClient: agentClientMock,
  getPreflight: getPreflightMock,
}));

import { Workspace } from "@/app/layout/Workspace";
import { PluginId, TabId } from "@/constants";
import { renderWithProviders } from "@/test/render";
import { resetAuthStoreState, useAuthStore } from "@/store/authStore";
import { resetStagingsStoreState } from "@/store/stagingsStore";
import { resetUiStoreState, useUiStore } from "@/store/uiStore";

function seedAuthAndTabs(): void {
  useAuthStore.setState({
    currentUser: {
      auto_login: false,
      created_at: "2026-08-09T00:00:00Z",
      display_name: "Test User",
      enabled_plugins: ["stagings"],
      effective_permissions: ["stagings.read"],
      qaa_generator_token_set: false,
      id: 2,
      is_admin: false,
      updated_at: "2026-08-09T00:00:00Z",
      username: "test",
    },
    token: "token-123",
  });
  useUiStore.setState((state) => ({
    ...state,
    activeWorkspaceTabId: TabId.STAGINGS_HISTORY,
    tabsByPlugin: {
      ...state.tabsByPlugin,
      [PluginId.STAGINGS]: {
        activeTabId: TabId.STAGINGS_HISTORY,
        tabIds: [TabId.STAGINGS_HISTORY, TabId.STAGINGS_DEPLOY],
      },
    },
    workspaceTabIds: [TabId.STAGINGS_HISTORY, TabId.STAGINGS_DEPLOY],
  }));
}

describe("History panel", () => {
  beforeEach(() => {
    backendClientMock.getCurrentUser.mockReset();
    backendClientMock.getOperation.mockReset();
    backendClientMock.getOperationReplay.mockReset();
    backendClientMock.listOperations.mockReset();
    backendClientMock.login.mockReset();
    agentClientMock.cancelJob.mockReset();
    agentClientMock.deploy.mockReset();
    agentClientMock.getJob.mockReset();
    agentClientMock.streamJob.mockReset();
    getPreflightMock.mockReset();
    localStorage.clear();
    resetAuthStoreState();
    resetStagingsStoreState();
    resetUiStoreState();
    seedAuthAndTabs();

    getPreflightMock.mockResolvedValue({
      agent: {
        app: "qaa-tms-agent",
        os: "linux",
        stagingsInstalled: true,
        stagingsSha: "abc123",
        version: "0.1.0",
      },
      checklist: [],
      detected: true,
      port: 47600,
    });
  });

  it("renders history rows and prefills the deploy form from replay", async () => {
    const user = userEvent.setup();

    backendClientMock.listOperations.mockResolvedValue({
      items: [
        {
          agent_host: "laptop",
          agent_version: "0.1.0",
          created_at: "2026-08-09T10:00:00Z",
          exit_code: 0,
          finished_at: "2026-08-09T10:05:00Z",
          id: "00000000-0000-0000-0000-000000000001",
          ns: "qa-replay",
          recipe: {
            flags: {
              dryRun: false,
              full: true,
              noSync: false,
              stage: 3,
            },
            images: {
              "iam-api": "sha-777",
            },
            product: null,
            services: ["iam-api", "billing-api"],
            suites: [],
          },
          stagings_sha: "abc123",
          started_at: "2026-08-09T10:00:00Z",
          status: "success",
          type: "deploy",
          user_id: 2,
        },
      ],
      limit: 20,
      offset: 0,
      total: 1,
    });
    backendClientMock.getOperation.mockResolvedValue({
      agent_host: "laptop",
      agent_version: "0.1.0",
      created_at: "2026-08-09T10:00:00Z",
      exit_code: 0,
      finished_at: "2026-08-09T10:05:00Z",
      id: "00000000-0000-0000-0000-000000000001",
      log: "deploy log",
      ns: "qa-replay",
      recipe: {
        flags: {
          dryRun: false,
          full: true,
          noSync: false,
          stage: 3,
        },
        images: {
          "iam-api": "sha-777",
        },
        product: null,
        services: ["iam-api", "billing-api"],
        suites: [],
      },
      stagings_sha: "abc123",
      started_at: "2026-08-09T10:00:00Z",
      status: "success",
      type: "deploy",
      user_id: 2,
    });
    backendClientMock.getOperationReplay.mockResolvedValue({
      id: "00000000-0000-0000-0000-000000000001",
      ns: "qa-replay",
      recipe: {
        flags: {
          dryRun: false,
          full: true,
          noSync: false,
          stage: 3,
        },
        images: {
          "iam-api": "sha-777",
        },
        product: null,
        services: ["iam-api", "billing-api"],
        suites: [],
      },
      type: "deploy",
    });

    renderWithProviders(
      <AppShell>
        <Workspace />
      </AppShell>
    );

    expect(await screen.findByText("qa-replay")).toBeInTheDocument();

    await user.click(screen.getByText("qa-replay"));

    const replayButton = await screen.findByRole("button", { name: "Replay" });
    await user.click(replayButton);

    expect(await screen.findByRole("heading", { name: "Deploy namespace" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: /Namespace/i })).toHaveValue("qa-replay");
      expect(screen.getByRole("textbox", { name: /Services/i })).toHaveValue("iam-api, billing-api");
      expect(screen.getByRole("textbox", { name: /^Service$/i })).toHaveValue("iam-api");
      expect(screen.getByRole("textbox", { name: /Tag/i })).toHaveValue("sha-777");
    });
  });

  it("hides Replay for non-deploy operations", async () => {
    const user = userEvent.setup();

    backendClientMock.listOperations.mockResolvedValue({
      items: [
        {
          agent_host: "laptop",
          agent_version: "0.1.0",
          created_at: "2026-08-09T10:00:00Z",
          exit_code: 0,
          finished_at: "2026-08-09T10:05:00Z",
          id: "00000000-0000-0000-0000-000000000002",
          ns: null,
          recipe: {
            flags: {
              apply: false,
              pull: true,
              service: "iam-api",
              verbose: true,
            },
            images: {},
            product: null,
            services: [],
            suites: [],
          },
          stagings_sha: "abc123",
          started_at: "2026-08-09T10:00:00Z",
          status: "success",
          type: "sync",
          user_id: 2,
        },
      ],
      limit: 20,
      offset: 0,
      total: 1,
    });
    backendClientMock.getOperation.mockResolvedValue({
      agent_host: "laptop",
      agent_version: "0.1.0",
      created_at: "2026-08-09T10:00:00Z",
      exit_code: 0,
      finished_at: "2026-08-09T10:05:00Z",
      id: "00000000-0000-0000-0000-000000000002",
      log: "sync log",
      ns: null,
      recipe: {
        flags: {
          apply: false,
          pull: true,
          service: "iam-api",
          verbose: true,
        },
        images: {},
        product: null,
        services: [],
        suites: [],
      },
      stagings_sha: "abc123",
      started_at: "2026-08-09T10:00:00Z",
      status: "success",
      type: "sync",
      user_id: 2,
    });

    renderWithProviders(
      <AppShell>
        <Workspace />
      </AppShell>
    );

    expect(await screen.findByText("Sync")).toBeInTheDocument();
    await user.click(screen.getByText("Sync"));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Replay" })).not.toBeInTheDocument();
    });
  });
});
