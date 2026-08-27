import { MantineProvider, createTheme } from "@mantine/core";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";

import type { User } from "@/api/types";
import { AppLayout } from "@/app/layout/AppLayout";
import { PluginId, TabId } from "@/constants";
import { useAuthStore } from "@/store/authStore";
import { resetUiStoreState, useUiStore } from "@/store/uiStore";

vi.mock("@/app/layout/Sidebar", () => ({
  Sidebar: ({ activePluginId }: { activePluginId: string }) => (
    <div data-testid="sidebar">{activePluginId}</div>
  ),
}));

vi.mock("@/app/layout/Workspace", () => ({
  Workspace: () => <div data-testid="workspace">workspace</div>,
}));

const theme = createTheme({
  colors: {
    brand: [
      "#eff6ff",
      "#dbeafe",
      "#bfdbfe",
      "#93c5fd",
      "#60a5fa",
      "#3b82f6",
      "#2563eb",
      "#1d4ed8",
      "#1e40af",
      "#1e3a8a",
    ],
    dark: [
      "#C9C9C9",
      "#b8b8b8",
      "#828282",
      "#696969",
      "#424242",
      "#3b3b3b",
      "#2e2e2e",
      "#242424",
      "#1f1f1f",
      "#141414",
    ],
  },
  defaultRadius: "md",
  fontFamily: "Inter, sans-serif",
  primaryColor: "brand",
});

const TEST_USER = {
  auto_login: false,
  created_at: "2026-08-21T00:00:00.000Z",
  display_name: "Test User",
  enabled_plugins: [PluginId.STAGINGS, PluginId.KUBER, PluginId.QAA_GENERATOR, PluginId.JENKINS],
  effective_permissions: ["stagings.read", "kuber.read", "qaa.read", "jenkins.read"],
  id: 1,
  is_admin: false,
  updated_at: "2026-08-21T00:00:00.000Z",
  username: "test-user",
} satisfies User;

function LocationProbe() {
  const location = useLocation();

  return <div data-testid="location">{location.pathname}</div>;
}

function renderAppLayout(initialPath: string) {
  return render(
    <MantineProvider forceColorScheme="light" theme={theme}>
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }} initialEntries={[initialPath]}>
        <LocationProbe />
        <AppLayout />
      </MemoryRouter>
    </MantineProvider>
  );
}

describe("AppLayout tab closing", () => {
  beforeEach(() => {
    localStorage.clear();
    resetUiStoreState(TEST_USER);
    useAuthStore.setState({
      autoLogin: false,
      currentUser: TEST_USER,
      isBootstrapping: false,
      isHydrated: true,
      rememberCredentials: false,
      rememberedPassword: "",
      rememberedUsername: "",
      token: "token",
    });
  });

  it("does not resurrect a closed tab while the route still points at the closed plugin", async () => {
    useUiStore.getState().openTab(PluginId.STAGINGS, TabId.STAGINGS_HISTORY);
    useUiStore.getState().openTab(PluginId.QAA_GENERATOR, TabId.QAA_GENERATE);

    renderAppLayout("/qaa-generator");

    act(() => {
      useUiStore.getState().closeTab(PluginId.QAA_GENERATOR, TabId.QAA_GENERATE);
    });

    await waitFor(() => {
      expect(useUiStore.getState().workspaceTabIds).toEqual([TabId.STAGINGS_HISTORY]);
    });

    expect(useUiStore.getState().activeWorkspaceTabId).toBe(TabId.STAGINGS_HISTORY);
    expect(screen.queryByLabelText("Close Generate tab")).not.toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/qaa-generator");
  });

  it("closes the active right-most tab from the tab bar when the previous tab belongs to another plugin", async () => {
    useUiStore.getState().openTab(PluginId.STAGINGS, TabId.STAGINGS_HISTORY);
    useUiStore.getState().openTab(PluginId.QAA_GENERATOR, TabId.QAA_GENERATE);

    const user = userEvent.setup();

    renderAppLayout("/qaa-generator");

    await user.click(screen.getByLabelText("Close Generate tab"));

    await waitFor(() => {
      expect(useUiStore.getState().workspaceTabIds).toEqual([TabId.STAGINGS_HISTORY]);
    });

    expect(useUiStore.getState().activeWorkspaceTabId).toBe(TabId.STAGINGS_HISTORY);
    expect(screen.queryByLabelText("Close Generate tab")).not.toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/stagings");
  });

  it("keeps the workspace empty after closing the only remaining tab", async () => {
    useUiStore.getState().openTab(PluginId.QAA_GENERATOR, TabId.QAA_GENERATE);

    const user = userEvent.setup();

    renderAppLayout("/qaa-generator");

    await user.click(screen.getByLabelText("Close Generate tab"));

    await waitFor(() => {
      expect(useUiStore.getState().workspaceTabIds).toEqual([]);
    });

    expect(useUiStore.getState().activeWorkspaceTabId).toBeNull();
    expect(
      screen.getByText("No workspace tabs are open. Select a menu item from the sidebar.")
    ).toBeInTheDocument();
  });
});
