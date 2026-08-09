import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const getPreflightMock = vi.hoisted(() => vi.fn());

vi.mock("@/api/agentClient", async () => {
  const actual = await vi.importActual<typeof import("@/api/agentClient")>("@/api/agentClient");
  return {
    ...actual,
    getPreflight: getPreflightMock,
  };
});

import { NamespacesPanel } from "@/features/stagings/NamespacesPanel";
import { renderWithProviders } from "@/test/render";
import { resetAuthStoreState, useAuthStore } from "@/store/authStore";

function createChunkedStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

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

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it("renders namespace rows and the empty parsed-list state", async () => {
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

    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            exitCode: 0,
            namespaces: ["qa-demo", "qa-other"],
            raw: "qa-demo\nqa-other\n",
          }),
          {
            headers: {
              "Content-Type": "application/json",
            },
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            exitCode: 0,
            namespaces: [],
            raw: "No active namespaces.\n",
          }),
          {
            headers: {
              "Content-Type": "application/json",
            },
          }
        )
      );

    const firstRender = renderWithProviders(<NamespacesPanel />);

    expect(await screen.findByRole("button", { name: "qa-demo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "qa-other" })).toBeInTheDocument();

    firstRender.unmount();
    renderWithProviders(<NamespacesPanel />);

    expect(await screen.findByText("No namespaces were parsed.")).toBeInTheDocument();
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
              exitCode: 0,
              namespaces: ["qa-demo"],
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

    await user.click(await screen.findByRole("button", { name: "qa-demo" }));
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

  it("streams live logs from a synthetic SSE body and updates the badge", async () => {
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
              exitCode: 0,
              namespaces: ["qa-demo"],
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

      if (url.includes("/namespaces/qa-demo/logs?deploy=iam-api")) {
        return Promise.resolve(
          new Response(
            createChunkedStream([
              'event: log\ndata: {"type":"line","line":"line one"}\n\n',
              'event: log\ndata: {"type":"line","line":"line two"}\n\n',
              'event: terminal\ndata: {"type":"terminal","status":"success","exitCode":0}\n\n',
            ]),
            {
              headers: {
                "Content-Type": "text/event-stream",
              },
            }
          )
        );
      }

      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });

    renderWithProviders(<NamespacesPanel />);

    await user.click(await screen.findByRole("button", { name: "qa-demo" }));
    await user.type(await screen.findByLabelText("Deployment"), "iam-api");
    await user.click(screen.getByRole("button", { name: "Start" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Live log output")).toHaveTextContent("line one");
      expect(screen.getByLabelText("Live log output")).toHaveTextContent("line two");
    });
    expect(await screen.findByText("Success • exit 0")).toBeInTheDocument();
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
