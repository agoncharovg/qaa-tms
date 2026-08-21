import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const agentClientMock = vi.hoisted(() => ({
  deleteKubePod: vi.fn(),
  describeKubePod: vi.fn(),
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
import { renderWithProviders } from "@/test/render";
import { resetAuthStoreState, useAuthStore } from "@/store/authStore";
import { resetKuberStoreState } from "@/plugins/kuber/kuberStore";

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

describe("PodsPanel", () => {
  beforeEach(() => {
    agentClientMock.deleteKubePod.mockReset();
    agentClientMock.describeKubePod.mockReset();
    agentClientMock.getKubeContexts.mockReset();
    agentClientMock.getKubeTop.mockReset();
    agentClientMock.listKubeNamespaces.mockReset();
    agentClientMock.listKubePods.mockReset();
    agentClientMock.streamKubePodLogs.mockReset();
    localStorage.clear();
    resetAuthStoreState();
    resetKuberStoreState();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });

    useAuthStore.setState({
      currentUser: {
        auto_login: false,
        created_at: "2026-08-11T00:00:00Z",
        display_name: "Test User",
        enabled_plugins: ["stagings", "kuber", "qaa-generator"],
        qaa_generator_token_set: false,
        id: 2,
        is_admin: false,
        updated_at: "2026-08-11T00:00:00Z",
        username: "test",
      },
      token: "token-123",
    });

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

    expect(refreshButton).not.toHaveAttribute("data-loading");
  });

  it("keeps delete behind the type-to-confirm gate", async () => {
    const user = userEvent.setup();

    renderWithProviders(<PodsPanel agentPort={47600} />);

    await user.click(await screen.findByText("team/dev-qa-demo-pod"));
    await screen.findByText("Logs");

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
});
