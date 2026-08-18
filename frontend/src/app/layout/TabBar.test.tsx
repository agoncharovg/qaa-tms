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
        enabled_plugins: [PluginId.STAGINGS, PluginId.QAA_GENERATOR],
        qaa_generator_token_set: false,
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

    useUiStore.getState().openTab(PluginId.QAA_GENERATOR, TabId.QAA_GENERATE);
    useUiStore.getState().openTab(PluginId.STAGINGS, TabId.STAGINGS_HISTORY);

    renderTabBar();

    expect(screen.queryByRole("button", { name: /Open tab/i })).not.toBeInTheDocument();

    const generateTab = screen.getByRole("tab", { name: /Generate/i });
    const historyTab = screen.getByRole("tab", { name: /History/i });

    expect(generateTab).toBeInTheDocument();
    expect(historyTab).toBeInTheDocument();
    expect(generateTab.querySelector("svg")).not.toBeNull();
    expect(historyTab.querySelector("svg")).not.toBeNull();

    await user.click(generateTab);
    expect(useUiStore.getState().activeWorkspaceTabId).toBe(TabId.QAA_GENERATE);
  });
});
