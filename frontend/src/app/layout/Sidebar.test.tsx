import { beforeEach, describe, expect, it } from "vitest";
import { AppShell, MantineProvider } from "@mantine/core";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import { Sidebar } from "@/app/layout/Sidebar";
import { PluginId, TabId } from "@/constants";
import { resetAuthStoreState, useAuthStore } from "@/store/authStore";
import { resetUiStoreState, useUiStore } from "@/store/uiStore";

function renderSidebar(activePluginId: PluginId = PluginId.STAGINGS) {
  return render(
    <MantineProvider forceColorScheme="dark">
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <AppShell navbar={{ breakpoint: "sm", width: 280 }}>
          <Sidebar activePluginId={activePluginId} />
        </AppShell>
      </MemoryRouter>
    </MantineProvider>
  );
}

describe("Sidebar", () => {
  beforeEach(() => {
    localStorage.clear();
    resetAuthStoreState();
    resetUiStoreState();
  });

  it("shows the account menu items and hides Administration for non-admin users", async () => {
    const user = userEvent.setup();

    useAuthStore.setState({
      currentUser: {
        auto_login: false,
        created_at: "2026-08-09T00:00:00Z",
        display_name: "Test User",
        enabled_plugins: [],
        qaa_generator_token_set: false,
        id: 2,
        is_admin: false,
        updated_at: "2026-08-09T00:00:00Z",
        username: "test",
      },
      token: "token-456",
    });

    renderSidebar();

    expect(screen.queryByRole("button", { name: "Administration" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Account menu" }));

    expect(screen.getByRole("button", { name: "Profile" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log out" })).toBeInTheDocument();
  });

  it("shows the collapsed account popover menu", async () => {
    const user = userEvent.setup();

    useAuthStore.setState({
      currentUser: {
        auto_login: false,
        created_at: "2026-08-09T00:00:00Z",
        display_name: "Test User",
        enabled_plugins: [PluginId.STAGINGS],
        qaa_generator_token_set: false,
        id: 2,
        is_admin: false,
        updated_at: "2026-08-09T00:00:00Z",
        username: "test",
      },
      token: "token-456",
    });
    useUiStore.setState({ sidebarCollapsed: true });

    renderSidebar();

    await user.click(screen.getByRole("button", { name: "Account menu" }));

    expect(await screen.findByRole("menuitem", { name: "Profile" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Log out" })).toBeInTheDocument();
  });

  it("opens a logout confirmation modal before clearing auth state", async () => {
    const user = userEvent.setup();

    useAuthStore.setState({
      currentUser: {
        auto_login: false,
        created_at: "2026-08-09T00:00:00Z",
        display_name: "Test User",
        enabled_plugins: [PluginId.STAGINGS],
        qaa_generator_token_set: false,
        id: 2,
        is_admin: false,
        updated_at: "2026-08-09T00:00:00Z",
        username: "test",
      },
      token: "token-456",
    });

    renderSidebar();

    await user.click(screen.getByRole("button", { name: "Account menu" }));
    await user.click(screen.getByRole("button", { name: "Log out" }));

    const dialog = await screen.findByRole("dialog", { name: "Log out" });

    await user.click(within(dialog).getByRole("button", { name: "Log out" }));

    await waitFor(() => {
      expect(useAuthStore.getState().currentUser).toBeNull();
      expect(useAuthStore.getState().token).toBeNull();
    });
  });

  it("opens a nested admin tab directly from the sidebar tree", async () => {
    const user = userEvent.setup();

    useAuthStore.setState({
      currentUser: {
        auto_login: false,
        created_at: "2026-08-09T00:00:00Z",
        display_name: "Admin User",
        enabled_plugins: [PluginId.STAGINGS, PluginId.QAA_GENERATOR],
        qaa_generator_token_set: false,
        id: 1,
        is_admin: true,
        updated_at: "2026-08-09T00:00:00Z",
        username: "admin",
      },
      token: "token-123",
    });
    resetUiStoreState({
      enabled_plugins: [PluginId.STAGINGS, PluginId.QAA_GENERATOR],
      is_admin: true,
    });

    renderSidebar(PluginId.ADMIN);

    await user.click(screen.getByRole("button", { name: "Users" }));

    expect(useUiStore.getState().tabsByPlugin[PluginId.ADMIN].activeTabId).toBe(TabId.ADMIN_USERS);
    expect(useUiStore.getState().tabsByPlugin[PluginId.ADMIN].tabIds).toContain(TabId.ADMIN_USERS);
    expect(useUiStore.getState().activeWorkspaceTabId).toBe(TabId.ADMIN_USERS);
    expect(useUiStore.getState().workspaceTabIds).toContain(TabId.ADMIN_USERS);
  });
});
