import { beforeEach, describe, expect, it } from "vitest";
import { AppShell, MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import { Sidebar } from "@/app/layout/Sidebar";
import { PluginId, TabId } from "@/constants";
import { resetAuthStoreState, useAuthStore } from "@/store/authStore";
import { resetUiStoreState, useUiStore } from "@/store/uiStore";

function renderSidebar(activePluginId = PluginId.ADMIN) {
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

  it("shows Administration for every authenticated user, hides disabled plugins, and expands visible tabs", () => {
    useAuthStore.setState({
      currentUser: {
        auto_login: false,
        created_at: "2026-08-09T00:00:00Z",
        display_name: "Test User",
        enabled_plugins: [],
        id: 2,
        is_admin: false,
        updated_at: "2026-08-09T00:00:00Z",
        username: "test",
      },
      token: "token-456",
    });

    renderSidebar();

    expect(screen.getByText("Administration")).toBeInTheDocument();
    expect(screen.getByText("Plugins")).toBeInTheDocument();
    expect(screen.queryByText("Users")).not.toBeInTheDocument();
    expect(screen.queryByText("Stagings")).not.toBeInTheDocument();
  });

  it("opens a nested tab directly from the sidebar tree", async () => {
    const user = userEvent.setup();

    useAuthStore.setState({
      currentUser: {
        auto_login: false,
        created_at: "2026-08-09T00:00:00Z",
        display_name: "Admin User",
        enabled_plugins: [PluginId.STAGINGS, PluginId.QAA_GENERATOR],
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

    renderSidebar();

    await user.click(screen.getByRole("button", { name: "Users" }));

    expect(useUiStore.getState().tabsByPlugin[PluginId.ADMIN].activeTabId).toBe(TabId.ADMIN_USERS);
    expect(useUiStore.getState().tabsByPlugin[PluginId.ADMIN].tabIds).toContain(TabId.ADMIN_USERS);
  });
});
