import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const backendClientMock = vi.hoisted(() => ({
  listOperations: vi.fn(),
}));
const getPreflightMock = vi.hoisted(() => vi.fn());
const useTransientLiveJobMock = vi.hoisted(() => vi.fn());

vi.mock("@/api/agentClient", async () => {
  const actual = await vi.importActual<typeof import("@/api/agentClient")>("@/api/agentClient");
  return {
    ...actual,
    getPreflight: getPreflightMock,
  };
});

vi.mock("@/api/backendClient", () => ({
  backendClient: backendClientMock,
}));

vi.mock("@/features/stagings/useTransientLiveJob", () => ({
  useTransientLiveJob: useTransientLiveJobMock,
}));

import { NamespacesPanel } from "@/features/stagings/NamespacesPanel";
import { OperationType, SectionKey, TabId } from "@/constants";
import { renderWithProviders } from "@/test/render";
import { resetAuthStoreState, useAuthStore } from "@/store/authStore";
import { resetStagingsStoreState, useStagingsStore } from "@/store/stagingsStore";
import { resetUiStoreState, useUiStore } from "@/store/uiStore";

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
    backendClientMock.listOperations.mockReset();
    fetchMock.mockReset();
    getPreflightMock.mockReset();
    useTransientLiveJobMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    localStorage.clear();
    resetAuthStoreState();
    resetStagingsStoreState();
    resetUiStoreState();

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
              clusterNamespaces: [],
              exitCode: 0,
              localOverlays: [{ name: "qa-demo" }],
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

  it("prepares a bump redeploy draft for cluster namespaces", async () => {
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

    backendClientMock.listOperations.mockResolvedValue({
      items: [
        {
          agent_host: "laptop",
          agent_version: "0.1.0",
          created_at: "2026-08-09T10:00:00Z",
          exit_code: 0,
          finished_at: "2026-08-09T10:05:00Z",
          id: "00000000-0000-0000-0000-000000000111",
          ns: "qa-demo",
          recipe: {
            flags: {
              clean: true,
              dryRun: false,
              full: true,
              noSync: true,
              stage: 4,
            },
            images: {
              "iam-api": "sha-fixed",
            },
            product: null,
            services: ["iam-api", "billing"],
            suites: [],
          },
          stagings_sha: "abc123",
          started_at: "2026-08-09T10:00:00Z",
          status: "success",
          type: OperationType.DEPLOY,
          user_id: 2,
        },
      ],
      limit: 1,
      offset: 0,
      total: 1,
    });

    fetchMock.mockImplementation((input) => {
      const url = readRequestUrl(input);

      if (url.endsWith("/namespaces")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              clusterNamespaces: [{ createdAt: null, hasLocalOverlay: false, name: "qa-demo", status: "Active" }],
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

      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });

    renderWithProviders(<NamespacesPanel />);

    await user.click(await screen.findByRole("button", { name: /qa-demo/i }));
    await screen.findByText("pod/iam-api Running");
    expect(screen.queryByRole("button", { name: "Prepare namespace recreation" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Prepare in-place redeploy" }));

    await waitFor(() => {
      expect(backendClientMock.listOperations).toHaveBeenCalledWith("token-123", {
        limit: 1,
        ns: "qa-demo",
        offset: 0,
        type: OperationType.DEPLOY,
      });
    });

    await waitFor(() => {
      const draft = useStagingsStore.getState().deployDraft;
      expect(draft.ns).toBe("qa-demo");
      expect(draft.servicesText).toBe("iam-api, billing");
      expect(draft.imageRows[0]).toEqual({ service: "iam-api", tag: "sha-fixed" });
      expect(draft.flags.clean).toBe(false);
      expect(draft.flags.full).toBe(false);
      expect(draft.flags.noSync).toBe(false);
      expect(draft.flags.stageText).toBe("");
    });

    expect(useUiStore.getState().tabsBySection[SectionKey.STAGINGS].activeTabId).toBe(TabId.STAGINGS_DEPLOY);
  });

  it("clears the prepare deploy error when another namespace is selected", async () => {
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
              clusterNamespaces: [],
              exitCode: 0,
              localOverlays: [{ name: "qa-missing" }, { name: "qa-ready" }],
              raw: "qa-missing\nqa-ready\n",
            }),
            {
              headers: {
                "Content-Type": "application/json",
              },
            }
          )
        );
      }

      if (url.endsWith("/namespaces/qa-missing/status")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              exitCode: 0,
              ns: "qa-missing",
              raw: "not provisioned\n",
            }),
            {
              headers: {
                "Content-Type": "application/json",
              },
            }
          )
        );
      }

      if (url.endsWith("/namespaces/qa-ready/status")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              exitCode: 0,
              ns: "qa-ready",
              raw: "not provisioned\n",
            }),
            {
              headers: {
                "Content-Type": "application/json",
              },
            }
          )
        );
      }

      if (url.endsWith("/namespaces/qa-missing/deploy-recipe")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              detail: "No recorded deploy recipe was found for qa-missing.",
            }),
            {
              headers: {
                "Content-Type": "application/json",
              },
              status: 404,
            }
          )
        );
      }

      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });

    renderWithProviders(<NamespacesPanel />);

    await user.click(await screen.findByRole("button", { name: /qa-missing/i }));
    await screen.findByText("not provisioned");
    await user.click(screen.getByRole("button", { name: "Repeat previous deploy" }));

    expect(await screen.findByText("Prepare deploy draft failed")).toBeInTheDocument();
    expect(screen.getByText("No recorded deploy recipe was found for qa-missing.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /qa-ready/i }));

    await waitFor(() => {
      expect(screen.queryByText("Prepare deploy draft failed")).not.toBeInTheDocument();
    });
  });

  it("repeats the latest deploy recipe for local overlays", async () => {
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
              clusterNamespaces: [],
              exitCode: 0,
              localOverlays: [{ name: "qa-iam" }],
              raw: "qa-iam\n",
            }),
            {
              headers: {
                "Content-Type": "application/json",
              },
            }
          )
        );
      }

      if (url.endsWith("/namespaces/qa-iam/status")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              exitCode: 0,
              ns: "qa-iam",
              raw: "not provisioned\n",
            }),
            {
              headers: {
                "Content-Type": "application/json",
              },
            }
          )
        );
      }

      if (url.endsWith("/namespaces/qa-iam/deploy-recipe")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ns: "qa-iam",
              recipe: {
                flags: {
                  clean: true,
                  dryRun: false,
                  full: true,
                  noSync: true,
                  stage: 3,
                },
                images: {
                  "iam-api": "sha-local",
                },
                product: null,
                services: ["iam-api", "billing"],
                suites: [],
              },
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

    await user.click(await screen.findByRole("button", { name: /qa-iam/i }));
    await screen.findByText("not provisioned");
    await user.click(screen.getByRole("button", { name: "Repeat previous deploy" }));

    await waitFor(() => {
      const draft = useStagingsStore.getState().deployDraft;
      expect(draft.ns).toBe("qa-iam");
      expect(draft.servicesText).toBe("iam-api, billing");
      expect(draft.imageRows[0]).toEqual({ service: "iam-api", tag: "sha-local" });
      expect(draft.flags.clean).toBe(true);
      expect(draft.flags.full).toBe(true);
      expect(draft.flags.noSync).toBe(true);
      expect(draft.flags.stageText).toBe("3");
    });

    expect(backendClientMock.listOperations).not.toHaveBeenCalled();
    expect(useUiStore.getState().tabsBySection[SectionKey.STAGINGS].activeTabId).toBe(TabId.STAGINGS_DEPLOY);
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
              clusterNamespaces: [],
              exitCode: 0,
              localOverlays: [{ name: "qa-demo" }],
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

  it("hides destroy controls for cluster namespaces even when a local overlay exists", async () => {
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
              clusterNamespaces: [{ createdAt: null, hasLocalOverlay: true, name: "qa-demo", status: "Active" }],
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

      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });

    renderWithProviders(<NamespacesPanel />);

    await userEvent.setup().click(await screen.findByRole("button", { name: /qa-demo/i }));
    await screen.findByText("pod/iam-api Running");

    expect(
      screen.getByText(/Destroy is available only when the namespace is selected from Local overlays\./)
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Type namespace to confirm destroy")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Destroy namespace" })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([input]) => readRequestUrl(input).endsWith("/destroy"))).toBe(false);
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
