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
  qaa_generator_actor: "actor",
  qaa_generator_base_url: "http://qaa.example/api/v1",
  qaa_generator_port_forward_enabled: true,
  qaa_generator_port_forward_local_port: 18080,
  qaa_generator_port_forward_namespace: "qaa-prod",
  qaa_generator_port_forward_remote_port: 8080,
  qaa_generator_port_forward_resource: "svc/qaa-generator",
  qaa_generator_service_token_set: true,
  qaa_generator_superuser_token_set: false,
};

function seedAdminAuth(): void {
  useAuthStore.setState({
    currentUser: {
      auto_login: false,
      created_at: "2026-08-13T00:00:00Z",
      display_name: "Admin User",
      enabled_plugins: [],
      qaa_generator_token_set: false,
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

  it("loads the backend-held server settings and masks secret values", async () => {
    backendClientMock.getServerSettings.mockResolvedValue(serverSettingsResponse);

    renderWithProviders(<ServerSettingsPage />);

    expect(await screen.findByDisplayValue("http://qaa.example/api/v1")).toBeInTheDocument();
    expect(screen.getByDisplayValue("actor")).toBeInTheDocument();
    expect(screen.getByText("•••• set")).toBeInTheDocument();
    expect(screen.getByText("Not set")).toBeInTheDocument();
    expect(screen.getByLabelText("Service token")).toHaveAttribute("autocomplete", "new-password");
    expect(screen.getByLabelText("Service token")).toHaveAttribute("name", "qaa-generator-service-token");
    expect(screen.getByLabelText("Superuser token")).toHaveAttribute("autocomplete", "new-password");
    expect(screen.getByLabelText("Superuser token")).toHaveAttribute("name", "qaa-generator-superuser-token");
  });

  it("saves edited server settings through the admin endpoint", async () => {
    const user = userEvent.setup();
    backendClientMock.getServerSettings.mockResolvedValue(serverSettingsResponse);
    backendClientMock.updateServerSettings.mockResolvedValue({
      ...serverSettingsResponse,
      qaa_generator_actor: "updated-actor",
      qaa_generator_service_token_set: true,
    });

    renderWithProviders(<ServerSettingsPage />);

    await screen.findByDisplayValue("actor");

    await user.clear(screen.getByLabelText("Actor"));
    await user.type(screen.getByLabelText("Actor"), "updated-actor");
    await user.type(screen.getByLabelText("Service token"), "rotated-service-token");
    await user.click(screen.getByRole("button", { name: "Save server settings" }));

    await waitFor(() => {
      expect(backendClientMock.updateServerSettings).toHaveBeenCalledWith("token-123", {
        qaa_generator_actor: "updated-actor",
        qaa_generator_base_url: "http://qaa.example/api/v1",
        qaa_generator_port_forward_enabled: true,
        qaa_generator_port_forward_local_port: 18080,
        qaa_generator_port_forward_namespace: "qaa-prod",
        qaa_generator_port_forward_remote_port: 8080,
        qaa_generator_port_forward_resource: "svc/qaa-generator",
        qaa_generator_service_token: "rotated-service-token",
      });
    });
  });
});
