import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const agentClientMock = vi.hoisted(() => ({
  getJenkinsTree: vi.fn(),
}));

const discoverAgentMock = vi.hoisted(() => vi.fn());

const backendClientMock = vi.hoisted(() => ({
  getJenkinsFreezes: vi.fn(),
  getJenkinsScope: vi.fn(),
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
  discoverAgent: discoverAgentMock,
}));

vi.mock("@/api/backendClient", () => ({
  backendClient: backendClientMock,
}));

import { BoardPanel } from "@/plugins/jenkins/BoardPanel";
import type { JenkinsBuild } from "@/api/types";
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
    rootGroups: [
      { label: "BE", path: "job/.QAA/job/E2E" },
      { label: "FE", path: "job/.QAA/job/UI_E2E" },
    ],
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
          children: [
            {
              builds: [],
              children: [],
              color: "blue",
              kind: "pipeline",
              name: "Smoke",
              path: "job/.QAA/job/E2E/job/PREPROD/job/Smoke",
              scheduled: false,
              status: "passed",
              synthetic: false,
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
                  scheduled: false,
                  status: "failed",
                  synthetic: false,
                  url: "https://jenkins.p.gc.onl/job/.QAA/job/E2E/job/PREPROD/job/Nested/job/Failure/",
                },
                {
                  builds: [],
                  children: [],
                  color: "yellow",
                  kind: "pipeline",
                  name: "Nested stuck",
                  path: "job/.QAA/job/E2E/job/PREPROD/job/Nested/job/Stuck",
                  scheduled: false,
                  status: "stuck",
                  synthetic: false,
                  url: "https://jenkins.p.gc.onl/job/.QAA/job/E2E/job/PREPROD/job/Nested/job/Stuck/",
                },
                {
                  builds: [],
                  children: [],
                  color: "notbuilt",
                  kind: "pipeline",
                  name: "Nested gray",
                  path: "job/.QAA/job/E2E/job/PREPROD/job/Nested/job/Gray",
                  scheduled: false,
                  status: "notbuilt",
                  synthetic: false,
                  url: "https://jenkins.p.gc.onl/job/.QAA/job/E2E/job/PREPROD/job/Nested/job/Gray/",
                },
                {
                  builds: [],
                  children: [],
                  color: "blue_anime",
                  kind: "pipeline",
                  name: "Nested running",
                  path: "job/.QAA/job/E2E/job/PREPROD/job/Nested/job/Running",
                  scheduled: false,
                  status: "running",
                  synthetic: false,
                  url: "https://jenkins.p.gc.onl/job/.QAA/job/E2E/job/PREPROD/job/Nested/job/Running/",
                },
              ],
              color: null,
              kind: "folder",
              name: "Nested",
              path: "job/.QAA/job/E2E/job/PREPROD/job/Nested",
              scheduled: false,
              status: null,
              synthetic: false,
              url: "https://jenkins.p.gc.onl/job/.QAA/job/E2E/job/PREPROD/job/Nested/",
            },
          ],
          color: null,
          kind: "folder",
          name: "BE",
          path: "job/.QAA/job/E2E/job/PREPROD",
          scheduled: false,
          status: null,
          synthetic: false,
          url: "https://jenkins.p.gc.onl/job/.QAA/job/E2E/job/PREPROD/",
        },
        {
          builds: [],
          children: [],
          color: null,
          kind: "folder",
          name: "FE",
          path: "job/.QAA/job/UI_E2E/job/PREPROD",
          scheduled: false,
          status: null,
          synthetic: false,
          url: "https://jenkins.p.gc.onl/job/.QAA/job/UI_E2E/job/PREPROD/",
        },
      ],
      color: null,
      kind: "folder",
      name: "PREPROD",
      path: "",
      scheduled: false,
      status: null,
      synthetic: true,
      url: "",
    },
    {
      builds: [],
      children: [
        {
          builds: [],
          children: [],
          color: null,
          kind: "folder",
          name: "BE",
          path: "job/.QAA/job/E2E/job/PROD",
          scheduled: false,
          status: null,
          synthetic: false,
          url: "https://jenkins.p.gc.onl/job/.QAA/job/E2E/job/PROD/",
        },
        {
          builds: [],
          children: [],
          color: null,
          kind: "folder",
          name: "FE",
          path: "job/.QAA/job/UI_E2E/job/PROD",
          scheduled: false,
          status: null,
          synthetic: false,
          url: "https://jenkins.p.gc.onl/job/.QAA/job/UI_E2E/job/PROD/",
        },
      ],
      color: null,
      kind: "folder",
      name: "PROD",
      path: "",
      scheduled: false,
      status: null,
      synthetic: true,
      url: "",
    },
  ];
}

