import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell, MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

const navigateMock = vi.hoisted(() => vi.fn());
const formatReminderMock = vi.hoisted(() => vi.fn((value: string) => value));
const useNotebookRemindersMock = vi.hoisted(() => vi.fn());

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock("@/plugins/notebook/reminders", () => ({
  formatReminder: formatReminderMock,
  useNotebookReminders: useNotebookRemindersMock,
}));

import { Sidebar } from "@/app/layout/Sidebar";
import type { NotebookReminder } from "@/api/types";
import { PluginId, TabId } from "@/constants";
import { useNotebookNavStore } from "@/plugins/notebook/notebookNavStore";
import { resetAuthStoreState, useAuthStore } from "@/store/authStore";
import { resetUiStoreState, useUiStore } from "@/store/uiStore";

function renderSidebar(activePluginId: PluginId = PluginId.STAGINGS) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { refetchOnWindowFocus: false, retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MantineProvider forceColorScheme="dark">
        <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
          <Notifications />
          <AppShell navbar={{ breakpoint: "sm", width: 280 }}>
            <Sidebar activePluginId={activePluginId} />
          </AppShell>
        </MemoryRouter>
      </MantineProvider>
    </QueryClientProvider>
  );
}

describe("Sidebar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    resetAuthStoreState();
    resetUiStoreState();
    useNotebookNavStore.getState().clearPendingSelection();
    formatReminderMock.mockImplementation((value: string) => value);
    useNotebookRemindersMock.mockReturnValue({ dueReminders: [], reminders: [] });
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
        effective_permissions: ["stagings.read"],
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
        effective_permissions: ["stagings.read"],
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

  it("sorts the main menu plugins alphabetically by label", () => {
    useAuthStore.setState({
      currentUser: {
        auto_login: false,
        created_at: "2026-08-09T00:00:00Z",
        display_name: "Admin User",
        enabled_plugins: [PluginId.STAGINGS, PluginId.QAA_GENERATOR, PluginId.KUBER, PluginId.JENKINS],
        qaa_generator_token_set: false,
        id: 1,
        is_admin: true,
        updated_at: "2026-08-09T00:00:00Z",
        username: "admin",
      },
      token: "token-123",
    });

    renderSidebar(PluginId.STAGINGS);

    const menuLabels = new Set(["Administration", "Jenkins", "Kuber", "QAA generator", "Stagings"]);
    const mainMenuButtons = [
      ...new Set(
        screen
          .getAllByRole("button")
          .map((button) => button.getAttribute("aria-label") ?? button.textContent ?? "")
          .filter((label) => menuLabels.has(label))
      ),
    ];

    expect(mainMenuButtons).toEqual(["Administration", "Jenkins", "Kuber", "QAA generator", "Stagings"]);
  });

  it("sorts the Stagings submenu alphabetically by title", () => {
    useAuthStore.setState({
      currentUser: {
        auto_login: false,
        created_at: "2026-08-09T00:00:00Z",
        display_name: "Test User",
        enabled_plugins: [PluginId.STAGINGS],
        effective_permissions: ["stagings.read"],
        qaa_generator_token_set: false,
        id: 2,
        is_admin: false,
        updated_at: "2026-08-09T00:00:00Z",
        username: "test",
      },
      token: "token-456",
    });

    renderSidebar(PluginId.STAGINGS);

    const submenuLabels = ["Deploy", "E2E", "History", "Namespaces", "Preflight", "Sync"];
    const stagingSubmenuButtons = screen
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label") ?? "")
      .filter((label) => submenuLabels.includes(label));

    expect(stagingSubmenuButtons).toEqual(submenuLabels);
  });

  it("opens the admin security tab directly from the sidebar tree", async () => {
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

    await user.click(screen.getByRole("button", { name: "Security" }));

    expect(useUiStore.getState().tabsByPlugin[PluginId.ADMIN].activeTabId).toBe(TabId.ADMIN_SECURITY);
    expect(useUiStore.getState().tabsByPlugin[PluginId.ADMIN].tabIds).toContain(TabId.ADMIN_SECURITY);
    expect(useUiStore.getState().activeWorkspaceTabId).toBe(TabId.ADMIN_SECURITY);
    expect(useUiStore.getState().workspaceTabIds).toContain(TabId.ADMIN_SECURITY);
  });

  it('requests the reminder note and navigates when the toast "Откройте" link is clicked', async () => {
    const user = userEvent.setup();
    const reminder: NotebookReminder = {
      bookmark: "Research",
      name: "2026-08-25-14-30-05",
      previewLines: ["Remember the release"],
      remindAt: "2026-09-01T18:00",
    };

    useAuthStore.setState({
      currentUser: {
        auto_login: false,
        created_at: "2026-08-09T00:00:00Z",
        display_name: "Test User",
        enabled_plugins: [PluginId.NOTEBOOK],
        effective_permissions: ["notebook.read"],
        qaa_generator_token_set: false,
        id: 2,
        is_admin: false,
        updated_at: "2026-08-09T00:00:00Z",
        username: "test",
      },
      token: "token-456",
    });
    useNotebookRemindersMock.mockReturnValue({
      dueReminders: [reminder],
      reminders: [reminder],
    });

    renderSidebar();

    await user.click(await screen.findByRole("button", { name: "Откройте" }));

    expect(useNotebookNavStore.getState().pendingSelection).toEqual({
      bookmark: reminder.bookmark,
      name: reminder.name,
    });
    expect(navigateMock).toHaveBeenCalledWith("/notebook");
  });
});
