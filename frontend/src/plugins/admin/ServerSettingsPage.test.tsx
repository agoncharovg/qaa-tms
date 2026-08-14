import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const backendClientMock = vi.hoisted(() => ({
  getServerSettings: vi.fn(),
  updateServerSettings: vi.fn(),
}));

vi.mock("@/api/backendClient", () => ({
  backendClient: backendClientMock,
}));

import { ServerSettingsPage } from "@/plugins/admin/ServerSettingsPage";
import { renderWithProviders } from "@/test/render";
import { resetAuthStoreState, useAuthStore } from "@/store/authStore";

const serverSettingsResponse = {
  qaa_generator_base_url: "http://qaa.example/api/v1",
  qaa_generator_port_forward_enabled: true,
  qaa_generator_port_forward_local_port: 18080,
  qaa_generator_port_forward_namespace: "qaa-prod",
  qaa_generator_port_forward_remote_port: 8080,
  qaa_generator_port_forward_resource: "svc/qaa-generator",
  qaa_generator_superuser_token_set: true,
};

function seedAdminAuth(): void {
  useAuthStore.setState({
    currentUser: {
      auto_login: false,
      created_at: "2026-08-13T00:00:00Z",
      display_name: "Admin User",
      enabled_plugins: [],
      id: 1,
      is_admin: true,
      updated_at: "2026-08-13T00:00:00Z",
      username: "admin",
    },
    token: "token-123",
  });
}

describe("ServerSettingsPage", () => {
  beforeEach(() => {
    localStorage.clear();
    resetAuthStoreState();
    backendClientMock.getServerSettings.mockReset();
    backendClientMock.updateServerSettings.mockReset();
    seedAdminAuth();
  });

  it("loads the backend-held server settings and masks the superuser token", async () => {
    backendClientMock.getServerSettings.mockResolvedValue(serverSettingsResponse);

    renderWithProviders(<ServerSettingsPage />);

    expect(await screen.findByDisplayValue("http://qaa.example/api/v1")).toBeInTheDocument();
    expect(screen.getByText("•••• set")).toBeInTheDocument();
    expect(screen.getByLabelText("Superuser token")).toHaveAttribute("autocomplete", "new-password");
    expect(screen.getByLabelText("Superuser token")).toHaveAttribute("name", "qaa-generator-superuser-token");
    expect(screen.queryByLabelText("Actor")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Service token")).not.toBeInTheDocument();
  });

  it("saves edited server settings through the admin endpoint", async () => {
    const user = userEvent.setup();
    backendClientMock.getServerSettings.mockResolvedValue(serverSettingsResponse);
    backendClientMock.updateServerSettings.mockResolvedValue({
      ...serverSettingsResponse,
      qaa_generator_base_url: "http://updated.example/api/v1",
    });

    renderWithProviders(<ServerSettingsPage />);

    await screen.findByDisplayValue("http://qaa.example/api/v1");

    await user.clear(screen.getByLabelText("QAA generator base URL"));
    await user.type(screen.getByLabelText("QAA generator base URL"), "http://updated.example/api/v1");
    await user.type(screen.getByLabelText("Superuser token"), "updated-super-token");
    await user.click(screen.getByRole("button", { name: "Save server settings" }));

    await waitFor(() => {
      expect(backendClientMock.updateServerSettings).toHaveBeenCalledWith("token-123", {
        qaa_generator_base_url: "http://updated.example/api/v1",
        qaa_generator_port_forward_enabled: true,
        qaa_generator_port_forward_local_port: 18080,
        qaa_generator_port_forward_namespace: "qaa-prod",
        qaa_generator_port_forward_remote_port: 8080,
        qaa_generator_port_forward_resource: "svc/qaa-generator",
        qaa_generator_superuser_token: "updated-super-token",
      });
    });
  });
});