describe("BoardPanel", () => {
  beforeEach(() => {
    agentClientMock.getJenkinsTree.mockReset();
    discoverAgentMock.mockReset();
    backendClientMock.getJenkinsFreezes.mockReset();
    backendClientMock.getJenkinsScope.mockReset();
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
    backendClientMock.getJenkinsScope.mockResolvedValue(buildScope());
    backendClientMock.getJenkinsFreezes.mockResolvedValue([]);
    discoverAgentMock.mockResolvedValue(null);
  });

  it("renders recursive status counts from the shared cache and opens the folder on double click", async () => {
    const user = userEvent.setup();

    useJenkinsStore.setState({
      pinnedPaths: ["job/.QAA/job/E2E/job/PREPROD"],
    });
    backendClientMock.getJenkinsTreeCache.mockResolvedValue({
      fetchedAt: "2026-08-17T10:00:00Z",
      refreshLease: null,
      roots: buildTreeRoots(),
      signature: "scope-1234",
      stale: false,
    });

    renderWithProviders(<BoardPanel />);

    expect(await screen.findByText("BE")).toBeInTheDocument();
    expect(screen.getByText("Passed 1")).toBeInTheDocument();
    expect(screen.getByText("Failed 1")).toBeInTheDocument();
    expect(screen.getByText("Gray 1")).toBeInTheDocument();
    expect(screen.getByText("Stuck 1")).toBeInTheDocument();
    expect(screen.getByText("Running 1")).toBeInTheDocument();
    expect(agentClientMock.getJenkinsTree).not.toHaveBeenCalled();

    await user.click(screen.getByText("BE"));
    expect(await screen.findByText("Nested failure")).toBeInTheDocument();

    await user.dblClick(screen.getByText("BE"));
    expect(openMock).toHaveBeenCalledWith(
      "https://jenkins.p.gc.onl/job/.QAA/job/E2E/job/PREPROD/",
      "_blank",
      "noopener"
    );
  });


  it("groups pinned items by root folder and group", async () => {
    useJenkinsStore.setState({
      pinnedPaths: [
        "job/.QAA/job/UI_E2E/job/PROD",
        "job/.QAA/job/E2E/job/PREPROD",
        "job/.QAA/job/E2E/job/PROD",
        "job/.QAA/job/UI_E2E/job/PREPROD",
      ],
    });
    backendClientMock.getJenkinsTreeCache.mockResolvedValue({
      fetchedAt: "2026-08-17T10:00:00Z",
      refreshLease: null,
      roots: buildTreeRoots(),
      signature: "scope-1234",
      stale: false,
    });

    renderWithProviders(<BoardPanel />);

    const sectionHeadings = await screen.findAllByRole("heading", { level: 4 });
    expect(sectionHeadings.map((heading) => heading.textContent)).toEqual([
      "PREPROD / BE",
      "PREPROD / FE",
      "PROD / BE",
      "PROD / FE",
    ]);

    expect(
      within(screen.getByText("PREPROD / BE").closest("section")!).getByText("job/.QAA/job/E2E/job/PREPROD")
    ).toBeInTheDocument();
    expect(
      within(screen.getByText("PREPROD / FE").closest("section")!).getByText("job/.QAA/job/UI_E2E/job/PREPROD")
    ).toBeInTheDocument();
    expect(
      within(screen.getByText("PROD / BE").closest("section")!).getByText("job/.QAA/job/E2E/job/PROD")
    ).toBeInTheDocument();
    expect(
      within(screen.getByText("PROD / FE").closest("section")!).getByText("job/.QAA/job/UI_E2E/job/PROD")
    ).toBeInTheDocument();
  });

  it("renders the build-history strip for a pinned pipeline once expanded", async () => {
    const user = userEvent.setup();
    const roots = buildTreeRoots();
    const smokeBuild: JenkinsBuild = {
      allureUrl: "https://jenkins.p.gc.onl/job/.QAA/job/E2E/job/PREPROD/job/Smoke/42/allure/",
      building: false,
      durationMs: 12000,
      number: 42,
      result: "SUCCESS",
      timestamp: 1_723_800_000_000,
      url: "https://jenkins.p.gc.onl/job/.QAA/job/E2E/job/PREPROD/job/Smoke/42/",
    };
    (roots[0].children[0].children[0] as unknown as { builds: JenkinsBuild[] }).builds = [smokeBuild];

    useJenkinsStore.setState({
      pinnedPaths: ["job/.QAA/job/E2E/job/PREPROD"],
    });
    backendClientMock.getJenkinsTreeCache.mockResolvedValue({
      fetchedAt: "2026-08-17T10:00:00Z",
      refreshLease: null,
      roots,
      signature: "scope-1234",
      stale: false,
    });

    renderWithProviders(<BoardPanel />);

    await user.click(await screen.findByText("BE"));
    expect(await screen.findByLabelText("#42: SUCCESS")).toBeInTheDocument();
  });

  it("shows the shared frozen badge and reason on pinned folders", async () => {
    const user = userEvent.setup();

    useJenkinsStore.setState({
      pinnedPaths: ["job/.QAA/job/E2E/job/PREPROD"],
    });
    backendClientMock.getJenkinsTreeCache.mockResolvedValue({
      fetchedAt: "2026-08-17T10:00:00Z",
      refreshLease: null,
      roots: buildTreeRoots(),
      signature: "scope-1234",
      stale: false,
    });
    backendClientMock.getJenkinsFreezes.mockResolvedValue([
      {
        applied: true,
        createdAt: "2026-08-17T10:00:00Z",
        createdBy: "test",
        folderName: "BE",
        folderPath: "job/.QAA/job/E2E/job/PREPROD",
        id: "freeze-1",
        killBuilds: false,
        mergedIntoId: null,
        reason: "Pinned folder freeze",
        resolvedAt: null,
        resolvedBy: null,
        signature: "scope-1234",
        snapshot: [],
        status: "active",
      },
    ]);

    renderWithProviders(<BoardPanel />);

    const badge = await screen.findByText("Frozen");
    await user.hover(badge);
    expect(await screen.findByText("Pinned folder freeze")).toBeInTheDocument();
    expect(screen.getAllByText("BE")[0]?.closest('[data-frozen="true"]')).not.toBeNull();
  });

  it("highlights pinned pipelines covered by an ancestor freeze", async () => {
    useJenkinsStore.setState({
      pinnedPaths: ["job/.QAA/job/E2E/job/PREPROD/job/Smoke"],
    });
    backendClientMock.getJenkinsTreeCache.mockResolvedValue({
      fetchedAt: "2026-08-17T10:00:00Z",
      refreshLease: null,
      roots: buildTreeRoots(),
      signature: "scope-1234",
      stale: false,
    });
    backendClientMock.getJenkinsFreezes.mockResolvedValue([
      {
        applied: true,
        createdAt: "2026-08-17T10:00:00Z",
        createdBy: "test",
        folderName: "BE",
        folderPath: "job/.QAA/job/E2E/job/PREPROD",
        id: "freeze-1",
        killBuilds: false,
        mergedIntoId: null,
        reason: "Ancestor freeze",
        resolvedAt: null,
        resolvedBy: null,
        signature: "scope-1234",
        snapshot: [],
        status: "active",
      },
    ]);

    renderWithProviders(<BoardPanel />);

    expect(await screen.findByText("Smoke")).toBeInTheDocument();
    expect(screen.getByText("Smoke").closest('[data-frozen="true"]')).not.toBeNull();
  });

  it("warms a cold cache from the companion when pinned opens first", async () => {
    useJenkinsStore.setState({
      pinnedPaths: ["job/.QAA/job/E2E/job/PREPROD"],
    });
    discoverAgentMock.mockResolvedValue({ port: 47600 });
    agentClientMock.getJenkinsTree.mockResolvedValue({
      roots: buildTreeRoots(),
    });
    backendClientMock.getJenkinsTreeCache
      .mockResolvedValueOnce({
        fetchedAt: null,
        refreshLease: "lease-1",
        roots: [],
        signature: "scope-1234",
        stale: true,
      })
      .mockResolvedValue({
        fetchedAt: "2026-08-17T10:00:00Z",
        refreshLease: null,
        roots: buildTreeRoots(),
        signature: "scope-1234",
        stale: false,
      });

    renderWithProviders(<BoardPanel />);

    expect(await screen.findByText("BE")).toBeInTheDocument();
    expect(discoverAgentMock).toHaveBeenCalled();
    expect(agentClientMock.getJenkinsTree).toHaveBeenCalledWith(47600, "token-123");
    expect(backendClientMock.putJenkinsTreeCache).toHaveBeenCalledWith("token-123", {
      refreshLease: "lease-1",
      roots: buildTreeRoots(),
      signature: "scope-1234",
    });
  });

  it("renders stale shared cache data without requiring companion discovery", async () => {
    useJenkinsStore.setState({
      pinnedPaths: ["job/.QAA/job/E2E/job/PREPROD"],
    });
    backendClientMock.getJenkinsTreeCache.mockResolvedValue({
      fetchedAt: "2026-08-17T09:45:00Z",
      refreshLease: "lease-1",
      roots: buildTreeRoots(),
      signature: "scope-1234",
      stale: true,
    });

    renderWithProviders(<BoardPanel />);

    expect(await screen.findByText("BE")).toBeInTheDocument();
    expect(agentClientMock.getJenkinsTree).not.toHaveBeenCalled();
    expect(backendClientMock.putJenkinsTreeCache).not.toHaveBeenCalled();
  });
});
