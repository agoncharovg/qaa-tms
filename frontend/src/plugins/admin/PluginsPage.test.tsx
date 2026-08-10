import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell, MantineProvider } from "@mantine/core";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

const backendClientMock = vi.hoisted(() => ({
  updateMyPlugins: vi.fn(),
}));

vi.mock("@/api/backendClient", () => ({
  backendClient: backendClientMock,
}));

import { Sidebar } from "@/app/layout/Sidebar";
import { TabBar } from "@/app/layout/TabBar";
import { PluginId } from "@/constants";
import { PluginsPage } from "@/plugins/admin/PluginsPage";
import { renderWithProviders } from "@/test/render";
import { resetAuthStoreState, useAuthStore } from "@/store/authStore";
import { resetUiStoreState, syncTabsForUser } from "@/store/uiStore";

function renderAdminSurface() {
  return renderWithProviders(
    <MantineProvider forceColorScheme="dark">
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <AppShell header={{ height: 76 }} navbar={{ breakpoint: "sm", width: 280 }}>
          <Sidebar activePluginId={PluginId.ADMIN} />
          <PluginsPage />
        </AppShell>
      </MemoryRouter>
    </MantineProvider>
  );
}

function renderAdminTabBar() {
  return renderWithProviders(
    <MantineProvider forceColorScheme="dark">
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <AppShell header={{ height: 76 }} navbar={{ breakpoint: "sm", width: 280 }}>
          <TabBar activePluginId={PluginId.ADMIN} />
        </AppShell>
      </MemoryRouter>
    </MantineProvider>
  );
}

describe("PluginsPage", () => {
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

    renderAdminSurface();

    expect(screen.getByRole("button", { name: "Stagings" })).toBeInTheDocument();
    expect(screen.getByLabelText("Administration is enabled")).toBeDisabled();
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

  it("shows only the Plugins tab to non-admins and exposes Users to admins", async () => {
    const user = userEvent.setup();

    renderAdminTabBar();
    expect(screen.getByText("Plugins")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open tab" }));
    expect(screen.queryByText("Users")).not.toBeInTheDocument();

    useAuthStore.setState({
      currentUser: {
        ...useAuthStore.getState().currentUser!,
        is_admin: true,
      },
    });
    syncTabsForUser(useAuthStore.getState().currentUser);

    renderAdminTabBar();
    await user.click(screen.getAllByRole("button", { name: "Open tab" })[1]);
    expect(await screen.findByText("Users")).toBeInTheDocument();
  });
});
