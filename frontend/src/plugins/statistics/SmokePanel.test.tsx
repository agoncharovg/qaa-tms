import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const agentClientMock = vi.hoisted(() => ({
  discoverAgent: vi.fn(),
  getJenkinsFolder: vi.fn(),
}));

const backendClientMock = vi.hoisted(() => ({
  getJenkinsFolderCache: vi.fn(),
  getJenkinsScope: vi.fn(),
  putJenkinsFolderCache: vi.fn(),
}));

vi.mock("@/api/agentClient", () => ({
  agentClient: agentClientMock,
  discoverAgent: agentClientMock.discoverAgent,
}));

vi.mock("@/api/backendClient", () => ({
  backendClient: backendClientMock,
}));

import type { JenkinsBuild, JenkinsNode } from "@/api/types";
import { StorageKey } from "@/constants";
import { useCachedJenkinsResource } from "@/plugins/jenkins/useCachedJenkinsResource";
import { SmokePanel } from "@/plugins/statistics/SmokePanel";
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

function createQueryClientWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        retry: false,
      },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("SmokePanel", () => {
  beforeEach(() => {
    resetAuthStoreState();
    useAuthStore.setState({ token: "test-token" });
    localStorage.clear();
    agentClientMock.discoverAgent.mockReset();
    agentClientMock.getJenkinsFolder.mockReset();
    backendClientMock.getJenkinsFolderCache.mockReset();
    backendClientMock.getJenkinsScope.mockReset();
    backendClientMock.putJenkinsFolderCache.mockReset();
    backendClientMock.getJenkinsScope.mockResolvedValue(buildScope());
    agentClientMock.discoverAgent.mockResolvedValue(null);
  });

  it("renders each SMOKE pipeline with status summary counts", async () => {
    backendClientMock.getJenkinsFolderCache.mockResolvedValue(
      buildFolderCache([
        pipelineNode("Balancer Smoke", [build(1)], "passed"),
        pipelineNode("Cloud Smoke", [build(2, { result: "FAILURE" })], "failed"),
        pipelineNode("Billing Smoke", [build(3, { building: true, result: null })], "running"),
      ])
    );

    renderWithProviders(<SmokePanel />);

    await waitFor(() => {
      expect(screen.getByText("Balancer Smoke")).toBeInTheDocument();
    });
    expect(screen.getByText("Cloud Smoke")).toBeInTheDocument();
    expect(screen.getByText("Billing Smoke")).toBeInTheDocument();

    expect(screen.getByText("1 OK")).toBeInTheDocument();
    expect(screen.getByText("1 failed")).toBeInTheDocument();
    expect(screen.getByText("1 running")).toBeInTheDocument();

    expect(screen.getByRole("radio", { name: "1m" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "2m" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "5m" })).toBeInTheDocument();
  });

  it("warms the shared cache through the companion when the backend cache is cold", async () => {
    const liveFolderResolvers: Array<(value: { roots: JenkinsNode[] }) => void> = [];
    let cacheState = buildFolderCache([], { refreshLease: "lease-1", stale: true });
    const warmedRoots = [pipelineNode("Balancer Smoke", [build(1)], "passed")];

    agentClientMock.discoverAgent.mockResolvedValue({
      agent: {
        app: "qaa-tms-agent",
        os: "linux",
        stagingsInstalled: true,
        stagingsSha: "sha-123",
        version: "0.2.0",
      },
      port: 47600,
    });
    backendClientMock.getJenkinsFolderCache.mockImplementation(() => Promise.resolve(cacheState));
    agentClientMock.getJenkinsFolder.mockImplementation(
      () =>
        new Promise<{ roots: JenkinsNode[] }>((resolve) => {
          liveFolderResolvers[0] = resolve;
        })
    );
    backendClientMock.putJenkinsFolderCache.mockImplementation(() => {
      cacheState = buildFolderCache(warmedRoots);
      return Promise.resolve(undefined);
    });

    renderWithProviders(<SmokePanel />);

    await waitFor(() => {
      expect(liveFolderResolvers).toHaveLength(1);
      expect(screen.getByText("Warming shared SMOKE cache…")).toBeInTheDocument();
    });

    liveFolderResolvers[0]?.({ roots: warmedRoots });

    await waitFor(() => {
      expect(screen.getByText("Balancer Smoke")).toBeInTheDocument();
    });
    expect(agentClientMock.getJenkinsFolder).toHaveBeenCalledWith(
      47600,
      "test-token",
      "job/.QAA/job/E2E/job/PREPROD/job/SMOKE"
    );
    expect(backendClientMock.putJenkinsFolderCache).toHaveBeenCalledWith("test-token", {
      path: "job/.QAA/job/E2E/job/PREPROD/job/SMOKE",
      refreshLease: "lease-1",
      roots: warmedRoots,
      signature: SIGNATURE,
    });
    expect(screen.queryByText("No pipelines found in this folder.")).not.toBeInTheDocument();
  });

  it("shows a companion-specific empty state for a cold cache without a live agent", async () => {
    backendClientMock.getJenkinsFolderCache.mockResolvedValue(
      buildFolderCache([], { refreshLease: "lease-1", stale: true })
    );

    renderWithProviders(<SmokePanel />);

    await waitFor(() => {
      expect(
        screen.getByText("Cache is warming up. Start the companion app to populate SMOKE.")
      ).toBeInTheDocument();
    });
    expect(agentClientMock.getJenkinsFolder).not.toHaveBeenCalled();
    expect(backendClientMock.putJenkinsFolderCache).not.toHaveBeenCalled();
    expect(screen.queryByText("No pipelines found in this folder.")).not.toBeInTheDocument();
  });

  it("persists the selected refresh period across remounts via localStorage", async () => {
    const user = userEvent.setup();
    backendClientMock.getJenkinsFolderCache.mockResolvedValue(buildFolderCache([]));

    const { unmount } = renderWithProviders(<SmokePanel />);

    await waitFor(() => {
      expect(screen.getByRole("radio", { name: "1m" })).toBeChecked();
    });

    await user.click(screen.getByRole("radio", { name: "2m" }));

    expect(localStorage.getItem(StorageKey.SMOKE_REFRESH)).toBe("120000");

    unmount();

    renderWithProviders(<SmokePanel />);

    await waitFor(() => {
      expect(screen.getByRole("radio", { name: "2m" })).toBeChecked();
    });
  });
});

