import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const agentClientMock = vi.hoisted(() => ({
  getJenkinsScope: vi.fn(),
  getJenkinsTree: vi.fn(),
}));

const backendClientMock = vi.hoisted(() => ({
  getJenkinsTreeCache: vi.fn(),
  putJenkinsTreeCache: vi.fn(),
}));

vi.mock("@/api/agentClient", () => ({
  AgentRequestError: class AgentRequestError extends Error {
    status: number;

    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
  agentClient: agentClientMock,
}));

vi.mock("@/api/backendClient", () => ({
  backendClient: backendClientMock,
}));

import { BoardPanel } from "@/plugins/jenkins/BoardPanel";
import { PluginId, TabId } from "@/constants";
import { resetAuthStoreState, useAuthStore } from "@/store/authStore";
import { resetJenkinsStoreState, useJenkinsStore } from "@/plugins/jenkins/jenkinsStore";
import { renderWithProviders } from "@/test/render";
import { resetUiStoreState, useUiStore } from "@/store/uiStore";

const openMock = vi.fn();

function setActiveBoardTab(): void {
  useUiStore.setState((state) => ({
    ...state,
    tabsByPlugin: {
      ...state.tabsByPlugin,
      [PluginId.JENKINS]: {
        activeTabId: TabId.JENKINS_BOARD,
        tabIds: [TabId.JENKINS_BOARD],
      },
    },
  }));
}

function buildScope() {
  return {
    historyLimit: 8,
    rootFolders: ["PREPROD", "PROD"],
    rootPath: "job/.QAA/job/E2E",
    signature: "scope-1234",
    treeDepth: 5,
  };
}

function buildTreeRoots() {
  return [
    {
      builds: [],
      children: [
        {
          builds: [],
          children: [],
          color: "blue",
          kind: "pipeline",
          name: "Smoke",
          path: "job/.QAA/job/E2E/job/PREPROD/job/Smoke",
          status: "passed",
          url: "https://jenkins.p.gc.onl/job/.QAA/job/E2E/job/PREPROD/job/Smoke/",
        },
        {
          builds: [],
          children: [
            {
              builds: [],
              children: [],
              color: "red",
              kind: "pipeline",
              name: "Nested failure",
              path: "job/.QAA/job/E2E/job/PREPROD/job/Nested/job/Failure",
              status: "failed",
              url: "https://jenkins.p.gc.onl/job/.QAA/job/E2E/job/PREPROD/job/Nested/job/Failure/",
            },
            {
              builds: [],
              children: [],
              color: "yellow",
              kind: "pipeline",
              name: "Nested stuck",
              path: "job/.QAA/job/E2E/job/PREPROD/job/Nested/job/Stuck",
              status: "stuck",
              url: "https://jenkins.p.gc.onl/job/.QAA/job/E2E/job/PREPROD/job/Nested/job/Stuck/",
            },
            {
              builds: [],
              children: [],
              color: "notbuilt",
              kind: "pipeline",
              name: "Nested gray",
              path: "job/.QAA/job/E2E/job/PREPROD/job/Nested/job/Gray",
              status: "notbuilt",
              url: "https://jenkins.p.gc.onl/job/.QAA/job/E2E/job/PREPROD/job/Nested/job/Gray/",
            },
            {
              builds: [],
              children: [],
              color: "blue_anime",
              kind: "pipeline",
              name: "Nested running",
              path: "job/.QAA/job/E2E/job/PREPROD/job/Nested/job/Running",
              status: "running",
              url: "https://jenkins.p.gc.onl/job/.QAA/job/E2E/job/PREPROD/job/Nested/job/Running/",
            },
          ],
          color: null,
          kind: "folder",
          name: "Nested",
          path: "job/.QAA/job/E2E/job/PREPROD/job/Nested",
          status: null,
          url: "https://jenkins.p.gc.onl/job/.QAA/job/E2E/job/PREPROD/job/Nested/",
        },
      ],
      color: null,
      kind: "folder",
      name: "PREPROD",
      path: "job/.QAA/job/E2E/job/PREPROD",
      status: null,
      url: "https://jenkins.p.gc.onl/job/.QAA/job/E2E/job/PREPROD/",
    },
  ];
}

describe("BoardPanel", () => {
  beforeEach(() => {
    agentClientMock.getJenkinsScope.mockReset();
    agentClientMock.getJenkinsTree.mockReset();
    backendClientMock.getJenkinsTreeCache.mockReset();
    backendClientMock.putJenkinsTreeCache.mockReset();
    openMock.mockReset();
    localStorage.clear();
    resetAuthStoreState();
    resetJenkinsStoreState();
    resetUiStoreState();
    setActiveBoardTab();
    Object.defineProperty(window, "open", {
      configurable: true,
      value: openMock,
    });

    useAuthStore.setState({
      currentUser: {
        auto_login: false,
        created_at: "2026-08-12T00:00:00Z",
        display_name: "Test User",
        enabled_plugins: ["jenkins"],
        qaa_generator_token_set: false,
        id: 2,
        is_admin: false,
        updated_at: "2026-08-12T00:00:00Z",
        username: "test",
      },
      token: "token-123",
    });
  });

  it("renders recursive status counts from the shared cache and opens the folder on double click", async () => {
    const user = userEvent.setup();

    useJenkinsStore.setState({
      pinnedPaths: ["job/.QAA/job/E2E/job/PREPROD"],
    });
    agentClientMock.getJenkinsScope.mockResolvedValue(buildScope());
    backendClientMock.getJenkinsTreeCache.mockResolvedValue({
      fetchedAt: "2026-08-17T10:00:00Z",
      refreshLease: null,
      roots: buildTreeRoots(),
      signature: "scope-1234",
      stale: false,
    });

    renderWithProviders(<BoardPanel agentPort={47600} />);

    expect(await screen.findByText("PREPROD")).toBeInTheDocument();
    expect(screen.getByText("Passed 1")).toBeInTheDocument();
    expect(screen.getByText("Failed 1")).toBeInTheDocument();
    expect(screen.getByText("Gray 1")).toBeInTheDocument();
    expect(screen.getByText("Stuck 1")).toBeInTheDocument();
    expect(screen.getByText("Running 1")).toBeInTheDocument();
    expect(agentClientMock.getJenkinsTree).not.toHaveBeenCalled();

    await user.click(screen.getByText("PREPROD"));
    expect(await screen.findByText("Nested failure")).toBeInTheDocument();

    await user.dblClick(screen.getByText("PREPROD"));
    expect(openMock).toHaveBeenCalledWith(
      "https://jenkins.p.gc.onl/job/.QAA/job/E2E/job/PREPROD/",
      "_blank",
      "noopener"
    );
  });

  it("refreshes the shared cache once when the backend returns stale data with a lease", async () => {
    useJenkinsStore.setState({
      pinnedPaths: ["job/.QAA/job/E2E/job/PREPROD"],
    });
    agentClientMock.getJenkinsScope.mockResolvedValue(buildScope());
    backendClientMock.getJenkinsTreeCache.mockResolvedValue({
      fetchedAt: "2026-08-17T09:45:00Z",
      refreshLease: "lease-1",
      roots: buildTreeRoots(),
      signature: "scope-1234",
      stale: true,
    });
    agentClientMock.getJenkinsTree.mockResolvedValue({
      roots: buildTreeRoots(),
      signature: "scope-1234",
    });
    backendClientMock.putJenkinsTreeCache.mockResolvedValue({
      fetchedAt: "2026-08-17T10:00:00Z",
      refreshLease: null,
      roots: buildTreeRoots(),
      signature: "scope-1234",
      stale: false,
    });

    renderWithProviders(<BoardPanel agentPort={47600} />);

    expect(await screen.findByText("PREPROD")).toBeInTheDocument();

    await waitFor(() => {
      expect(agentClientMock.getJenkinsTree).toHaveBeenCalledTimes(1);
      expect(backendClientMock.putJenkinsTreeCache).toHaveBeenCalledTimes(1);
    });
  });
});
