import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const getPreflightMock = vi.hoisted(() => vi.fn());
const useTransientLiveJobMock = vi.hoisted(() => vi.fn());

vi.mock("@/api/agentClient", async () => {
  const actual = await vi.importActual<typeof import("@/api/agentClient")>("@/api/agentClient");
  return {
    ...actual,
    getPreflight: getPreflightMock,
  };
});

vi.mock("@/features/stagings/useTransientLiveJob", () => ({
  useTransientLiveJob: useTransientLiveJobMock,
}));

import { NamespacesPanel } from "@/features/stagings/NamespacesPanel";
import { renderWithProviders } from "@/test/render";
import { resetAuthStoreState, useAuthStore } from "@/store/authStore";

function readRequestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") {
    return input;
  }

  if (input instanceof URL) {
    return input.toString();
  }

  return input.url;
}

describe("NamespacesPanel", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    getPreflightMock.mockReset();
    useTransientLiveJobMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    localStorage.clear();
    resetAuthStoreState();

    useAuthStore.setState({
      currentUser: {
        auto_login: false,
        created_at: "2026-08-09T00:00:00Z",
        display_name: "Test User",
        id: 2,
        is_admin: false,
        updated_at: "2026-08-09T00:00:00Z",
        username: "test",
      },
      token: "token-123",
    });

    useTransientLiveJobMock.mockReturnValue({
      cancelMutation: { isPending: false, mutateAsync: vi.fn() },
      clearLiveJob: vi.fn(),
      isJobRunning: false,
      liveJob: null,
      logViewportRef: { current: null },
      startLiveJob: vi.fn(),
    });

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it("renders separate cluster and local overlay groups with the correct badges", async () => {
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

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          clusterNamespaces: [
            {
              createdAt: "2026-08-07T15:17:19Z",
              name: "qa-demo",
              status: "Active",
            },
          ],
          exitCode: 0,
          localOverlays: [{ name: "qa-iam" }],
          raw: "raw output",
        }),
        {
          headers: {
            "Content-Type": "application/json",
          },
        }
      )
    );

    renderWithProviders(<NamespacesPanel />);

    expect(await screen.findByText("Cluster namespaces")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /qa-demo/i })).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Local overlays")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /qa-iam/i })).toBeInTheDocument();
    expect(screen.getByText("Local only - not on cluster")).toBeInTheDocument();
  });

  it("keeps credentials masked until reveal is clicked", async () => {
    const user = userEvent.setup();

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

    fetchMock.mockImplementation((input) => {
      const url = readRequestUrl(input);

      if (url.endsWith("/namespaces")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              clusterNamespaces: [{ createdAt: null, name: "qa-demo", status: "Active" }],
              exitCode: 0,
              localOverlays: [],
              raw: "qa-demo\n",
            }),
            {
              headers: {
                "Content-Type": "application/json",
              },
            }
          )
        );
      }

      if (url.endsWith("/namespaces/qa-demo/status")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              exitCode: 0,
              ns: "qa-demo",
              raw: "pod/iam-api Running\n",
            }),
            {
              headers: {
                "Content-Type": "application/json",
              },
            }
          )
        );
      }

      if (url.endsWith("/namespaces/qa-demo/creds")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              exitCode: 0,
              ns: "qa-demo",
              raw: "sysadmin: secret-token\nreseller: resale-pass\n",
            }),
            {
              headers: {
                "Content-Type": "application/json",
              },
            }
          )
        );
      }

      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });

    renderWithProviders(<NamespacesPanel />);

    await user.click(await screen.findByRole("button", { name: /qa-demo/i }));
    expect(await screen.findByText("pod/iam-api Running")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Load credentials" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Reveal" })).toBeEnabled();
    });

    expect(screen.getByLabelText("Credentials output")).toHaveTextContent("********* ************");
    expect(screen.queryByText("sysadmin: secret-token")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reveal" }));

    expect(screen.getByLabelText("Credentials output")).toHaveTextContent("sysadmin: secret-token");
    expect(screen.getByRole("button", { name: "Copy" })).toBeEnabled();
  });

  it("requires explicit destroy confirmation before calling the agent", async () => {
    const user = userEvent.setup();

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

    fetchMock.mockImplementation((input) => {
      const url = readRequestUrl(input);

      if (url.endsWith("/namespaces")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              clusterNamespaces: [{ createdAt: null, name: "qa-demo", status: "Active" }],
              exitCode: 0,
              localOverlays: [],
              raw: "qa-demo\n",
            }),
            {
              headers: {
                "Content-Type": "application/json",
              },
            }
          )
        );
      }

      if (url.endsWith("/namespaces/qa-demo/status")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              exitCode: 0,
              ns: "qa-demo",
              raw: "pod/iam-api Running\n",
            }),
            {
              headers: {
                "Content-Type": "application/json",
              },
            }
          )
        );
      }

      if (url.endsWith("/destroy")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              jobId: "job-123",
              opId: "00000000-0000-0000-0000-000000000123",
            }),
            {
              headers: {
                "Content-Type": "application/json",
              },
              status: 202,
            }
          )
        );
      }

      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });

    renderWithProviders(<NamespacesPanel />);

    await user.click(await screen.findByRole("button", { name: /qa-demo/i }));
    await screen.findByText("pod/iam-api Running");

    const destroyButton = screen.getByRole("button", { name: "Destroy namespace" });
    expect(destroyButton).toBeDisabled();
    expect(fetchMock.mock.calls.some(([input]) => readRequestUrl(input).endsWith("/destroy"))).toBe(false);

    await user.type(screen.getByLabelText("Type namespace to confirm destroy"), "qa-demo");
    expect(destroyButton).toBeEnabled();

    await user.click(destroyButton);

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => readRequestUrl(input).endsWith("/destroy"))).toBe(true);
    });
  });

  it("shows the companion-app absent state and disables refresh", async () => {
    getPreflightMock.mockResolvedValue({
      detected: false,
      ports: [47600, 47601],
    });

    renderWithProviders(<NamespacesPanel />);

    expect(await screen.findByText("Companion app is not running")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh namespaces" })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
