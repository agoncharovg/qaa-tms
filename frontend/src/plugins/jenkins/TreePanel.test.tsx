import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const agentClientMock = vi.hoisted(() => ({
  getJenkinsBuilds: vi.fn(),
  getJenkinsScope: vi.fn(),
  getJenkinsTree: vi.fn(),
}));

const backendClientMock = vi.hoisted(() => ({
  getJenkinsBuildsCache: vi.fn(),
  getJenkinsTreeCache: vi.fn(),
  putJenkinsBuildsCache: vi.fn(),
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

import { PluginId, TabId } from "@/constants";
import { TreePanel } from "@/plugins/jenkins/TreePanel";
import { resetAuthStoreState, useAuthStore } from "@/store/authStore";
import { resetJenkinsStoreState, useJenkinsStore } from "@/plugins/jenkins/jenkinsStore";
import { renderWithProviders } from "@/test/render";
import { resetUiStoreState, useUiStore } from "@/store/uiStore";

const openMock = vi.fn();
const BUILD_TIMESTAMP_RECENT = 1723888800000;
const BUILD_TIMESTAMP_OLDER = 1723888680000;
const BUILD_TIMESTAMP_RUNNING = 1723888500000;

function setActiveTreeTab(): void {
  useUiStore.setState((state) => ({
    ...state,
    tabsByPlugin: {
      ...state.tabsByPlugin,
      [PluginId.JENKINS]: {
        activeTabId: TabId.JENKINS_TREE,
        tabIds: [TabId.JENKINS_TREE],
      },
    },
  }));
}

function buildTreeRoots() {
  return [
    {
      builds: [],
      children: [
        {
          builds: [
            {
              allureUrl: "https://jenkins.p.gc.onl/job/.QAA/job/E2E/job/PREPROD/job/Smoke/42/allure/",
              building: false,
              durationMs: 120000,
              number: 42,
              result: "SUCCESS",
              timestamp: BUILD_TIMESTAMP_RECENT,
              url: "https://jenkins.p.gc.onl/job/.QAA/job/E2E/job/PREPROD/job/Smoke/42/",
            },
            {
              allureUrl: "https://jenkins.p.gc.onl/job/.QAA/job/E2E/job/PREPROD/job/Smoke/41/allure/",
              building: false,
              durationMs: 118000,
              number: 41,
              result: "FAILURE",
              timestamp: BUILD_TIMESTAMP_OLDER,
              url: "https://jenkins.p.gc.onl/job/.QAA/job/E2E/job/PREPROD/job/Smoke/41/",
            },
            {
              allureUrl: "https://jenkins.p.gc.onl/job/.QAA/job/E2E/job/PREPROD/job/Smoke/40/allure/",
              building: true,
              durationMs: 30000,
              number: 40,
              result: null,
              timestamp: BUILD_TIMESTAMP_RUNNING,
              url: "https://jenkins.p.gc.onl/job/.QAA/job/E2E/job/PREPROD/job/Smoke/40/",
            },
          ],
          children: [],
          color: "blue",
          kind: "pipeline",
          name: "Smoke",
          scheduled: true,
          path: "job/.QAA/job/E2E/job/PREPROD/job/Smoke",
          status: "passed",
          url: "https://jenkins.p.gc.onl/job/.QAA/job/E2E/job/PREPROD/job/Smoke/",
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

function buildScope() {
  return {
    historyLimit: 8,
    rootFolders: ["PREPROD", "PROD"],
    rootPath: "job/.QAA/job/E2E",
    signature: "scope-1234",
    treeDepth: 5,
  };
}

describe("TreePanel", () => {
  beforeEach(() => {
    agentClientMock.getJenkinsBuilds.mockReset();
    agentClientMock.getJenkinsScope.mockReset();
    agentClientMock.getJenkinsTree.mockReset();
    backendClientMock.getJenkinsBuildsCache.mockReset();
    backendClientMock.getJenkinsTreeCache.mockReset();
    backendClientMock.putJenkinsBuildsCache.mockReset();
    backendClientMock.putJenkinsTreeCache.mockReset();
    openMock.mockReset();
    localStorage.clear();
    resetAuthStoreState();
    resetJenkinsStoreState();
    resetUiStoreState();
    setActiveTreeTab();
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

  it("renders cached strips without per-pipeline build calls, supports pinning, and opens Jenkins pages", async () => {
    const user = userEvent.setup();

    agentClientMock.getJenkinsScope.mockResolvedValue(buildScope());
    backendClientMock.getJenkinsTreeCache.mockResolvedValue({
      fetchedAt: "2026-08-17T10:00:00Z",
      refreshLease: null,
      roots: buildTreeRoots(),
      signature: "scope-1234",
      stale: false,
    });
    backendClientMock.getJenkinsBuildsCache.mockResolvedValue({
      builds: [],
      fetchedAt: null,
      path: "job/.QAA/job/E2E/job/PREPROD/job/Smoke",
      refreshLease: null,
      signature: "scope-1234",
      stale: true,
    });

    renderWithProviders(<TreePanel agentPort={47600} />);

    expect(await screen.findByText("PREPROD")).toBeInTheDocument();
    expect(await screen.findByText("Smoke")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Build history" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "#42: SUCCESS" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "#41: FAILURE" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "#40: Running" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Runs on a schedule" })).toBeInTheDocument();
    expect(agentClientMock.getJenkinsBuilds).not.toHaveBeenCalled();
    expect(agentClientMock.getJenkinsTree).not.toHaveBeenCalled();

    const [folderPinButton, pipelinePinButton] = screen.getAllByRole("button", { name: "Pin to board" });

    await user.click(folderPinButton);
    expect(useJenkinsStore.getState().pinnedPaths).toEqual(["job/.QAA/job/E2E/job/PREPROD"]);
    expect(folderPinButton).toHaveAttribute("aria-label", "Unpin from board");

    await user.click(pipelinePinButton);
    expect(useJenkinsStore.getState().pinnedPaths).toEqual([
      "job/.QAA/job/E2E/job/PREPROD",
      "job/.QAA/job/E2E/job/PREPROD/job/Smoke",
    ]);

    await user.dblClick(screen.getByText("Smoke"));
    expect(openMock).toHaveBeenCalledWith(
      "https://jenkins.p.gc.onl/job/.QAA/job/E2E/job/PREPROD/job/Smoke/",
      "_blank",
      "noopener"
    );
  });

  it("triggers a single tree refresh when the backend returns stale data with a lease", async () => {
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

    renderWithProviders(<TreePanel agentPort={47600} />);

    expect(await screen.findByText("PREPROD")).toBeInTheDocument();

    await waitFor(() => {
      expect(agentClientMock.getJenkinsTree).toHaveBeenCalledTimes(1);
      expect(backendClientMock.putJenkinsTreeCache).toHaveBeenCalledTimes(1);
    });

    expect(backendClientMock.putJenkinsTreeCache).toHaveBeenCalledWith("token-123", {
      refreshLease: "lease-1",
      roots: buildTreeRoots(),
      signature: "scope-1234",
    });
  });

  it("renders stale cached roots without refreshing when the lease belongs to another browser", async () => {
    agentClientMock.getJenkinsScope.mockResolvedValue(buildScope());
    backendClientMock.getJenkinsTreeCache.mockResolvedValue({
      fetchedAt: "2026-08-17T09:45:00Z",
      refreshLease: null,
      roots: buildTreeRoots(),
      signature: "scope-1234",
      stale: true,
    });

    renderWithProviders(<TreePanel agentPort={47600} />);

    expect(await screen.findByText("PREPROD")).toBeInTheDocument();
    expect(agentClientMock.getJenkinsTree).not.toHaveBeenCalled();
    expect(backendClientMock.putJenkinsTreeCache).not.toHaveBeenCalled();
  });

  it("reads expanded builds through the backend cache and falls back to the folded builds initially", async () => {
    const user = userEvent.setup();

    agentClientMock.getJenkinsScope.mockResolvedValue(buildScope());
    backendClientMock.getJenkinsTreeCache.mockResolvedValue({
      fetchedAt: "2026-08-17T10:00:00Z",
      refreshLease: null,
      roots: buildTreeRoots(),
      signature: "scope-1234",
      stale: false,
    });
    backendClientMock.getJenkinsBuildsCache.mockResolvedValue({
      builds: [],
      fetchedAt: null,
      path: "job/.QAA/job/E2E/job/PREPROD/job/Smoke",
      refreshLease: "build-lease-1",
      signature: "scope-1234",
      stale: true,
    });
    agentClientMock.getJenkinsBuilds.mockResolvedValue({
      builds: [
        {
          allureUrl: "https://jenkins.p.gc.onl/job/.QAA/job/E2E/job/PREPROD/job/Smoke/44/allure/",
          building: false,
          durationMs: 121000,
          number: 44,
          result: "SUCCESS",
          timestamp: BUILD_TIMESTAMP_RECENT + 1000,
          url: "https://jenkins.p.gc.onl/job/.QAA/job/E2E/job/PREPROD/job/Smoke/44/",
        },
      ],
    });
    backendClientMock.putJenkinsBuildsCache.mockResolvedValue({
      builds: [
        {
          allureUrl: "https://jenkins.p.gc.onl/job/.QAA/job/E2E/job/PREPROD/job/Smoke/44/allure/",
          building: false,
          durationMs: 121000,
          number: 44,
          result: "SUCCESS",
          timestamp: BUILD_TIMESTAMP_RECENT + 1000,
          url: "https://jenkins.p.gc.onl/job/.QAA/job/E2E/job/PREPROD/job/Smoke/44/",
        },
      ],
      fetchedAt: "2026-08-17T10:01:00Z",
      path: "job/.QAA/job/E2E/job/PREPROD/job/Smoke",
      refreshLease: null,
      signature: "scope-1234",
      stale: false,
    });

    renderWithProviders(<TreePanel agentPort={47600} />);

    const pipelineRow = await screen.findByText("Smoke");
    await user.click(pipelineRow);

    expect(await screen.findByText("#42")).toBeInTheDocument();

    await waitFor(() => {
      expect(backendClientMock.getJenkinsBuildsCache).toHaveBeenCalledWith(
        "token-123",
        "scope-1234",
        "job/.QAA/job/E2E/job/PREPROD/job/Smoke",
        expect.anything()
      );
      expect(agentClientMock.getJenkinsBuilds).toHaveBeenCalledTimes(1);
      expect(backendClientMock.putJenkinsBuildsCache).toHaveBeenCalledTimes(1);
    });
  });
});
