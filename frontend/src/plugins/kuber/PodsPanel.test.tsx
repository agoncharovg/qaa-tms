import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const agentClientMock = vi.hoisted(() => ({
  deleteKubePod: vi.fn(),
  describeKubePod: vi.fn(),
  execKubePod: vi.fn(),
  getKubeContexts: vi.fn(),
  getKubeTop: vi.fn(),
  listKubeNamespaces: vi.fn(),
  listKubePods: vi.fn(),
  streamKubePodLogs: vi.fn(),
}));

vi.mock("@/api/agentClient", () => ({
  agentClient: agentClientMock,
}));

import { PodsPanel } from "@/plugins/kuber/PodsPanel";
import { resetKuberStoreState } from "@/plugins/kuber/kuberStore";
import { renderWithProviders } from "@/test/render";
import { resetAuthStoreState, useAuthStore } from "@/store/authStore";

function buildPodsResponse(context: string | null | undefined, namespace: string) {
  return {
    pods: [
      {
        containers: ["api"],
        createdAt: "2026-08-11T08:00:00Z",
        name: `${context ?? "current"}-${namespace}-pod`,
        node: "node-a",
        phase: "Running",
        ready: "1/1",
        restarts: 0,
      },
    ],
    exitCode: 0,
  };
}

function createDeferredPromise<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;

  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
}

function setCurrentUser(permissions: string[]) {
  useAuthStore.setState({
    currentUser: {
      auto_login: false,
      created_at: "2026-08-11T00:00:00Z",
      display_name: "Test User",
      effective_permissions: permissions,
      enabled_plugins: ["stagings", "kuber", "qaa-generator"],
      id: 2,
      is_admin: false,
      qaa_generator_token_set: false,
      updated_at: "2026-08-11T00:00:00Z",
      username: "test",
    },
    token: "token-123",
  });
}

async function openPodDrawer() {
  const user = userEvent.setup();
  await user.click(await screen.findByText("team/dev-qa-demo-pod"));
  await screen.findByText("Logs");
  return user;
}

