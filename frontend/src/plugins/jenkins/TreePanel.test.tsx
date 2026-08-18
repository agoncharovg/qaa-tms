import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const agentClientMock = vi.hoisted(() => ({
  freezeJenkinsFolder: vi.fn(),
  getJenkinsBuilds: vi.fn(),
  getJenkinsScope: vi.fn(),
  getJenkinsTree: vi.fn(),
  resumeJenkinsFolder: vi.fn(),
  startJenkinsResumeRun: vi.fn(),
}));

const backendClientMock = vi.hoisted(() => ({
  cancelJenkinsResumeRun: vi.fn(),
  createJenkinsFreeze: vi.fn(),
  createJenkinsResumeRun: vi.fn(),
  deleteJenkinsFreeze: vi.fn(),
  getJenkinsBuildsCache: vi.fn(),
  getJenkinsFreezes: vi.fn(),
  getJenkinsResumeRun: vi.fn(),
  getJenkinsResumeRuns: vi.fn(),
  getJenkinsTreeCache: vi.fn(),
  putJenkinsFreezeSnapshot: vi.fn(),
  putJenkinsBuildsCache: vi.fn(),
  putJenkinsTreeCache: vi.fn(),
  resolveJenkinsFreeze: vi.fn(),
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

import { PluginId, QueryKey, TabId } from "@/constants";
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

function buildActiveFreezes() {
  return [
    {
      applied: true,
      createdAt: "2026-08-17T10:00:00Z",
      createdBy: "test",
      folderName: "IAM",
      folderPath: "job/.QAA/job/E2E/job/PREPROD/job/IAM",
      id: "freeze-own",
      killBuilds: false,
      mergedIntoId: null,
      reason: "Own freeze",
      resolvedAt: null,
      resolvedBy: null,
      signature: "scope-1234",
      snapshot: [],
      status: "active",
    },
    {
      applied: true,
      createdAt: "2026-08-17T11:00:00Z",
      createdBy: "admin",
      folderName: "CDN",
      folderPath: "job/.QAA/job/E2E/job/PREPROD/job/CDN",
      id: "freeze-other",
      killBuilds: false,
      mergedIntoId: null,
      reason: "Other freeze",
      resolvedAt: null,
      resolvedBy: null,
      signature: "scope-1234",
      snapshot: [],
      status: "active",
    },
  ];
}

function buildResumeRun(status: "running" | "done" | "cancelled" = "running") {
  return {
    cancelledBy: status === "cancelled" ? "admin" : null,
    createdAt: "2026-08-18T10:00:00Z",
    createdBy: "test",
    currentName: status === "running" ? "Smoke" : null,
    currentPath: status === "running" ? "job/.QAA/job/E2E/job/PREPROD/job/Smoke" : null,
    errorCount: 0,
    finishedAt: status === "running" ? null : "2026-08-18T10:05:00Z",
    freezeId: "freeze-exact",
    id: "run-1",
    items: [
      {
        fullName: ".QAA/E2E/PREPROD/Smoke",
        name: "Smoke",
        path: "job/.QAA/job/E2E/job/PREPROD/job/Smoke",
        reason: null,
        scheduled: false,
        state: "started",
      },
      {
        fullName: ".QAA/E2E/PREPROD/Disabled",
        name: "Disabled",
        path: "job/.QAA/job/E2E/job/PREPROD/job/Disabled",
        reason: "Disabled before the freeze",
        scheduled: false,
        state: "skipped",
      },
    ],
    signature: "scope-1234",
    skippedCount: 1,
    stale: false,
    startedCount: 1,
    status,
    total: 1,
  };
}

describe("TreePanel", () => {
  beforeEach(() => {
    agentClientMock.getJenkinsBuilds.mockReset();
    agentClientMock.freezeJenkinsFolder.mockReset();
    agentClientMock.getJenkinsScope.mockReset();
    agentClientMock.getJenkinsTree.mockReset();
    agentClientMock.resumeJenkinsFolder.mockReset();
    agentClientMock.startJenkinsResumeRun.mockReset();
    backendClientMock.cancelJenkinsResumeRun.mockReset();
    backendClientMock.createJenkinsFreeze.mockReset();
    backendClientMock.createJenkinsResumeRun.mockReset();
    backendClientMock.deleteJenkinsFreeze.mockReset();
    backendClientMock.getJenkinsBuildsCache.mockReset();
    backendClientMock.getJenkinsFreezes.mockReset();
    backendClientMock.getJenkinsResumeRun.mockReset();
    backendClientMock.getJenkinsResumeRuns.mockReset();
    backendClientMock.getJenkinsTreeCache.mockReset();
    backendClientMock.putJenkinsFreezeSnapshot.mockReset();
    backendClientMock.putJenkinsBuildsCache.mockReset();
    backendClientMock.putJenkinsTreeCache.mockReset();
    backendClientMock.resolveJenkinsFreeze.mockReset();
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
    backendClientMock.getJenkinsFreezes.mockResolvedValue([]);
    backendClientMock.getJenkinsResumeRun.mockResolvedValue(buildResumeRun("running"));
    backendClientMock.getJenkinsResumeRuns.mockResolvedValue([]);
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

  it("freezes a folder through reserve, agent snapshot, and snapshot put in order", async () => {
    const user = userEvent.setup();

    agentClientMock.getJenkinsScope.mockResolvedValue(buildScope());
    backendClientMock.getJenkinsTreeCache.mockResolvedValue({
      fetchedAt: "2026-08-17T10:00:00Z",
      refreshLease: null,
      roots: buildTreeRoots(),
      signature: "scope-1234",
      stale: false,
    });
    backendClientMock.createJenkinsFreeze.mockResolvedValue({
      applied: false,
      createdAt: "2026-08-17T10:00:00Z",
      createdBy: "test",
      folderName: "PREPROD",
      folderPath: "job/.QAA/job/E2E/job/PREPROD",
      id: "freeze-1",
      killBuilds: true,
      mergedIntoId: null,
      reason: "DR",
      resolvedAt: null,
      resolvedBy: null,
      signature: "scope-1234",
      snapshot: [],
      status: "active",
    });
    agentClientMock.freezeJenkinsFolder.mockResolvedValue({
      snapshot: [
        {
          fullName: ".QAA/E2E/PREPROD/Smoke",
          name: "Smoke",
          path: "job/.QAA/job/E2E/job/PREPROD/job/Smoke",
          scheduled: false,
          wasBuilding: false,
          wasDisabled: false,
        },
      ],
    });
    backendClientMock.putJenkinsFreezeSnapshot.mockResolvedValue({
      applied: true,
      createdAt: "2026-08-17T10:00:00Z",
      createdBy: "test",
      folderName: "PREPROD",
      folderPath: "job/.QAA/job/E2E/job/PREPROD",
      id: "freeze-1",
      killBuilds: true,
      mergedIntoId: null,
      reason: "DR",
      resolvedAt: null,
      resolvedBy: null,
      signature: "scope-1234",
      snapshot: [],
      status: "active",
    });

    renderWithProviders(<TreePanel agentPort={47600} />);

    await user.click(await screen.findByRole("button", { name: "Freeze folder..." }));
    await user.type(screen.getByLabelText("Reason"), "DR freeze");
    await user.click(screen.getByRole("button", { name: "Freeze folder" }));

    await waitFor(() => {
      expect(backendClientMock.createJenkinsFreeze).toHaveBeenCalledWith(
        "token-123",
        expect.objectContaining({
          folderName: "PREPROD",
          folderPath: "job/.QAA/job/E2E/job/PREPROD",
          killBuilds: false,
          reason: "DR freeze",
          signature: "scope-1234",
        })
      );
      expect(agentClientMock.freezeJenkinsFolder).toHaveBeenCalledWith(47600, expect.anything(), expect.anything());
    });

    expect(backendClientMock.putJenkinsFreezeSnapshot).toHaveBeenCalledWith("token-123", "freeze-1", {
      mergeFreezeIds: [],
      snapshot: [
        {
          fullName: ".QAA/E2E/PREPROD/Smoke",
          name: "Smoke",
          path: "job/.QAA/job/E2E/job/PREPROD/job/Smoke",
          scheduled: false,
          wasBuilding: false,
          wasDisabled: false,
        },
      ],
    });
    expect(
      backendClientMock.createJenkinsFreeze.mock.invocationCallOrder[0]
    ).toBeLessThan(agentClientMock.freezeJenkinsFolder.mock.invocationCallOrder[0]);
    expect(
      agentClientMock.freezeJenkinsFolder.mock.invocationCallOrder[0]
    ).toBeLessThan(backendClientMock.putJenkinsFreezeSnapshot.mock.invocationCallOrder[0]);
  });

  it("rolls back the reserved freeze when the agent freeze step fails", async () => {
    const user = userEvent.setup();

    agentClientMock.getJenkinsScope.mockResolvedValue(buildScope());
    backendClientMock.getJenkinsTreeCache.mockResolvedValue({
      fetchedAt: "2026-08-17T10:00:00Z",
      refreshLease: null,
      roots: buildTreeRoots(),
      signature: "scope-1234",
      stale: false,
    });
    backendClientMock.createJenkinsFreeze.mockResolvedValue({
      applied: false,
      createdAt: "2026-08-17T10:00:00Z",
      createdBy: "test",
      folderName: "PREPROD",
      folderPath: "job/.QAA/job/E2E/job/PREPROD",
      id: "freeze-rollback",
      killBuilds: false,
      mergedIntoId: null,
      reason: "DR",
      resolvedAt: null,
      resolvedBy: null,
      signature: "scope-1234",
      snapshot: [],
      status: "active",
    });
    agentClientMock.freezeJenkinsFolder.mockRejectedValue(new Error("freeze failed"));
    backendClientMock.deleteJenkinsFreeze.mockResolvedValue(undefined);

    renderWithProviders(<TreePanel agentPort={47600} />);

    await user.click(await screen.findByRole("button", { name: "Freeze folder..." }));
    await user.type(screen.getByLabelText("Reason"), "DR freeze");
    await user.click(screen.getByRole("button", { name: "Freeze folder" }));

    await waitFor(() => {
      expect(backendClientMock.deleteJenkinsFreeze).toHaveBeenCalledWith(
        "token-123",
        "freeze-rollback"
      );
    });
  });

  it("shows intersecting freeze merge checkboxes with own freezes checked by default", async () => {
    const user = userEvent.setup();

    agentClientMock.getJenkinsScope.mockResolvedValue(buildScope());
    backendClientMock.getJenkinsTreeCache.mockResolvedValue({
      fetchedAt: "2026-08-17T10:00:00Z",
      refreshLease: null,
      roots: buildTreeRoots(),
      signature: "scope-1234",
      stale: false,
    });
    backendClientMock.getJenkinsFreezes.mockResolvedValue(buildActiveFreezes());
    backendClientMock.createJenkinsFreeze.mockResolvedValue({
      applied: false,
      createdAt: "2026-08-17T10:00:00Z",
      createdBy: "test",
      folderName: "PREPROD",
      folderPath: "job/.QAA/job/E2E/job/PREPROD",
      id: "freeze-merge",
      killBuilds: false,
      mergedIntoId: null,
      reason: "DR",
      resolvedAt: null,
      resolvedBy: null,
      signature: "scope-1234",
      snapshot: [],
      status: "active",
    });
    agentClientMock.freezeJenkinsFolder.mockResolvedValue({ snapshot: [] });
    backendClientMock.putJenkinsFreezeSnapshot.mockResolvedValue({
      applied: true,
      createdAt: "2026-08-17T10:00:00Z",
      createdBy: "test",
      folderName: "PREPROD",
      folderPath: "job/.QAA/job/E2E/job/PREPROD",
      id: "freeze-merge",
      killBuilds: false,
      mergedIntoId: null,
      reason: "DR",
      resolvedAt: null,
      resolvedBy: null,
      signature: "scope-1234",
      snapshot: [],
      status: "active",
    });

    renderWithProviders(<TreePanel agentPort={47600} />);

    await user.click(await screen.findByRole("button", { name: "Freeze folder..." }));

    const ownCheckbox = await screen.findByRole("checkbox", { name: /IAM · test/ });
    const otherCheckbox = screen.getByRole("checkbox", { name: /CDN · admin/ });
    expect(ownCheckbox).toBeChecked();
    expect(otherCheckbox).not.toBeChecked();

    await user.click(otherCheckbox);
    await user.type(screen.getByLabelText("Reason"), "Widen freeze");
    await user.click(screen.getByRole("button", { name: "Freeze folder" }));

    await waitFor(() => {
      expect(backendClientMock.putJenkinsFreezeSnapshot).toHaveBeenCalledWith(
        "token-123",
        "freeze-merge",
        {
          mergeFreezeIds: ["freeze-own", "freeze-other"],
          snapshot: [],
        }
      );
    });
  });

  it("shows a frozen badge from an ancestor freeze and starts a resume campaign for exact-folder freezes", async () => {
    const user = userEvent.setup();
    const roots = [
      {
        builds: [],
        children: [
          {
            builds: [],
            children: [],
            color: null,
            kind: "folder",
            name: "IAM",
            path: "job/.QAA/job/E2E/job/PREPROD/job/IAM",
            status: null,
            url: "https://jenkins.p.gc.onl/job/.QAA/job/E2E/job/PREPROD/job/IAM/",
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

    agentClientMock.getJenkinsScope.mockResolvedValue(buildScope());
    backendClientMock.getJenkinsTreeCache.mockResolvedValue({
      fetchedAt: "2026-08-17T10:00:00Z",
      refreshLease: null,
      roots,
      signature: "scope-1234",
      stale: false,
    });
    backendClientMock.getJenkinsFreezes.mockResolvedValue([
      {
        applied: true,
        createdAt: "2026-08-17T10:00:00Z",
        createdBy: "test",
        folderName: "PREPROD",
        folderPath: "job/.QAA/job/E2E/job/PREPROD",
        id: "freeze-exact",
        killBuilds: false,
        mergedIntoId: null,
        reason: "DR freeze",
        resolvedAt: null,
        resolvedBy: null,
        signature: "scope-1234",
        snapshot: [
          {
            fullName: ".QAA/E2E/PREPROD/IAM/Smoke",
            name: "Smoke",
            path: "job/.QAA/job/E2E/job/PREPROD/job/IAM/job/Smoke",
            scheduled: false,
            wasBuilding: false,
            wasDisabled: false,
          },
        ],
        status: "active",
      },
    ]);
    backendClientMock.createJenkinsResumeRun.mockResolvedValue(buildResumeRun("running"));
    agentClientMock.startJenkinsResumeRun.mockResolvedValue({ runId: "run-1" });

    renderWithProviders(<TreePanel agentPort={47600} />);

    const frozenBadges = await screen.findAllByText("Frozen");
    await user.hover(frozenBadges[1]);
    expect(await screen.findByText("DR freeze")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Resume folder" }));

    const resumeDialog = await screen.findByRole("dialog", { name: "Resume Jenkins folder" });
    await user.click(within(resumeDialog).getByRole("button", { name: "Resume folder" }));

    await waitFor(() => {
      expect(backendClientMock.createJenkinsResumeRun).toHaveBeenCalledWith("token-123", {
        freezeId: "freeze-exact",
      });
      expect(agentClientMock.startJenkinsResumeRun).toHaveBeenCalledWith(47600, expect.anything(), {
        runId: "run-1",
        snapshot: [
          {
            fullName: ".QAA/E2E/PREPROD/IAM/Smoke",
            name: "Smoke",
            path: "job/.QAA/job/E2E/job/PREPROD/job/IAM/job/Smoke",
            scheduled: false,
            wasBuilding: false,
            wasDisabled: false,
          },
        ],
      });
    });

    expect(agentClientMock.resumeJenkinsFolder).not.toHaveBeenCalled();
    expect(backendClientMock.resolveJenkinsFreeze).not.toHaveBeenCalled();
  });

  it("renders the shared progress modal from poll results and disables resume actions while locked", async () => {
    agentClientMock.getJenkinsScope.mockResolvedValue(buildScope());
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
        folderName: "PREPROD",
        folderPath: "job/.QAA/job/E2E/job/PREPROD",
        id: "freeze-exact",
        killBuilds: false,
        mergedIntoId: null,
        reason: "DR freeze",
        resolvedAt: null,
        resolvedBy: null,
        signature: "scope-1234",
        snapshot: [],
        status: "active",
      },
    ]);
    backendClientMock.getJenkinsResumeRuns.mockResolvedValue([buildResumeRun("running")]);

    renderWithProviders(<TreePanel agentPort={47600} />);

    expect(await screen.findByText("Resume campaign")).toBeInTheDocument();
    expect(screen.getByText(/Started by test/)).toBeInTheDocument();
    expect(screen.getAllByText("Smoke").length).toBeGreaterThan(0);
    expect(screen.getByText("1/1 started")).toBeInTheDocument();
    expect(screen.getByText("Disabled before the freeze")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resume folder" })).toBeDisabled();
    expect(backendClientMock.createJenkinsResumeRun).not.toHaveBeenCalled();
  });

  it("cancels the active resume run from the shared modal", async () => {
    const user = userEvent.setup();

    agentClientMock.getJenkinsScope.mockResolvedValue(buildScope());
    backendClientMock.getJenkinsTreeCache.mockResolvedValue({
      fetchedAt: "2026-08-17T10:00:00Z",
      refreshLease: null,
      roots: buildTreeRoots(),
      signature: "scope-1234",
      stale: false,
    });
    backendClientMock.getJenkinsResumeRuns.mockResolvedValue([buildResumeRun("running")]);
    backendClientMock.cancelJenkinsResumeRun.mockResolvedValue(buildResumeRun("cancelled"));

    renderWithProviders(<TreePanel agentPort={47600} />);

    await user.click(await screen.findByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(backendClientMock.cancelJenkinsResumeRun).toHaveBeenCalledWith("token-123", "run-1");
    });
  });

  it("shows a terminal summary and releases the lock when the run finishes", async () => {
    agentClientMock.getJenkinsScope.mockResolvedValue(buildScope());
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
        folderName: "PREPROD",
        folderPath: "job/.QAA/job/E2E/job/PREPROD",
        id: "freeze-exact",
        killBuilds: false,
        mergedIntoId: null,
        reason: "DR freeze",
        resolvedAt: null,
        resolvedBy: null,
        signature: "scope-1234",
        snapshot: [],
        status: "active",
      },
    ]);
    backendClientMock.getJenkinsResumeRuns
      .mockResolvedValueOnce([buildResumeRun("running")])
      .mockResolvedValue([]);
    backendClientMock.getJenkinsResumeRun.mockResolvedValue(buildResumeRun("done"));

    const { queryClient } = renderWithProviders(<TreePanel agentPort={47600} />);

    expect(await screen.findByRole("button", { name: "Resume folder" })).toBeDisabled();

    await act(async () => {
      await queryClient.invalidateQueries({
        queryKey: [QueryKey.JENKINS_RESUME_RUN, "list", "token-123", "scope-1234"],
      });
    });

    expect(await screen.findByText("Resume completed.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resume folder" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("shows a cancelled summary and releases the lock when the run is cancelled", async () => {
    agentClientMock.getJenkinsScope.mockResolvedValue(buildScope());
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
        folderName: "PREPROD",
        folderPath: "job/.QAA/job/E2E/job/PREPROD",
        id: "freeze-exact",
        killBuilds: false,
        mergedIntoId: null,
        reason: "DR freeze",
        resolvedAt: null,
        resolvedBy: null,
        signature: "scope-1234",
        snapshot: [],
        status: "active",
      },
    ]);
    backendClientMock.getJenkinsResumeRuns
      .mockResolvedValueOnce([buildResumeRun("running")])
      .mockResolvedValue([]);
    backendClientMock.getJenkinsResumeRun.mockResolvedValue(buildResumeRun("cancelled"));

    const { queryClient } = renderWithProviders(<TreePanel agentPort={47600} />);

    expect(await screen.findByRole("button", { name: "Cancel" })).toBeInTheDocument();

    await act(async () => {
      await queryClient.invalidateQueries({
        queryKey: [QueryKey.JENKINS_RESUME_RUN, "list", "token-123", "scope-1234"],
      });
    });

    expect(await screen.findByText("Resume cancelled.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resume folder" })).not.toBeDisabled();
  });
});
