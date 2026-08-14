import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const agentClientMock = vi.hoisted(() => ({
  discoverAgent: vi.fn(),
  getConfiguredAgentPorts: vi.fn(),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}));

const backendClientMock = vi.hoisted(() => ({
  updateMe: vi.fn(),
}));

vi.mock("@/api/agentClient", () => ({
  agentClient: {
    getSettings: agentClientMock.getSettings,
    updateSettings: agentClientMock.updateSettings,
  },
  discoverAgent: agentClientMock.discoverAgent,
  getConfiguredAgentPorts: agentClientMock.getConfiguredAgentPorts,
}));

vi.mock("@/api/backendClient", () => ({
  backendClient: backendClientMock,
}));

import { SettingsPanel } from "@/plugins/profile/SettingsPanel";
import { PluginId } from "@/constants";
import { renderWithProviders } from "@/test/render";
import { resetAuthStoreState, useAuthStore } from "@/store/authStore";
import type { User } from "@/api/types";

const agentSettingsResponse = {
  jenkins_url: "https://jenkins.example",
  jenkins_username: "agent-user",
  jenkins_token_set: true,
  jenkins_root_path: "job/.QAA/job/E2E",
  jenkins_root_folders: ["PREPROD", "PROD"],
  jenkins_request_timeout: 15,
  jenkins_tree_depth: 5,
  jenkins_stuck_min_idle_hours: 6,
  staging_bin: "/usr/local/bin/staging",
  stagings_repo: "/work/stagings",
  staging_kubeconfig: "~/.kube/ai-staging.yaml",
  staging_kubeconfig_url: "https://kubeconf.example/config",
  kubeconfig_active_path: "~/.kube/config",
  staging_kubeconfig_max_age_hours: 48,
  kubectl_bin: "kubectl",
  kubeconfig: "~/.kube/config",
  kubectl_request_timeout: "10s",
};

function createCurrentUser(enabledPlugins: User["enabled_plugins"]): User {
  return {
    auto_login: false,
    created_at: "2026-08-13T00:00:00Z",
    display_name: "Test User",
    enabled_plugins: enabledPlugins,
    qaa_generator_token_set: false,
    id: 2,
    is_admin: false,
    updated_at: "2026-08-13T00:00:00Z",
    username: "test",
  };
}

describe("SettingsPanel", () => {
  beforeEach(() => {
    localStorage.clear();
    resetAuthStoreState();
    agentClientMock.discoverAgent.mockReset();
    agentClientMock.getConfiguredAgentPorts.mockReset();
    agentClientMock.getSettings.mockReset();
    agentClientMock.updateSettings.mockReset();
    backendClientMock.updateMe.mockReset();
    agentClientMock.getConfiguredAgentPorts.mockReturnValue([47600, 47601]);
  });

  it("renders only the enabled plugin cards and shows the companion-unavailable note once", async () => {
    useAuthStore.setState({
      currentUser: createCurrentUser([PluginId.JENKINS]),
      token: "token-123",
    });
    agentClientMock.discoverAgent.mockResolvedValue(null);

    renderWithProviders(<SettingsPanel />);

    expect(await screen.findByText("Companion app is not running")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Jenkins" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Stagings" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Kuber" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "qaa-generator" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Application" })).not.toBeInTheDocument();
  });

  it("saves each companion-backed plugin with a partial payload", async () => {
    const user = userEvent.setup();

    useAuthStore.setState({
      currentUser: createCurrentUser([PluginId.JENKINS, PluginId.STAGINGS, PluginId.KUBER]),
      token: "token-123",
    });
    agentClientMock.discoverAgent.mockResolvedValue({
      agent: {
        app: "qaa-tms-agent",
        os: "linux",
        stagingsInstalled: true,
        stagingsSha: "abc123",
        version: "0.1.0",
      },
      port: 47600,
    });
    agentClientMock.getSettings.mockResolvedValue(agentSettingsResponse);
    agentClientMock.updateSettings.mockResolvedValue(agentSettingsResponse);

    renderWithProviders(<SettingsPanel />);

    expect(await screen.findByRole("heading", { name: "Jenkins" })).toBeInTheDocument();

    const jenkinsUrlInput = await screen.findByLabelText("URL");
    await user.clear(jenkinsUrlInput);
    await user.type(jenkinsUrlInput, "https://updated.jenkins");
    await user.click(screen.getByRole("button", { name: "Save Jenkins settings" }));

    await waitFor(() => {
      expect(agentClientMock.updateSettings).toHaveBeenCalledWith(47600, "token-123", {
        jenkins_url: "https://updated.jenkins",
        jenkins_username: "agent-user",
      });
    });

    await user.clear(screen.getByLabelText("Staging kubeconfig path"));
    await user.type(screen.getByLabelText("Staging kubeconfig path"), "/tmp/staging.yaml");
    await user.click(screen.getByRole("button", { name: "Save Stagings settings" }));

    await waitFor(() => {
      expect(agentClientMock.updateSettings).toHaveBeenCalledWith(47600, "token-123", {
        staging_kubeconfig: "/tmp/staging.yaml",
        staging_kubeconfig_url: "https://kubeconf.example/config",
      });
    });

    await user.clear(screen.getByLabelText("Kubeconfig path"));
    await user.type(screen.getByLabelText("Kubeconfig path"), "/tmp/kubeconfig");
    await user.click(screen.getByRole("button", { name: "Save Kuber settings" }));

    await waitFor(() => {
      expect(agentClientMock.updateSettings).toHaveBeenCalledWith(47600, "token-123", {
        kubeconfig: "/tmp/kubeconfig",
      });
    });
  });

  it("renders qaa-generator personal token settings and saves them through updateMe", async () => {
    const user = userEvent.setup();
    const updatedUser = {
      ...createCurrentUser([PluginId.QAA_GENERATOR]),
      qaa_generator_token_set: true,
    };

    useAuthStore.setState({
      currentUser: createCurrentUser([PluginId.QAA_GENERATOR]),
      token: "token-123",
    });
    backendClientMock.updateMe.mockResolvedValue(updatedUser);

    renderWithProviders(<SettingsPanel />);

    expect(screen.getByRole("heading", { name: "qaa-generator" })).toBeInTheDocument();
    expect(agentClientMock.discoverAgent).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Application" })).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Personal token"), "personal-token");
    await user.click(screen.getByRole("button", { name: "Save qaa-generator token" }));

    await waitFor(() => {
      expect(backendClientMock.updateMe).toHaveBeenCalledWith("token-123", {
        qaa_generator_token: "personal-token",
      });
    });
    await waitFor(() => {
      expect(useAuthStore.getState().currentUser?.qaa_generator_token_set).toBe(true);
    });
  });
});
