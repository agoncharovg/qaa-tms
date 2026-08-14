import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const activateKubeconfigMock = vi.hoisted(() => vi.fn());
const getKubeconfigStatusMock = vi.hoisted(() => vi.fn());
const getPreflightMock = vi.hoisted(() => vi.fn());
const refreshKubeconfigMock = vi.hoisted(() => vi.fn());

vi.mock("@/api/agentClient", () => ({
  activateKubeconfig: activateKubeconfigMock,
  getKubeconfigStatus: getKubeconfigStatusMock,
  getPreflight: getPreflightMock,
  refreshKubeconfig: refreshKubeconfigMock,
}));

import { KubeconfigBanner } from "@/plugins/stagings/KubeconfigBanner";
import { QueryKey } from "@/constants";
import { renderWithProviders } from "@/test/render";
import { resetAuthStoreState, useAuthStore } from "@/store/authStore";

const DETECTED_AGENT = {
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
} as const;

const HEALTHY_ACTIVE_STATUS = {
  active: true,
  activePath: "/tmp/.kube/config",
  ageSeconds: 120,
  contentValid: true,
  exists: true,
  healthy: true,
  maxAgeSeconds: 172800,
  modifiedAt: "2026-08-11T08:00:00Z",
  path: "/tmp/.kube/ai-staging.yaml",
  reasons: ["healthy"],
  recommendedAction: "none",
  stale: false,
  tokenExpired: false,
  tokenExpiresAt: "2026-08-12T08:00:00Z",
  url: "https://kube.example/config",
} as const;

const STALE_STATUS = {
  ...HEALTHY_ACTIVE_STATUS,
  active: false,
  ageSeconds: 180000,
  healthy: false,
  reasons: ["stale", "not_active"],
  recommendedAction: "refresh_and_activate",
  stale: true,
} as const;

const HEALTHY_INACTIVE_STATUS = {
  ...HEALTHY_ACTIVE_STATUS,
  active: false,
  reasons: ["not_active"],
  recommendedAction: "activate",
} as const;

describe("KubeconfigBanner", () => {
  beforeEach(() => {
    activateKubeconfigMock.mockReset();
    getKubeconfigStatusMock.mockReset();
    getPreflightMock.mockReset();
    refreshKubeconfigMock.mockReset();
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
    getPreflightMock.mockResolvedValue(DETECTED_AGENT);
  });

  it("renders nothing when the kubeconfig is healthy and active", async () => {
    getKubeconfigStatusMock.mockResolvedValue(HEALTHY_ACTIVE_STATUS);

    renderWithProviders(<KubeconfigBanner />);

    await waitFor(() => {
      expect(getKubeconfigStatusMock).toHaveBeenCalledWith(47600, "token-123", expect.anything());
    });

    expect(screen.queryByText("Staging kubeconfig needs attention")).not.toBeInTheDocument();
    expect(screen.queryByText("Staging kubeconfig is not active")).not.toBeInTheDocument();
  });

  it("shows the stale warning and refresh-and-activate action", async () => {
    const user = userEvent.setup();
    getKubeconfigStatusMock.mockResolvedValue(STALE_STATUS);
    refreshKubeconfigMock.mockResolvedValue(HEALTHY_ACTIVE_STATUS);

    const { queryClient } = renderWithProviders(<KubeconfigBanner />);
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    expect(await screen.findByText("Staging kubeconfig needs attention")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Refresh & activate" }));

    await waitFor(() => {
      expect(refreshKubeconfigMock).toHaveBeenCalledWith(47600, "token-123", true);
    });
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: [QueryKey.KUBECONFIG_STATUS] });
    });
  });

  it("shows the activate action when the kubeconfig is healthy but inactive", async () => {
    const user = userEvent.setup();
    getKubeconfigStatusMock.mockResolvedValue(HEALTHY_INACTIVE_STATUS);
    activateKubeconfigMock.mockResolvedValue(HEALTHY_ACTIVE_STATUS);

    renderWithProviders(<KubeconfigBanner />);

    expect(await screen.findByText("Staging kubeconfig is not active")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Activate" }));

    await waitFor(() => {
      expect(activateKubeconfigMock).toHaveBeenCalledWith(47600, "token-123");
    });
  });

  it("renders the 409 error text from activation failures", async () => {
    const user = userEvent.setup();
    const conflictMessage =
      "The active kubeconfig path is a regular file and would be overwritten. Set AGENT_KUBECONFIG_ACTIVE_PATH to a managed symlink path, for example ~/.kube/kubecfg.yaml, and retry.";
    getKubeconfigStatusMock.mockResolvedValue(HEALTHY_INACTIVE_STATUS);
    activateKubeconfigMock.mockRejectedValue(new Error(conflictMessage));

    renderWithProviders(<KubeconfigBanner />);

    expect(await screen.findByText("Staging kubeconfig is not active")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Activate" }));

    expect(await screen.findByText(conflictMessage)).toBeInTheDocument();
  });
});