describe("useCachedJenkinsResource", () => {
  it("retries a stale lease after fetchLive returned null once live access becomes available", async () => {
    const fetchLive = vi
      .fn<() => Promise<string[] | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(["pipeline-a"]);
    const readCache = vi.fn().mockResolvedValue({
      data: [],
      fetchedAt: null,
      refreshLease: "lease-1",
      stale: true,
    });
    const writeCache = vi.fn().mockResolvedValue(undefined);

    const { rerender } = renderHook(
      ({ canFetchLive }) =>
        useCachedJenkinsResource<string>({
          canFetchLive,
          enabled: true,
          fetchLive,
          queryKey: ["jenkins-cache-test"],
          readCache,
          refetchInterval: false,
          staleTime: 60_000,
          writeCache,
        }),
      {
        initialProps: { canFetchLive: false },
        wrapper: createQueryClientWrapper(),
      }
    );

    await waitFor(() => {
      expect(fetchLive).toHaveBeenCalledTimes(1);
    });
    expect(writeCache).not.toHaveBeenCalled();

    rerender({ canFetchLive: true });

    await waitFor(() => {
      expect(writeCache).toHaveBeenCalledWith(["pipeline-a"], "lease-1");
    });
    expect(fetchLive).toHaveBeenCalledTimes(2);
  });
});

