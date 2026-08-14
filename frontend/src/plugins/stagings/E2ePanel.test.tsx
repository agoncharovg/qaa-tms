import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const agentClientMock = vi.hoisted(() => ({
  e2eRun: vi.fn(),
  getE2eSuites: vi.fn(),
  listNamespaces: vi.fn(),
}));
const getPreflightMock = vi.hoisted(() => vi.fn());
const useTransientLiveJobMock = vi.hoisted(() => vi.fn());

vi.mock("@/api/agentClient", () => ({
  agentClient: agentClientMock,
  getPreflight: getPreflightMock,
}));

vi.mock("@/plugins/stagings/useTransientLiveJob", () => ({
  useTransientLiveJob: useTransientLiveJobMock,
}));

import { E2ePanel } from "@/plugins/stagings/E2ePanel";
import { renderWithProviders } from "@/test/render";
import { resetAuthStoreState, useAuthStore } from "@/store/authStore";

describe("E2ePanel", () => {
  beforeEach(() => {
    agentClientMock.e2eRun.mockReset();
    agentClientMock.getE2eSuites.mockReset();
    agentClientMock.listNamespaces.mockReset();
    getPreflightMock.mockReset();
    useTransientLiveJobMock.mockReset();
    localStorage.clear();
    resetAuthStoreState();

    useAuthStore.setState({
      currentUser: {
        auto_login: false,
        created_at: "2026-08-09T00:00:00Z",
        display_name: "Test User",
        enabled_plugins: ["stagings"],
        qaa_generator_token_set: false,
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
      jobQuery: null,
      liveJob: null,
      logViewportRef: { current: null },
      reduceLiveJob: vi.fn(),
      startLiveJob: vi.fn(),
    });

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

    agentClientMock.getE2eSuites.mockResolvedValue({
      exitCode: 0,
      product: "Billing",
      suites: [
        {
          marks: "product_billing and smoke and not long_term",
          name: "smoke",
        },
        {
          marks: "backend_test and product_billing and not long_term",
          name: "full",
        },
      ],
    });
    agentClientMock.listNamespaces.mockResolvedValue({
      clusterNamespaces: [
        { createdAt: "2026-08-07T15:17:19Z", name: "qaa-demo", status: "Active" },
        { createdAt: "2026-08-07T15:17:20Z", name: "qaa-live", status: "Active" },
      ],
      exitCode: 0,
      localOverlays: [{ name: "qaa-iam" }, { name: "qaa-local" }],
      raw: "raw",
    });
    agentClientMock.e2eRun.mockResolvedValue({
      jobId: "job-123",
      opId: "00000000-0000-0000-0000-000000000123",
    });
  });

  it("shows namespace suggestions and uses the staging default threads count", async () => {
    const user = userEvent.setup();

    renderWithProviders(<E2ePanel />);

    const namespaceInput = await screen.findByRole("textbox", { name: "Namespace" });
    const threadsInput = screen.getByRole("spinbutton", { name: "Threads" });

    expect(namespaceInput).toHaveAttribute("placeholder", "qaa-demo");
    expect(threadsInput).toHaveValue(5);
    expect(screen.getByText(/suggestions include only deployed cluster namespaces/i)).toBeInTheDocument();
    expect(await screen.findByText("smoke")).toBeInTheDocument();

    await user.type(namespaceInput, "qaa");
    expect(await screen.findByRole("option", { name: "qaa-demo" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "qaa-live" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "qaa-iam" })).not.toBeInTheDocument();

    await user.clear(namespaceInput);
    await user.click(screen.getByRole("checkbox", { name: "smoke" }));
    await user.click(screen.getByRole("checkbox", { name: "full" }));
    await user.type(namespaceInput, "qaa-demo");
    await user.click(screen.getByRole("button", { name: "Run E2E" }));

    await waitFor(() => {
      expect(agentClientMock.listNamespaces).toHaveBeenCalledWith(47600, "token-123", expect.anything());
      expect(agentClientMock.e2eRun).toHaveBeenCalledWith(47600, "token-123", {
        ns: "qaa-demo",
        product: "Billing",
        suites: ["smoke", "full"],
        threads: 5,
      });
    });
  });

  it("still accepts a manually typed namespace that is not in suggestions", async () => {
    const user = userEvent.setup();

    renderWithProviders(<E2ePanel />);

    await user.click(await screen.findByRole("checkbox", { name: "smoke" }));
    await user.type(screen.getByRole("textbox", { name: "Namespace" }), "custom-ns");
    await user.click(screen.getByRole("button", { name: "Run E2E" }));

    await waitFor(() => {
      expect(agentClientMock.e2eRun).toHaveBeenCalledWith(47600, "token-123", {
        ns: "custom-ns",
        product: "Billing",
        suites: ["smoke"],
        threads: 5,
      });
    });
  });

  it("disables Run when the companion app is absent", async () => {
    getPreflightMock.mockResolvedValue({
      detected: false,
      ports: [47600, 47601],
    });

    renderWithProviders(<E2ePanel />);

    expect(await screen.findByText("Companion app is not running")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run E2E" })).toBeDisabled();
    expect(agentClientMock.getE2eSuites).not.toHaveBeenCalled();
    expect(agentClientMock.listNamespaces).not.toHaveBeenCalled();
  });
});
