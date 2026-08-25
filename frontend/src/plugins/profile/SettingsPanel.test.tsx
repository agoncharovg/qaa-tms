import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const agentClientMock = vi.hoisted(() => ({
  discoverAgent: vi.fn(),
  getPing: vi.fn(),
  getSettings: vi.fn(),
  requestUpdate: vi.fn(),
  updateSettings: vi.fn(),
}));

const backendClientMock = vi.hoisted(() => ({
  getAgentManifest: vi.fn(),
}));

vi.mock("@/api/agentClient", () => ({
  agentClient: {
    getPing: agentClientMock.getPing,
    getSettings: agentClientMock.getSettings,
    requestUpdate: agentClientMock.requestUpdate,
    updateSettings: agentClientMock.updateSettings,
  },
  discoverAgent: agentClientMock.discoverAgent,
}));

vi.mock("@/api/backendClient", () => ({
  backendClient: {
    getAgentManifest: backendClientMock.getAgentManifest,
  },
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
  qaa_generator_token_set: false,
  jenkins_root_groups: [
    { label: "BE", path: "job/.QAA/job/E2E" },
    { label: "FE", path: "job/.QAA/job/UI_E2E" },
  ],
  jenkins_root_folders: ["PREPROD", "PROD"],
  jenkins_history_limit: 8,
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
    agentClientMock.getPing.mockReset();
    agentClientMock.getSettings.mockReset();
    agentClientMock.requestUpdate.mockReset();
    agentClientMock.updateSettings.mockReset();
    backendClientMock.getAgentManifest.mockReset();
    backendClientMock.getAgentManifest.mockResolvedValue({
      downloadUrl: "/api/v1/agent/download",
      minSupported: "0.1.0",
      os: null,
      sha256: "abc123",
      version: "0.1.0",
    });
  });

  it("renders the shared companion install gate when the companion is missing", async () => {
    useAuthStore.setState({
      currentUser: createCurrentUser([PluginId.JENKINS]),
      token: "token-123",
    });
    agentClientMock.discoverAgent.mockResolvedValue(null);

    renderWithProviders(<SettingsPanel />);

    expect(await screen.findByText("Companion is not installed")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download" })).toHaveAttribute(
      "href",
      "/api/v1/agent/download"
    );
    expect(screen.queryByRole("heading", { name: "Jenkins" })).not.toBeInTheDocument();
  });

  it("does not render migrated shared-token settings even when those plugins are enabled", () => {
    useAuthStore.setState({
      currentUser: createCurrentUser([PluginId.NOTIFICATOR, PluginId.LEONID]),
      token: "token-123",
    });

    renderWithProviders(<SettingsPanel />);

    expect(screen.queryByRole("heading", { name: "Notificator" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Leonid" })).not.toBeInTheDocument();
  });

  it("saves Jenkins, Stagings, and Kuber settings with partial payloads", async () => {
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
    expect(await screen.findByLabelText("Kubeconfig path")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Leave empty to inherit ambient kubeconfig resolution (the KUBECONFIG env and/or ~/.kube/config), merged with the active-path symlink. Set a file to use it explicitly, or a directory to merge every *.yaml/*.yml inside it.",
      ),
    ).toBeInTheDocument();

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

  it("renders QAA generator personal token settings and saves them through the companion", async () => {
    const user = userEvent.setup();

    useAuthStore.setState({
      currentUser: createCurrentUser([PluginId.QAA_GENERATOR]),
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
    agentClientMock.updateSettings.mockResolvedValue({
      ...agentSettingsResponse,
      qaa_generator_token_set: true,
    });

    renderWithProviders(<SettingsPanel />);

    expect(await screen.findByRole("heading", { name: "QAA generator" })).toBeInTheDocument();

    await user.clear(screen.getByLabelText("Personal token"));
    await user.type(screen.getByLabelText("Personal token"), "personal-token");
    await user.click(screen.getByRole("button", { name: "Save qaa-generator token" }));

    await waitFor(() => {
      expect(agentClientMock.updateSettings).toHaveBeenCalledWith(47600, "token-123", {
        qaa_generator_token: "personal-token",
      });
    });
    await waitFor(() => {
      expect(screen.getAllByText("Settings saved.").length).toBeGreaterThan(0);
    });
  });
});
