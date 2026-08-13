import { beforeEach, describe, expect, it } from "vitest";
import { AppShell, MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import { TabBar } from "@/app/layout/TabBar";
import { PluginId, TabId } from "@/constants";
import { resetAuthStoreState, useAuthStore } from "@/store/authStore";
import { resetUiStoreState, useUiStore } from "@/store/uiStore";

function renderTabBar() {
  return render(
    <MantineProvider forceColorScheme="dark">
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <AppShell header={{ height: 76 }}>
          <TabBar />
        </AppShell>
      </MemoryRouter>
    </MantineProvider>
  );
}

describe("TabBar", () => {
  beforeEach(() => {
    localStorage.clear();
    resetAuthStoreState();
    resetUiStoreState();
    useAuthStore.setState({
      currentUser: {
        auto_login: false,
        created_at: "2026-08-13T00:00:00Z",
        display_name: "Test User",
        enabled_plugins: [PluginId.STAGINGS, PluginId.ADMIN],
        id: 1,
        is_admin: true,
        updated_at: "2026-08-13T00:00:00Z",
        username: "test",
      },
      token: "token-123",
    });
  });

  it("shows a global collection of workspace tabs and has no open-tab button", async () => {
    const user = userEvent.setup();

    useUiStore.getState().openTab(PluginId.ADMIN, TabId.ADMIN_PLUGINS);
    useUiStore.getState().openTab(PluginId.STAGINGS, TabId.STAGINGS_HISTORY);

    renderTabBar();

    expect(screen.queryByRole("button", { name: /Open tab/i })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Plugins/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /History/i })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /Plugins/i }));
    expect(useUiStore.getState().activeWorkspaceTabId).toBe(TabId.ADMIN_PLUGINS);
  });
});
