import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell, MantineProvider } from "@mantine/core";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

const backendClientMock = vi.hoisted(() => ({
  updateMyPlugins: vi.fn(),
}));

vi.mock("@/api/backendClient", () => ({
  backendClient: backendClientMock,
}));

import { Sidebar } from "@/app/layout/Sidebar";
import { PluginId } from "@/constants";
import { PluginsPanel } from "@/plugins/profile/PluginsPanel";
import { renderWithProviders } from "@/test/render";
import { resetAuthStoreState, useAuthStore } from "@/store/authStore";
import { resetUiStoreState, syncTabsForUser } from "@/store/uiStore";

function renderProfileSurface() {
  return renderWithProviders(
    <MantineProvider forceColorScheme="dark">
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <AppShell header={{ height: 76 }} navbar={{ breakpoint: "sm", width: 280 }}>
          <Sidebar activePluginId={PluginId.PROFILE} />
          <PluginsPanel />
        </AppShell>
      </MemoryRouter>
    </MantineProvider>
  );
}

describe("PluginsPanel", () => {
  beforeEach(() => {
    backendClientMock.updateMyPlugins.mockReset();
    localStorage.clear();
    resetAuthStoreState();
    resetUiStoreState();

    useAuthStore.setState({
      currentUser: {
        auto_login: false,
        created_at: "2026-08-09T00:00:00Z",
        display_name: "Test User",
        enabled_plugins: ["stagings"],
        effective_permissions: ["stagings.read"],
        qaa_generator_token_set: false,
        id: 2,
        is_admin: false,
        updated_at: "2026-08-09T00:00:00Z",
        username: "test",
      },
      token: "token-123",
    });
    syncTabsForUser(useAuthStore.getState().currentUser);
  });

  it("renders optional and system plugins and updates the sidebar live on toggle", async () => {
    const user = userEvent.setup();
    backendClientMock.updateMyPlugins
      .mockResolvedValueOnce({ enabled_plugins: [] })
      .mockResolvedValueOnce({ enabled_plugins: ["stagings"] });

    renderProfileSurface();

    expect(screen.getByRole("button", { name: "Stagings" })).toBeInTheDocument();
    expect(screen.getByLabelText("Profile is enabled")).toBeDisabled();
    expect(screen.getByLabelText("Toggle Stagings")).toBeChecked();

    await user.click(screen.getByLabelText("Toggle Stagings"));

    await waitFor(() => {
      expect(backendClientMock.updateMyPlugins).toHaveBeenCalledWith("token-123", []);
    });
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Stagings" })).not.toBeInTheDocument();
    });

    await user.click(screen.getByLabelText("Toggle Stagings"));

    await waitFor(() => {
      expect(backendClientMock.updateMyPlugins).toHaveBeenLastCalledWith("token-123", ["stagings"]);
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Stagings" })).toBeInTheDocument();
    });
  });

  it("hides optional plugins when the user has no plugin read permissions", () => {
    act(() => {
      useAuthStore.setState({
        currentUser: {
          ...useAuthStore.getState().currentUser!,
          effective_permissions: [],
        },
      });
      syncTabsForUser(useAuthStore.getState().currentUser);
    });

    renderProfileSurface();

    expect(screen.getByText("No optional plugins")).toBeInTheDocument();
    expect(screen.queryByLabelText("Toggle Stagings")).not.toBeInTheDocument();
  });

  it("shows the moved profile plugins page and exposes Administration only for admins", async () => {
    renderProfileSurface();
    expect(screen.getByRole("heading", { name: "Plugins" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Administration" })).not.toBeInTheDocument();

    act(() => {
      useAuthStore.setState({
        currentUser: {
          ...useAuthStore.getState().currentUser!,
          is_admin: true,
        },
      });
      syncTabsForUser(useAuthStore.getState().currentUser);
    });

    expect(await screen.findByRole("button", { name: "Administration" })).toBeInTheDocument();
  });
});
