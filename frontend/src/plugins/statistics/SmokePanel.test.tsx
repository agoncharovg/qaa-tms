import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const agentClientMock = vi.hoisted(() => ({
  getJenkinsFolder: vi.fn(),
  getJenkinsScope: vi.fn(),
}));

const backendClientMock = vi.hoisted(() => ({
  getJenkinsFolderCache: vi.fn(),
  putJenkinsFolderCache: vi.fn(),
}));

vi.mock("@/api/agentClient", () => ({
  agentClient: agentClientMock,
}));

vi.mock("@/api/backendClient", () => ({
  backendClient: backendClientMock,
}));

import { SmokePanel } from "@/plugins/statistics/SmokePanel";
import type { JenkinsBuild, JenkinsNode } from "@/api/types";
import { StorageKey } from "@/constants";
import { resetAuthStoreState, useAuthStore } from "@/store/authStore";
import { renderWithProviders } from "@/test/render";

const NOW = Date.now();
const MINUTE = 60_000;
const SIGNATURE = "scope-1234";

function build(number: number, overrides: Partial<JenkinsBuild> = {}): JenkinsBuild {
  return {
    number,
    result: "SUCCESS",
    building: false,
    timestamp: NOW - 5 * MINUTE,
    durationMs: 2 * MINUTE,
    url: `https://jenkins.test/${String(number)}/`,
    allureUrl: `https://jenkins.test/${String(number)}/allure/`,
    ...overrides,
  };
}

function pipelineNode(name: string, builds: JenkinsBuild[], status: string): JenkinsNode {
  return {
    name,
    path: `job/.QAA/job/E2E/job/PREPROD/job/SMOKE/job/${name}`,
    url: `https://jenkins.test/smoke/${name}/`,
    kind: "pipeline",
    status: status as JenkinsNode["status"],
    color: null,
    synthetic: false,
    scheduled: false,
    builds,
    children: [],
  };
}

function buildScope() {
  return {
    historyLimit: 8,
    rootFolders: ["PREPROD"],
    rootGroups: [{ label: "BE", path: "job/.QAA/job/E2E" }],
    signature: SIGNATURE,
    treeDepth: 5,
  };
}

function buildFolderCache(roots: JenkinsNode[], overrides: Partial<Record<string, unknown>> = {}) {
  return {
    fetchedAt: "2026-08-17T10:00:00Z",
    path: "job/.QAA/job/E2E/job/PREPROD/job/SMOKE",
    refreshLease: null,
    roots,
    signature: SIGNATURE,
    stale: false,
    ...overrides,
  };
}

describe("SmokePanel", () => {
  beforeEach(() => {
    resetAuthStoreState();
    useAuthStore.setState({ token: "test-token" });
    localStorage.clear();
    agentClientMock.getJenkinsFolder.mockReset();
    agentClientMock.getJenkinsScope.mockReset();
    backendClientMock.getJenkinsFolderCache.mockReset();
    backendClientMock.putJenkinsFolderCache.mockReset();
    agentClientMock.getJenkinsScope.mockResolvedValue(buildScope());
  });

  it("renders each SMOKE pipeline with status summary counts", async () => {
    backendClientMock.getJenkinsFolderCache.mockResolvedValue(
      buildFolderCache([
        pipelineNode("Balancer Smoke", [build(1)], "passed"),
        pipelineNode("Cloud Smoke", [build(2, { result: "FAILURE" })], "failed"),
        pipelineNode("Billing Smoke", [build(3, { building: true, result: null })], "running"),
      ])
    );

    renderWithProviders(<SmokePanel agentPort={47600} />);

    await waitFor(() => {
      expect(screen.getByText("Balancer Smoke")).toBeInTheDocument();
    });
    expect(screen.getByText("Cloud Smoke")).toBeInTheDocument();
    expect(screen.getByText("Billing Smoke")).toBeInTheDocument();

    expect(screen.getByText("1 OK")).toBeInTheDocument();
    expect(screen.getByText("1 failed")).toBeInTheDocument();
    expect(screen.getByText("1 running")).toBeInTheDocument();

    // Default auto-refresh cadence is 1m and the selector offers 1m/2m/5m.
    expect(screen.getByRole("radio", { name: "1m" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "2m" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "5m" })).toBeInTheDocument();
  });

  it("fetches live via the agent and writes the shared cache when the snapshot is stale", async () => {
    backendClientMock.getJenkinsFolderCache.mockResolvedValue(
      buildFolderCache([], { refreshLease: "lease-1", stale: true })
    );
    agentClientMock.getJenkinsFolder.mockResolvedValue({ roots: [] });
    backendClientMock.putJenkinsFolderCache.mockResolvedValue(buildFolderCache([]));

    renderWithProviders(<SmokePanel agentPort={47600} />);

    await waitFor(() => {
      expect(agentClientMock.getJenkinsFolder).toHaveBeenCalledWith(
        47600,
        "test-token",
        "job/.QAA/job/E2E/job/PREPROD/job/SMOKE"
      );
    });
    await waitFor(() => {
      expect(backendClientMock.putJenkinsFolderCache).toHaveBeenCalledWith("test-token", {
        path: "job/.QAA/job/E2E/job/PREPROD/job/SMOKE",
        refreshLease: "lease-1",
        roots: [],
        signature: SIGNATURE,
      });
    });
  });

  it("persists the selected refresh period across remounts via localStorage", async () => {
    const user = userEvent.setup();
    backendClientMock.getJenkinsFolderCache.mockResolvedValue(buildFolderCache([]));

    const { unmount } = renderWithProviders(<SmokePanel agentPort={47600} />);

    await waitFor(() => {
      expect(screen.getByRole("radio", { name: "1m" })).toBeChecked();
    });

    await user.click(screen.getByRole("radio", { name: "2m" }));

    expect(localStorage.getItem(StorageKey.SMOKE_REFRESH)).toBe("120000");

    unmount();

    renderWithProviders(<SmokePanel agentPort={47600} />);

    await waitFor(() => {
      expect(screen.getByRole("radio", { name: "2m" })).toBeChecked();
    });
  });
});
