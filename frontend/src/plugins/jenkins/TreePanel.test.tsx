import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const agentClientMock = vi.hoisted(() => ({
  freezeJenkinsFolder: vi.fn(),
  getJenkinsBuilds: vi.fn(),
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
  getJenkinsScope: vi.fn(),
  getJenkinsTreeCache: vi.fn(),
  putJenkinsFreezeSnapshot: vi.fn(),
  putJenkinsBuildsCache: vi.fn(),
  putJenkinsTreeCache: vi.fn(),
  resolveJenkinsFreeze: vi.fn(),
}));

const companionGateMock = vi.hoisted(() => ({
  blocked: false,
}));

const buildHistoryLineMock = vi.hoisted(() => ({
  renderCount: 0,
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

vi.mock("@/plugins/companion/CompanionGate", () => ({
  CompanionGate: ({
    children,
  }: {
    children: unknown;
  }) => {
    if (companionGateMock.blocked) {
      return <div>Freeze/Resume needs the companion</div>;
    }
    if (typeof children === "function") {
      return (children as (context: { agentPort: number }) => unknown)({ agentPort: 47600 });
    }
    return children;
  },
}));

vi.mock("@/plugins/jenkins/BuildHistoryLine", () => ({
  BuildHistoryLine: () => {
    buildHistoryLineMock.renderCount += 1;
    return null;
  },
}));

import { PluginId, QueryKey, StorageKey, TabId } from "@/constants";
import { TreePanel } from "@/plugins/jenkins/TreePanel";
import { parseServerTimestampMs } from "@/plugins/jenkins/serverTime";
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

function buildTreeRoots(pipelineStatus: string = "passed") {
  return [
    {
      builds: [],
      children: [
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
              color: pipelineStatus === "disabled" ? "disabled" : "blue",
              kind: "pipeline",
              name: "Smoke",
              scheduled: true,
              synthetic: false,
              path: "job/.QAA/job/E2E/job/PREPROD/job/Smoke",
              status: pipelineStatus,
              url: "https://jenkins.p.gc.onl/job/.QAA/job/E2E/job/PREPROD/job/Smoke/",
            },
          ],
          color: null,
          kind: "folder",
          name: "BE",
          scheduled: false,
          synthetic: false,
          path: "job/.QAA/job/E2E/job/PREPROD",
          status: null,
          url: "https://jenkins.p.gc.onl/job/.QAA/job/E2E/job/PREPROD/",
        },
        {
          builds: [],
          children: [],
          color: null,
          kind: "folder",
          name: "FE",
          scheduled: false,
          synthetic: false,
          path: "job/.QAA/job/UI_E2E/job/PREPROD",
          status: null,
          url: "https://jenkins.p.gc.onl/job/.QAA/job/UI_E2E/job/PREPROD/",
        },
      ],
      color: null,
      kind: "folder",
      name: "PREPROD",
      scheduled: false,
      synthetic: true,
      path: "",
      status: null,
      url: "",
    },
  ];
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
    restartPipelines: true,
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

describe("parseServerTimestampMs", () => {
  it("treats a tz-less server timestamp as UTC so cross-source comparisons stay correct", () => {
    // SQLite-backed freeze.createdAt has no tz designator; the in-memory tree cache emits +00:00.
    // Both are UTC clocks, so a tz-less value must parse identically to its explicit-UTC form —
    // otherwise a stale (older) tree would look newer and wrongly auto-resolve a fresh freeze.
    expect(parseServerTimestampMs("2026-08-19T08:56:38.083097")).toBe(
      Date.parse("2026-08-19T08:56:38.083097Z")
    );
    expect(parseServerTimestampMs("2026-08-19T08:56:38+00:00")).toBe(
      Date.parse("2026-08-19T08:56:38+00:00")
    );
    // A stale tree (08:55Z) is correctly older than a freeze created at 08:56 (tz-less UTC).
    expect(parseServerTimestampMs("2026-08-19T08:55:00Z")).toBeLessThan(
      parseServerTimestampMs("2026-08-19T08:56:38.083097")
    );
    expect(parseServerTimestampMs(null)).toBeNaN();
  });
});

describe("TreePanel", () => {
  beforeEach(() => {
    agentClientMock.getJenkinsBuilds.mockReset();
    agentClientMock.freezeJenkinsFolder.mockReset();
    backendClientMock.getJenkinsScope.mockReset();
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
    buildHistoryLineMock.renderCount = 0;
    companionGateMock.blocked = false;
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
    backendClientMock.getJenkinsScope.mockResolvedValue(buildScope());
    backendClientMock.getJenkinsFreezes.mockResolvedValue([]);
    backendClientMock.getJenkinsResumeRun.mockResolvedValue(buildResumeRun("running"));
    backendClientMock.getJenkinsResumeRuns.mockResolvedValue([]);
  });

  it("renders synthetic env groups without env actions, supports pinning real nodes, and opens Jenkins pages", async () => {
    const user = userEvent.setup();

    backendClientMock.getJenkinsScope.mockResolvedValue(buildScope());
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

    renderWithProviders(<TreePanel />);

    expect(await screen.findByText("PREPROD")).toBeInTheDocument();
    expect(await screen.findByText("Smoke")).toBeInTheDocument();
    expect(await screen.findByText("BE")).toBeInTheDocument();
    expect(await screen.findByText("FE")).toBeInTheDocument();
    expect(agentClientMock.getJenkinsBuilds).not.toHaveBeenCalled();
    expect(agentClientMock.getJenkinsTree).not.toHaveBeenCalled();
    expect(screen.getAllByRole("button", { name: "Freeze folder..." })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Pin to board" })).toHaveLength(2);

    await user.dblClick(screen.getByText("PREPROD"));
    expect(openMock).not.toHaveBeenCalled();

    const [folderPinButton] = screen.getAllByRole("button", { name: "Pin to board" });

    await user.click(folderPinButton);
    expect(useJenkinsStore.getState().pinnedPaths).toEqual(["job/.QAA/job/E2E/job/PREPROD"]);
    expect(folderPinButton).toHaveAttribute("aria-label", "Unpin from board");

    await user.click(screen.getAllByText("BE")[0]);
    const [pipelinePinButton] = screen.getAllByRole("button", { name: "Pin to board" });
    await user.click(pipelinePinButton);
    expect(useJenkinsStore.getState().pinnedPaths).toEqual([
      "job/.QAA/job/E2E/job/PREPROD",
      "job/.QAA/job/E2E/job/PREPROD/job/Smoke",
    ]);

    await user.dblClick(screen.getByText("BE"));
    expect(openMock).toHaveBeenCalledWith(
      "https://jenkins.p.gc.onl/job/.QAA/job/E2E/job/PREPROD/",
      "_blank",
      "noopener"
    );

    await user.dblClick(screen.getByText("Smoke"));
    expect(openMock).toHaveBeenCalledWith(
      "https://jenkins.p.gc.onl/job/.QAA/job/E2E/job/PREPROD/job/Smoke/",
      "_blank",
      "noopener"
    );
  });

  it("shows the companion prompt for freeze actions without blocking read-only Jenkins data", async () => {
    const user = userEvent.setup();
    companionGateMock.blocked = true;

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
      stale: false,
    });

    renderWithProviders(<TreePanel />);

    expect(await screen.findByText("PREPROD")).toBeInTheDocument();
    await user.click((await screen.findAllByRole("button", { name: "Freeze folder..." }))[0]);

    expect(
      await screen.findByText(
        "Freeze and resume actions use your personal Jenkins token from the local companion app. Install or update the companion to continue."
      )
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Freeze Jenkins folder" })).not.toBeInTheDocument();
  });

  it("renders stale tree data without requiring companion discovery for cache refresh", async () => {
    backendClientMock.getJenkinsTreeCache.mockResolvedValue({
      fetchedAt: "2026-08-17T09:45:00Z",
      refreshLease: "lease-1",
      roots: buildTreeRoots(),
      signature: "scope-1234",
      stale: true,
    });

    renderWithProviders(<TreePanel />);

    expect(await screen.findByText("PREPROD")).toBeInTheDocument();
    expect(agentClientMock.getJenkinsTree).not.toHaveBeenCalled();
    expect(backendClientMock.putJenkinsTreeCache).not.toHaveBeenCalled();
  });

  it("renders stale cached roots without refreshing when the lease belongs to another browser", async () => {
    backendClientMock.getJenkinsTreeCache.mockResolvedValue({
      fetchedAt: "2026-08-17T09:45:00Z",
      refreshLease: null,
      roots: buildTreeRoots(),
      signature: "scope-1234",
      stale: true,
    });

    renderWithProviders(<TreePanel />);

    expect(await screen.findByText("PREPROD")).toBeInTheDocument();
    expect(agentClientMock.getJenkinsTree).not.toHaveBeenCalled();
    expect(backendClientMock.putJenkinsTreeCache).not.toHaveBeenCalled();
  });

  it("reads expanded builds through the backend cache and falls back to the folded builds initially", async () => {
    const user = userEvent.setup();

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

    renderWithProviders(<TreePanel />);

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
    });
    expect(agentClientMock.getJenkinsBuilds).not.toHaveBeenCalled();
    expect(backendClientMock.putJenkinsBuildsCache).not.toHaveBeenCalled();
  });

  it("does not rerender the tree while typing the freeze reason", async () => {
    const user = userEvent.setup();

    backendClientMock.getJenkinsScope.mockResolvedValue(buildScope());
    backendClientMock.getJenkinsTreeCache.mockResolvedValue({
      fetchedAt: "2026-08-17T10:00:00Z",
      refreshLease: null,
      roots: buildTreeRoots(),
      signature: "scope-1234",
      stale: false,
    });

    renderWithProviders(<TreePanel />);

    await screen.findByText("Smoke");
    await user.click((await screen.findAllByRole("button", { name: "Freeze folder..." }))[0]);

    const renderCountBeforeTyping = buildHistoryLineMock.renderCount;
    await user.type(screen.getByLabelText("Reason"), "DR freeze");

    expect(buildHistoryLineMock.renderCount).toBe(renderCountBeforeTyping);
  });

  it("restores the previously expanded Jenkins node after remount", async () => {
    const user = userEvent.setup();

    backendClientMock.getJenkinsScope.mockResolvedValue(buildScope());
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
      stale: false,
    });

    const firstRender = renderWithProviders(<TreePanel />);

    await screen.findByText("Smoke");
    await user.click(screen.getAllByText("BE")[0]);
    await user.click(screen.getByText("Smoke"));
    expect(await screen.findByText("#42")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(StorageKey.JENKINS_PINNED) ?? "{}")).toMatchObject({
      expandedNodeKeys: [
        "synthetic/PREPROD",
        "job/.QAA/job/E2E/job/PREPROD",
        "job/.QAA/job/E2E/job/PREPROD/job/Smoke",
      ],
    });

    firstRender.unmount();
    renderWithProviders(<TreePanel />);

    expect(await screen.findByText("#42")).toBeInTheDocument();
  });

  it("does not rerender the tree when opening the resume dialog or toggling automatic restart", async () => {
    const user = userEvent.setup();

    backendClientMock.getJenkinsScope.mockResolvedValue(buildScope());
    backendClientMock.getJenkinsTreeCache.mockResolvedValue({
      fetchedAt: "2026-08-17T10:00:00Z",
      refreshLease: null,
      roots: buildTreeRoots("disabled"),
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
        id: "freeze-exact",
        killBuilds: false,
        mergedIntoId: null,
        reason: "DR freeze",
        resolvedAt: null,
        resolvedBy: null,
        signature: "scope-1234",
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
        status: "active",
      },
    ]);

    renderWithProviders(<TreePanel />);

    expect(await screen.findByText("Smoke")).toBeInTheDocument();
    const beRow = screen.getAllByText("BE")[0]?.closest('[data-frozen="true"]');
    expect(beRow).not.toBeNull();

    const renderCountBeforeResume = buildHistoryLineMock.renderCount;
    await user.click(within(beRow as HTMLElement).getByRole("button", { name: "Resume folder" }));

    const resumeDialog = await screen.findByRole("dialog", { name: "Resume Jenkins folder" });
    expect(buildHistoryLineMock.renderCount).toBe(renderCountBeforeResume + 1);

    await user.click(
      within(resumeDialog).getByRole("checkbox", {
        name: "Automatically restart resumed pipelines",
      })
    );

    expect(buildHistoryLineMock.renderCount).toBe(renderCountBeforeResume + 1);
  });

  it("freezes a folder through reserve, agent snapshot, and snapshot put in order", async () => {
    const user = userEvent.setup();

    backendClientMock.getJenkinsScope.mockResolvedValue(buildScope());
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
      folderName: "BE",
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
      folderName: "BE",
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

    renderWithProviders(<TreePanel />);

    await user.click((await screen.findAllByRole("button", { name: "Freeze folder..." }))[0]);
    await user.type(screen.getByLabelText("Reason"), "DR freeze");
    await user.click(screen.getByRole("button", { name: "Freeze folder" }));

    await waitFor(() => {
      expect(backendClientMock.createJenkinsFreeze).toHaveBeenCalledWith(
        "token-123",
        expect.objectContaining({
          folderName: "BE",
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

  it("pulls a fresh agent tree after a successful freeze so the disabled state shows at once", async () => {
    const user = userEvent.setup();

    backendClientMock.getJenkinsScope.mockResolvedValue(buildScope());
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
      folderName: "BE",
      folderPath: "job/.QAA/job/E2E/job/PREPROD",
      id: "freeze-fresh",
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
      folderName: "BE",
      folderPath: "job/.QAA/job/E2E/job/PREPROD",
      id: "freeze-fresh",
      killBuilds: false,
      mergedIntoId: null,
      reason: "DR",
      resolvedAt: null,
      resolvedBy: null,
      signature: "scope-1234",
      snapshot: [],
      status: "active",
    });
    // Freezing must trigger a real agent-backed refetch (not just a stale cache re-read).
    agentClientMock.getJenkinsTree.mockResolvedValue({ roots: buildTreeRoots("disabled"), signature: "scope-1234" });
    backendClientMock.putJenkinsTreeCache.mockResolvedValue(undefined);

    renderWithProviders(<TreePanel />);

    await user.click((await screen.findAllByRole("button", { name: "Freeze folder..." }))[0]);
    await user.type(screen.getByLabelText("Reason"), "DR freeze");
    await user.click(screen.getByRole("button", { name: "Freeze folder" }));

    await waitFor(() => {
      expect(agentClientMock.getJenkinsTree).toHaveBeenCalled();
      expect(backendClientMock.putJenkinsTreeCache).toHaveBeenCalledWith(
        "token-123",
        expect.objectContaining({ refreshLease: null, signature: "scope-1234" })
      );
    });
  });

  it("rolls back the reserved freeze when the agent freeze step fails", async () => {
    const user = userEvent.setup();

    backendClientMock.getJenkinsScope.mockResolvedValue(buildScope());
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
      folderName: "BE",
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

    renderWithProviders(<TreePanel />);

    await user.click((await screen.findAllByRole("button", { name: "Freeze folder..." }))[0]);
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

    backendClientMock.getJenkinsScope.mockResolvedValue(buildScope());
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
      folderName: "BE",
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
      folderName: "BE",
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

    renderWithProviders(<TreePanel />);

    await user.click((await screen.findAllByRole("button", { name: "Freeze folder..." }))[0]);

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
            children: [
              {
                builds: [],
                children: [
                  {
                    builds: [],
                    children: [],
                    color: "disabled",
                    kind: "pipeline",
                    name: "Smoke",
                    path: "job/.QAA/job/E2E/job/PREPROD/job/IAM/job/Smoke",
                    scheduled: false,
                    status: "disabled",
                    synthetic: false,
                    url: "https://jenkins.p.gc.onl/job/.QAA/job/E2E/job/PREPROD/job/IAM/job/Smoke/",
                  },
                ],
                color: null,
                kind: "folder",
                name: "IAM",
                path: "job/.QAA/job/E2E/job/PREPROD/job/IAM",
                scheduled: false,
                status: null,
                synthetic: false,
                url: "https://jenkins.p.gc.onl/job/.QAA/job/E2E/job/PREPROD/job/IAM/",
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
    ];

    backendClientMock.getJenkinsScope.mockResolvedValue(buildScope());
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
        folderName: "BE",
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

    renderWithProviders(<TreePanel />);

    const frozenBadges = await screen.findAllByText("Frozen");
    await user.hover(frozenBadges[1]);
    expect(await screen.findByText("DR freeze")).toBeInTheDocument();

    expect(screen.getAllByText("BE")[0]?.closest('[data-frozen="true"]')).not.toBeNull();
    const iamRow = screen.getByText("IAM").closest('[data-frozen="true"]');
    expect(iamRow).not.toBeNull();

    await user.click(screen.getAllByText("BE")[0]);
    expect(await screen.findByText("Smoke")).toBeInTheDocument();
    expect(screen.getByText("Smoke").closest('[data-frozen="true"]')).not.toBeNull();

    await user.click(within(iamRow as HTMLElement).getByRole("button", { name: "Resume folder" }));

    const resumeDialog = await screen.findByRole("dialog", { name: "Resume Jenkins folder" });
    expect(
      within(resumeDialog).getByRole("checkbox", {
        name: "Automatically restart resumed pipelines",
      })
    ).toBeChecked();
    await user.click(within(resumeDialog).getByRole("button", { name: "Resume folder" }));

    await waitFor(() => {
      expect(backendClientMock.createJenkinsResumeRun).toHaveBeenCalledWith("token-123", {
        freezeId: "freeze-exact",
        restartPipelines: true,
        folderPath: "job/.QAA/job/E2E/job/PREPROD/job/IAM",
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
        restartPipelines: true,
      });
    });

    expect(agentClientMock.resumeJenkinsFolder).not.toHaveBeenCalled();
    expect(backendClientMock.resolveJenkinsFreeze).not.toHaveBeenCalled();
  });

  it("allows resuming without automatic restart", async () => {
    const user = userEvent.setup();

    backendClientMock.getJenkinsScope.mockResolvedValue(buildScope());
    backendClientMock.getJenkinsTreeCache.mockResolvedValue({
      fetchedAt: "2026-08-17T10:00:00Z",
      refreshLease: null,
      roots: buildTreeRoots("disabled"),
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

    renderWithProviders(<TreePanel />);

    await screen.findAllByText("Frozen");
    const beRow = screen.getAllByText("BE")[0]?.closest('[data-frozen="true"]');
    expect(beRow).not.toBeNull();
    await user.click(within(beRow as HTMLElement).getByRole("button", { name: "Resume folder" }));

    const resumeDialog = await screen.findByRole("dialog", { name: "Resume Jenkins folder" });
    await user.click(
      within(resumeDialog).getByRole("checkbox", {
        name: "Automatically restart resumed pipelines",
      })
    );
    await user.click(within(resumeDialog).getByRole("button", { name: "Resume folder" }));

    expect(await screen.findByRole("dialog", { name: "Resume campaign" })).toBeInTheDocument();

    await waitFor(() => {
      expect(backendClientMock.createJenkinsResumeRun).toHaveBeenCalledWith("token-123", {
        freezeId: "freeze-exact",
        restartPipelines: false,
        folderPath: "job/.QAA/job/E2E/job/PREPROD",
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
        restartPipelines: false,
      });
    });
  });

  it("resumes only the selected covered child subtree", async () => {
    const user = userEvent.setup();
    const roots = [
      {
        builds: [],
        children: [
          {
            builds: [],
            children: [
              {
                builds: [],
                children: [
                  {
                    builds: [],
                    children: [
                      {
                        builds: [],
                        children: [],
                        color: "disabled",
                        kind: "pipeline",
                        name: "Web",
                        scheduled: false,
                        synthetic: false,
                        path: "job/.QAA/job/UI_E2E/job/PREPROD/job/IAM/job/IAM Client portal/job/Web",
                        status: "disabled",
                        url: "https://jenkins.p.gc.onl/job/.QAA/job/UI_E2E/job/PREPROD/job/IAM/job/IAM%20Client%20portal/job/Web/",
                      },
                      {
                        builds: [],
                        children: [],
                        color: "disabled",
                        kind: "pipeline",
                        name: "Admin",
                        scheduled: false,
                        synthetic: false,
                        path: "job/.QAA/job/UI_E2E/job/PREPROD/job/IAM/job/IAM Client portal/job/Admin",
                        status: "disabled",
                        url: "https://jenkins.p.gc.onl/job/.QAA/job/UI_E2E/job/PREPROD/job/IAM/job/IAM%20Client%20portal/job/Admin/",
                      },
                      {
                        builds: [],
                        children: [],
                        color: "disabled",
                        kind: "pipeline",
                        name: "API",
                        scheduled: false,
                        synthetic: false,
                        path: "job/.QAA/job/UI_E2E/job/PREPROD/job/IAM/job/IAM Client portal/job/API",
                        status: "disabled",
                        url: "https://jenkins.p.gc.onl/job/.QAA/job/UI_E2E/job/PREPROD/job/IAM/job/IAM%20Client%20portal/job/API/",
                      },
                      {
                        builds: [],
                        children: [],
                        color: "disabled",
                        kind: "pipeline",
                        name: "E2E",
                        scheduled: false,
                        synthetic: false,
                        path: "job/.QAA/job/UI_E2E/job/PREPROD/job/IAM/job/IAM Client portal/job/E2E",
                        status: "disabled",
                        url: "https://jenkins.p.gc.onl/job/.QAA/job/UI_E2E/job/PREPROD/job/IAM/job/IAM%20Client%20portal/job/E2E/",
                      },
                    ],
                    color: null,
                    kind: "folder",
                    name: "IAM Client portal",
                    scheduled: false,
                    synthetic: false,
                    path: "job/.QAA/job/UI_E2E/job/PREPROD/job/IAM/job/IAM%20Client%20portal",
                    status: null,
                    url: "https://jenkins.p.gc.onl/job/.QAA/job/UI_E2E/job/PREPROD/job/IAM/job/IAM%20Client%20portal/",
                  },
                ],
                color: null,
                kind: "folder",
                name: "IAM",
                scheduled: false,
                synthetic: false,
                path: "job/.QAA/job/UI_E2E/job/PREPROD/job/IAM",
                status: null,
                url: "https://jenkins.p.gc.onl/job/.QAA/job/UI_E2E/job/PREPROD/job/IAM/",
              },
            ],
            color: null,
            kind: "folder",
            name: "FE",
            scheduled: false,
            synthetic: false,
            path: "job/.QAA/job/UI_E2E/job/PREPROD",
            status: null,
            url: "https://jenkins.p.gc.onl/job/.QAA/job/UI_E2E/job/PREPROD/",
          },
        ],
        color: null,
        kind: "folder",
        name: "PREPROD",
        scheduled: false,
        synthetic: true,
        path: "",
        status: null,
        url: "",
      },
    ];

    backendClientMock.getJenkinsScope.mockResolvedValue(buildScope());
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
        folderName: "IAM",
        folderPath: "job/.QAA/job/UI_E2E/job/PREPROD/job/IAM",
        id: "freeze-iam",
        killBuilds: false,
        mergedIntoId: null,
        reason: "DR freeze",
        resolvedAt: null,
        resolvedBy: null,
        signature: "scope-1234",
        snapshot: [
          {
            fullName: ".QAA/UI_E2E/PREPROD/IAM/Smoke",
            name: "Smoke",
            path: "job/.QAA/job/UI_E2E/job/PREPROD/job/IAM/job/Smoke",
            scheduled: false,
            wasBuilding: false,
            wasDisabled: false,
          },
          {
            fullName: ".QAA/UI_E2E/PREPROD/IAM/Auth",
            name: "Auth",
            path: "job/.QAA/job/UI_E2E/job/PREPROD/job/IAM/job/Auth",
            scheduled: false,
            wasBuilding: false,
            wasDisabled: false,
          },
          {
            fullName: ".QAA/UI_E2E/PREPROD/IAM/Other",
            name: "Other",
            path: "job/.QAA/job/UI_E2E/job/PREPROD/job/IAM/job/Other",
            scheduled: false,
            wasBuilding: false,
            wasDisabled: false,
          },
          {
            fullName: ".QAA/UI_E2E/PREPROD/IAM/IAM Client portal/Web",
            name: "Web",
            path: "job/.QAA/job/UI_E2E/job/PREPROD/job/IAM/job/IAM Client portal/job/Web",
            scheduled: false,
            wasBuilding: false,
            wasDisabled: false,
          },
          {
            fullName: ".QAA/UI_E2E/PREPROD/IAM/IAM Client portal/Admin",
            name: "Admin",
            path: "job/.QAA/job/UI_E2E/job/PREPROD/job/IAM/job/IAM Client portal/job/Admin",
            scheduled: false,
            wasBuilding: false,
            wasDisabled: false,
          },
          {
            fullName: ".QAA/UI_E2E/PREPROD/IAM/IAM Client portal/API",
            name: "API",
            path: "job/.QAA/job/UI_E2E/job/PREPROD/job/IAM/job/IAM Client portal/job/API",
            scheduled: false,
            wasBuilding: false,
            wasDisabled: false,
          },
          {
            fullName: ".QAA/UI_E2E/PREPROD/IAM/IAM Client portal/E2E",
            name: "E2E",
            path: "job/.QAA/job/UI_E2E/job/PREPROD/job/IAM/job/IAM Client portal/job/E2E",
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

    renderWithProviders(<TreePanel />);

    await screen.findByText("FE");
    await user.click(screen.getAllByText("FE")[0]);
    await user.click(screen.getByText("IAM"));

    const portalRow = await screen.findByText("IAM Client portal");
    await user.click(
      within(portalRow.closest('[data-frozen="true"]') as HTMLElement).getByRole("button", {
        name: "Resume folder",
      })
    );

    const resumeDialog = await screen.findByRole("dialog", { name: "Resume Jenkins folder" });
    expect(resumeDialog).toHaveTextContent(
      "Restore 4 pipeline(s) in IAM Client portal. 4 will be rebuilt now; 0 scheduled pipeline(s) will only be re-enabled."
    );

    await user.click(within(resumeDialog).getByRole("button", { name: "Resume folder" }));

    await waitFor(() => {
      expect(backendClientMock.createJenkinsResumeRun).toHaveBeenCalledWith("token-123", {
        freezeId: "freeze-iam",
        restartPipelines: true,
        folderPath: "job/.QAA/job/UI_E2E/job/PREPROD/job/IAM/job/IAM%20Client%20portal",
      });
      expect(agentClientMock.startJenkinsResumeRun).toHaveBeenCalledWith(47600, expect.anything(), {
        runId: "run-1",
        restartPipelines: true,
        snapshot: [
          {
            fullName: ".QAA/UI_E2E/PREPROD/IAM/IAM Client portal/Web",
            name: "Web",
            path: "job/.QAA/job/UI_E2E/job/PREPROD/job/IAM/job/IAM Client portal/job/Web",
            scheduled: false,
            wasBuilding: false,
            wasDisabled: false,
          },
          {
            fullName: ".QAA/UI_E2E/PREPROD/IAM/IAM Client portal/Admin",
            name: "Admin",
            path: "job/.QAA/job/UI_E2E/job/PREPROD/job/IAM/job/IAM Client portal/job/Admin",
            scheduled: false,
            wasBuilding: false,
            wasDisabled: false,
          },
          {
            fullName: ".QAA/UI_E2E/PREPROD/IAM/IAM Client portal/API",
            name: "API",
            path: "job/.QAA/job/UI_E2E/job/PREPROD/job/IAM/job/IAM Client portal/job/API",
            scheduled: false,
            wasBuilding: false,
            wasDisabled: false,
          },
          {
            fullName: ".QAA/UI_E2E/PREPROD/IAM/IAM Client portal/E2E",
            name: "E2E",
            path: "job/.QAA/job/UI_E2E/job/PREPROD/job/IAM/job/IAM Client portal/job/E2E",
            scheduled: false,
            wasBuilding: false,
            wasDisabled: false,
          },
        ],
      });
    });
  });

  it("does not offer resume for a frozen covered subtree with no restorable items", async () => {
    const user = userEvent.setup();
    const roots = [
      {
        builds: [],
        children: [
          {
            builds: [],
            children: [
              {
                builds: [],
                children: [
                  {
                    builds: [],
                    children: [
                      {
                        builds: [],
                        children: [],
                        color: "disabled",
                        kind: "pipeline",
                        name: "Web",
                        scheduled: false,
                        synthetic: false,
                        path: "job/.QAA/job/UI_E2E/job/PREPROD/job/IAM/job/IAM Client portal/job/Web",
                        status: "disabled",
                        url: "https://jenkins.p.gc.onl/job/.QAA/job/UI_E2E/job/PREPROD/job/IAM/job/IAM%20Client%20portal/job/Web/",
                      },
                    ],
                    color: null,
                    kind: "folder",
                    name: "IAM Client portal",
                    scheduled: false,
                    synthetic: false,
                    path: "job/.QAA/job/UI_E2E/job/PREPROD/job/IAM/job/IAM%20Client%20portal",
                    status: null,
                    url: "https://jenkins.p.gc.onl/job/.QAA/job/UI_E2E/job/PREPROD/job/IAM/job/IAM%20Client%20portal/",
                  },
                ],
                color: null,
                kind: "folder",
                name: "IAM",
                scheduled: false,
                synthetic: false,
                path: "job/.QAA/job/UI_E2E/job/PREPROD/job/IAM",
                status: null,
                url: "https://jenkins.p.gc.onl/job/.QAA/job/UI_E2E/job/PREPROD/job/IAM/",
              },
            ],
            color: null,
            kind: "folder",
            name: "FE",
            scheduled: false,
            synthetic: false,
            path: "job/.QAA/job/UI_E2E/job/PREPROD",
            status: null,
            url: "https://jenkins.p.gc.onl/job/.QAA/job/UI_E2E/job/PREPROD/",
          },
        ],
        color: null,
        kind: "folder",
        name: "PREPROD",
        scheduled: false,
        synthetic: true,
        path: "",
        status: null,
        url: "",
      },
    ];

    backendClientMock.getJenkinsScope.mockResolvedValue(buildScope());
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
        folderName: "IAM",
        folderPath: "job/.QAA/job/UI_E2E/job/PREPROD/job/IAM",
        id: "freeze-iam",
        killBuilds: false,
        mergedIntoId: null,
        reason: "DR freeze",
        resolvedAt: null,
        resolvedBy: null,
        signature: "scope-1234",
        snapshot: [
          {
            fullName: ".QAA/UI_E2E/PREPROD/IAM/IAM Client portal/Web",
            name: "Web",
            path: "job/.QAA/job/UI_E2E/job/PREPROD/job/IAM/job/IAM Client portal/job/Web",
            scheduled: false,
            wasBuilding: false,
            wasDisabled: true,
          },
        ],
        status: "active",
      },
    ]);

    renderWithProviders(<TreePanel />);

    await screen.findByText("FE");
    await user.click(screen.getAllByText("FE")[0]);
    await user.click(screen.getByText("IAM"));

    const portalRow = await screen.findByText("IAM Client portal");
    const frozenRow = portalRow.closest('[data-frozen="true"]') as HTMLElement;
    expect(frozenRow).not.toBeNull();
    expect(within(frozenRow).queryByRole("button", { name: "Resume folder" })).not.toBeInTheDocument();
    expect(within(frozenRow).queryByRole("button", { name: "Freeze folder..." })).not.toBeInTheDocument();
  });

  it("auto-resolves a stale freeze once Jenkins shows its folder has no disabled pipeline left", async () => {
    backendClientMock.getJenkinsScope.mockResolvedValue(buildScope());
    backendClientMock.getJenkinsTreeCache.mockResolvedValue({
      // Tree snapshot is newer than the freeze, so it can legitimately contradict it.
      fetchedAt: "2026-08-18T10:00:00Z",
      refreshLease: null,
      // Smoke is enabled again in Jenkins (resumed directly there), so the freeze is stale.
      roots: buildTreeRoots(),
      signature: "scope-1234",
      stale: false,
    });
    const staleFreeze = {
      applied: true,
      createdAt: "2026-08-17T10:00:00Z",
      createdBy: "test",
      folderName: "BE",
      folderPath: "job/.QAA/job/E2E/job/PREPROD",
      id: "freeze-stale",
      killBuilds: false,
      mergedIntoId: null,
      reason: "DR freeze",
      resolvedAt: null,
      resolvedBy: null,
      signature: "scope-1234",
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
      status: "active",
    };
    backendClientMock.getJenkinsFreezes
      .mockResolvedValueOnce([staleFreeze])
      .mockResolvedValue([]);
    backendClientMock.resolveJenkinsFreeze.mockResolvedValue({
      ...staleFreeze,
      resolvedAt: "2026-08-18T10:00:00Z",
      resolvedBy: "test",
      status: "resolved",
    });

    renderWithProviders(<TreePanel />);

    await screen.findByText("Smoke");
    await waitFor(() => {
      expect(backendClientMock.resolveJenkinsFreeze).toHaveBeenCalledWith("token-123", "freeze-stale");
    });
    // The folder is never painted frozen, because no pipeline under it is disabled in Jenkins.
    expect(screen.getAllByText("BE")[0]?.closest('[data-frozen="true"]')).toBeNull();
  });

  it("does not auto-resolve a freeze newer than the (stale) tree snapshot", async () => {
    backendClientMock.getJenkinsScope.mockResolvedValue(buildScope());
    backendClientMock.getJenkinsTreeCache.mockResolvedValue({
      // Stale cache fetched BEFORE the freeze: it still shows Smoke enabled, but it cannot
      // be trusted to contradict a freeze created after it.
      fetchedAt: "2026-08-17T10:00:00Z",
      refreshLease: null,
      roots: buildTreeRoots(),
      signature: "scope-1234",
      stale: false,
    });
    backendClientMock.getJenkinsFreezes.mockResolvedValue([
      {
        applied: true,
        createdAt: "2026-08-18T10:00:00Z",
        createdBy: "test",
        folderName: "BE",
        folderPath: "job/.QAA/job/E2E/job/PREPROD",
        id: "freeze-fresh",
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
    backendClientMock.resolveJenkinsFreeze.mockResolvedValue(undefined);

    renderWithProviders(<TreePanel />);

    await screen.findByText("Smoke");
    // Give the reconciliation effect room to (wrongly) fire before asserting it did not.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(backendClientMock.resolveJenkinsFreeze).not.toHaveBeenCalled();
  });

  it("renders the shared progress modal from poll results and disables resume actions while locked", async () => {
    backendClientMock.getJenkinsScope.mockResolvedValue(buildScope());
    backendClientMock.getJenkinsTreeCache.mockResolvedValue({
      fetchedAt: "2026-08-17T10:00:00Z",
      refreshLease: null,
      roots: buildTreeRoots("disabled"),
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
        id: "freeze-exact",
        killBuilds: false,
        mergedIntoId: null,
        reason: "DR freeze",
        resolvedAt: null,
        resolvedBy: null,
        signature: "scope-1234",
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
        status: "active",
      },
    ]);
    backendClientMock.getJenkinsResumeRuns.mockResolvedValue([buildResumeRun("running")]);

    renderWithProviders(<TreePanel />);

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

    backendClientMock.getJenkinsScope.mockResolvedValue(buildScope());
    backendClientMock.getJenkinsTreeCache.mockResolvedValue({
      fetchedAt: "2026-08-17T10:00:00Z",
      refreshLease: null,
      roots: buildTreeRoots(),
      signature: "scope-1234",
      stale: false,
    });
    backendClientMock.getJenkinsResumeRuns.mockResolvedValue([buildResumeRun("running")]);
    backendClientMock.cancelJenkinsResumeRun.mockResolvedValue(buildResumeRun("cancelled"));

    renderWithProviders(<TreePanel />);

    await user.click(await screen.findByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(backendClientMock.cancelJenkinsResumeRun).toHaveBeenCalledWith("token-123", "run-1");
    });
  });

  it("cancels a tracked running resume run when the shared list no longer reports it", async () => {
    const user = userEvent.setup();

    backendClientMock.getJenkinsScope.mockResolvedValue(buildScope());
    backendClientMock.getJenkinsTreeCache.mockResolvedValue({
      fetchedAt: "2026-08-17T10:00:00Z",
      refreshLease: null,
      roots: buildTreeRoots("disabled"),
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
        id: "freeze-exact",
        killBuilds: false,
        mergedIntoId: null,
        reason: "DR freeze",
        resolvedAt: null,
        resolvedBy: null,
        signature: "scope-1234",
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
        status: "active",
      },
    ]);
    backendClientMock.createJenkinsResumeRun.mockResolvedValue(buildResumeRun("running"));
    backendClientMock.getJenkinsResumeRuns.mockResolvedValue([]);
    backendClientMock.getJenkinsResumeRun.mockResolvedValue(buildResumeRun("running"));
    backendClientMock.cancelJenkinsResumeRun.mockResolvedValue(buildResumeRun("cancelled"));
    agentClientMock.startJenkinsResumeRun.mockResolvedValue({ runId: "run-1" });

    renderWithProviders(<TreePanel />);

    const beRow = (await screen.findAllByText("BE"))[0]?.closest('[data-frozen="true"]');
    expect(beRow).not.toBeNull();
    await user.click(within(beRow as HTMLElement).getByRole("button", { name: "Resume folder" }));

    const resumeDialog = await screen.findByRole("dialog", { name: "Resume Jenkins folder" });
    await user.click(within(resumeDialog).getByRole("button", { name: "Resume folder" }));

    expect(await screen.findByRole("dialog", { name: "Resume campaign" })).toBeInTheDocument();
    await waitFor(() => {
      expect(backendClientMock.getJenkinsResumeRuns).toHaveBeenCalledTimes(2);
    });

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(backendClientMock.cancelJenkinsResumeRun).toHaveBeenCalledWith("token-123", "run-1");
    });
  });

  it("shows a terminal summary and releases the lock when the run finishes", async () => {
    backendClientMock.getJenkinsScope.mockResolvedValue(buildScope());
    backendClientMock.getJenkinsTreeCache.mockResolvedValue({
      fetchedAt: "2026-08-17T10:00:00Z",
      refreshLease: null,
      roots: buildTreeRoots("disabled"),
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
        id: "freeze-exact",
        killBuilds: false,
        mergedIntoId: null,
        reason: "DR freeze",
        resolvedAt: null,
        resolvedBy: null,
        signature: "scope-1234",
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
        status: "active",
      },
    ]);
    backendClientMock.getJenkinsResumeRuns
      .mockResolvedValueOnce([buildResumeRun("running")])
      .mockResolvedValue([]);
    backendClientMock.getJenkinsResumeRun.mockResolvedValue(buildResumeRun("done"));

    const { queryClient } = renderWithProviders(<TreePanel />);

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
    backendClientMock.getJenkinsScope.mockResolvedValue(buildScope());
    backendClientMock.getJenkinsTreeCache.mockResolvedValue({
      fetchedAt: "2026-08-17T10:00:00Z",
      refreshLease: null,
      roots: buildTreeRoots("disabled"),
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
        id: "freeze-exact",
        killBuilds: false,
        mergedIntoId: null,
        reason: "DR freeze",
        resolvedAt: null,
        resolvedBy: null,
        signature: "scope-1234",
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
        status: "active",
      },
    ]);
    backendClientMock.getJenkinsResumeRuns
      .mockResolvedValueOnce([buildResumeRun("running")])
      .mockResolvedValue([]);
    backendClientMock.getJenkinsResumeRun.mockResolvedValue(buildResumeRun("cancelled"));

    const { queryClient } = renderWithProviders(<TreePanel />);

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