describe("PodsPanel", () => {
  let lastDownloadBlob: Blob | null = null;

  beforeEach(() => {
    agentClientMock.deleteKubePod.mockReset();
    agentClientMock.describeKubePod.mockReset();
    agentClientMock.execKubePod.mockReset();
    agentClientMock.getKubeContexts.mockReset();
    agentClientMock.getKubeTop.mockReset();
    agentClientMock.listKubeNamespaces.mockReset();
    agentClientMock.listKubePods.mockReset();
    agentClientMock.streamKubePodLogs.mockReset();
    localStorage.clear();
    resetAuthStoreState();
    resetKuberStoreState();
    lastDownloadBlob = null;
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(HTMLAnchorElement.prototype, "click", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn((objectUrlTarget: Blob | MediaSource) => {
        if (objectUrlTarget instanceof Blob) {
          lastDownloadBlob = objectUrlTarget;
        }
        return "blob:pods-panel";
      }),
      writable: true,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
      writable: true,
    });

    setCurrentUser(["kuber.read", "kuber.use_context", "kuber.delete_pod", "kuber.exec"]);

    agentClientMock.getKubeContexts.mockResolvedValue({
      contexts: [
        {
          cluster: "dev-cluster",
          current: true,
          name: "team/dev",
          namespace: "qa-demo",
          user: "dev-user",
        },
        {
          cluster: "prod-cluster",
          current: false,
          name: "team/prod",
          namespace: "prod-ns",
          user: "prod-user",
        },
      ],
      currentContext: "team/dev",
      exitCode: 0,
    });
    agentClientMock.listKubeNamespaces.mockImplementation(
      (_port: number, _token: string, context?: string | null) => {
        if (context === "team/prod") {
          return Promise.resolve({
            namespaces: [{ name: "prod-ns", phase: "Active" }],
            exitCode: 0,
          });
        }
        return Promise.resolve({
          namespaces: [{ name: "qa-demo", phase: "Active" }],
          exitCode: 0,
        });
      }
    );
    agentClientMock.listKubePods.mockImplementation(
      (_port: number, _token: string, context: string | null | undefined, namespace: string) =>
        Promise.resolve(buildPodsResponse(context, namespace))
    );
    agentClientMock.streamKubePodLogs.mockImplementation(
      (
        _port: number,
        _token: string,
        _pod: string,
        _params: unknown,
        onMessage: (message: {
          event: "log" | "terminal";
          data:
            | { type: "line"; line: string }
            | { type: "terminal"; status: "success"; exitCode: 0 };
        }) => void
      ) => {
        onMessage({ event: "log", data: { type: "line", line: "line one" } });
        onMessage({
          event: "terminal",
          data: { type: "terminal", status: "success", exitCode: 0 },
        });
        return Promise.resolve();
      }
    );
    agentClientMock.execKubePod.mockImplementation(
      (
        _port: number,
        _token: string,
        _pod: string,
        params: { command: string },
        onMessage: (message: {
          event: "log" | "terminal";
          data:
            | { type: "line"; line: string }
            | { type: "terminal"; status: "success"; exitCode: 0 };
        }) => void
      ) => {
        onMessage({ event: "log", data: { type: "line", line: `out: ${params.command}` } });
        onMessage({
          event: "terminal",
          data: { type: "terminal", status: "success", exitCode: 0 },
        });
      }
    );
    agentClientMock.deleteKubePod.mockResolvedValue({
      raw: "deleted\n",
      exitCode: 0,
    });
  });

  it("uses the context and namespace selectors to drive pod queries", async () => {
    const user = userEvent.setup();

    renderWithProviders(<PodsPanel agentPort={47600} />);

    expect(await screen.findByText("team/dev-qa-demo-pod")).toBeInTheDocument();
    expect(agentClientMock.listKubePods).toHaveBeenCalledWith(
      47600,
      "token-123",
      "team/dev",
      "qa-demo",
      expect.anything()
    );

    await user.click(screen.getAllByLabelText("Context")[0]);
    await user.click(await screen.findByRole("option", { name: "team/prod" }));

    await waitFor(() => {
      expect(agentClientMock.listKubeNamespaces).toHaveBeenCalledWith(
        47600,
        "token-123",
        "team/prod",
        expect.anything()
      );
    });

    await waitFor(() => {
      expect(screen.getByText("team/prod-prod-ns-pod")).toBeInTheDocument();
    });
  });

  it("restores the persisted namespace on reload", async () => {
    vi.resetModules();
    const initialStoreModule = await import("@/plugins/kuber/kuberStore");

    initialStoreModule.resetKuberStoreState();
    initialStoreModule.useKuberStore.getState().setSelectedContext("team/prod");
    initialStoreModule.useKuberStore.getState().setSelectedNamespace("prod-ns");

    vi.resetModules();
    const reloadedStoreModule = await import("@/plugins/kuber/kuberStore");

    expect(reloadedStoreModule.useKuberStore.getState().selectedContext).toBe("team/prod");
    expect(reloadedStoreModule.useKuberStore.getState().selectedNamespace).toBe("prod-ns");
  });

  it("shows loading feedback while manually refreshing pods", async () => {
    const user = userEvent.setup();

    renderWithProviders(<PodsPanel agentPort={47600} />);

    expect(await screen.findByText("team/dev-qa-demo-pod")).toBeInTheDocument();

    const refreshButton = screen.getByRole("button", { name: "Refresh" });
    const deferredRefresh = createDeferredPromise<ReturnType<typeof buildPodsResponse>>();

    agentClientMock.listKubePods.mockImplementationOnce(
      (_port: number, _token: string, context: string | null | undefined, namespace: string) =>
        deferredRefresh.promise.then(() => buildPodsResponse(context, namespace))
    );

    await user.click(refreshButton);

    await waitFor(() => {
      expect(agentClientMock.listKubePods).toHaveBeenNthCalledWith(
        2,
        47600,
        "token-123",
        "team/dev",
        "qa-demo",
        expect.anything()
      );
    });

    expect(refreshButton).toBeDisabled();
    expect(refreshButton).toHaveAttribute("data-loading");

    deferredRefresh.resolve(buildPodsResponse("team/dev", "qa-demo"));

    await waitFor(() => {
      expect(refreshButton).toBeEnabled();
    });
  });

  it("keeps delete behind the type-to-confirm gate", async () => {
    renderWithProviders(<PodsPanel agentPort={47600} />);
    const user = await openPodDrawer();

    const deleteButton = screen.getByRole("button", { name: "Delete pod" });
    expect(deleteButton).toBeDisabled();

    await user.type(screen.getByLabelText("Type pod name to confirm delete"), "team/dev-qa-demo-pod");
    expect(deleteButton).toBeEnabled();

    await user.click(deleteButton);

    await waitFor(() => {
      expect(agentClientMock.deleteKubePod).toHaveBeenCalledWith(
        47600,
        "token-123",
        "team/dev-qa-demo-pod",
        {
          context: "team/dev",
          namespace: "qa-demo",
        }
      );
    });
  });

  it("shows the exec card only when the user has kuber.exec", async () => {
    setCurrentUser(["kuber.read"]);

    renderWithProviders(<PodsPanel agentPort={47600} />);
    await openPodDrawer();

    expect(screen.queryByText("Exec")).not.toBeInTheDocument();
  });

  it("runs pod exec commands and accumulates output across runs", async () => {
    renderWithProviders(<PodsPanel agentPort={47600} />);
    const user = await openPodDrawer();

    await user.type(screen.getByLabelText("Command"), "echo one");
    await user.click(screen.getByRole("button", { name: "Run" }));

    await waitFor(() => {
      expect(agentClientMock.execKubePod).toHaveBeenCalledWith(
        47600,
        "token-123",
        "team/dev-qa-demo-pod",
        {
          command: "echo one",
          container: "api",
          context: "team/dev",
          namespace: "qa-demo",
        },
        expect.any(Function),
        expect.any(AbortSignal)
      );
    });

    expect(await screen.findByText("$ echo one")).toBeInTheDocument();
    expect(screen.getByText("out: echo one")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Command"), "echo two");
    await user.click(screen.getByRole("button", { name: "Run" }));

    await waitFor(() => {
      expect(agentClientMock.execKubePod).toHaveBeenNthCalledWith(
        2,
        47600,
        "token-123",
        "team/dev-qa-demo-pod",
        {
          command: "echo two",
          container: "api",
          context: "team/dev",
          namespace: "qa-demo",
        },
        expect.any(Function),
        expect.any(AbortSignal)
      );
    });

    expect(screen.getByText("$ echo one")).toBeInTheDocument();
    expect(screen.getByText("out: echo one")).toBeInTheDocument();
    expect(screen.getByText("$ echo two")).toBeInTheDocument();
    expect(screen.getByText("out: echo two")).toBeInTheDocument();
  });

  it("shows truncation controls, reveals full output, and downloads the retained exec buffer", async () => {
    agentClientMock.execKubePod.mockImplementationOnce(
      (
        _port: number,
        _token: string,
        _pod: string,
        _params: { command: string },
        onMessage: (message: {
          event: "log" | "terminal";
          data:
            | { type: "line"; line: string }
            | { type: "terminal"; status: "success"; exitCode: 0 };
        }) => void
      ) => {
        for (let index = 0; index <= 5000; index += 1) {
          onMessage({ event: "log", data: { type: "line", line: `line ${index}` } });
        }
        onMessage({
          event: "terminal",
          data: { type: "terminal", status: "success", exitCode: 0 },
        });
      }
    );

    renderWithProviders(<PodsPanel agentPort={47600} />);
    const user = await openPodDrawer();

    await user.type(screen.getByLabelText("Command"), "bulk");
    await user.click(screen.getByRole("button", { name: "Run" }));

    expect(await screen.findByText("Output truncated to the last 5000 lines.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show all" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download" })).toBeInTheDocument();
    expect(screen.queryByText("line 0")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show all" }));

    expect(await screen.findByText("line 0")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Download" }));
    expect(lastDownloadBlob).toBeInstanceOf(Blob);
    if (!lastDownloadBlob) {
      throw new Error("Expected a download blob.");
    }
    expect(lastDownloadBlob.size).toBeGreaterThan(0);
    expect(lastDownloadBlob.type).toBe("text/plain;charset=utf-8");
    expect(vi.mocked(URL.createObjectURL)).toHaveBeenCalled();
  });
});
