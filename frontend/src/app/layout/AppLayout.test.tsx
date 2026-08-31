import { beforeEach, describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { PluginId, TabId } from "@/constants";
import { AppRoutes } from "@/app/routes";
import { resetAuthStoreState, useAuthStore } from "@/store/authStore";
import { resetUiStoreState, useUiStore } from "@/store/uiStore";
import { renderWithProviders } from "@/test/render";

function renderApp(initialEntry: string) {
  return renderWithProviders(
    <MemoryRouter
      future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
      initialEntries={[initialEntry]}
    >
      <AppRoutes />
    </MemoryRouter>
  );
}

describe("AppLayout", () => {
  beforeEach(() => {
    localStorage.clear();
    resetAuthStoreState();
    resetUiStoreState();
  });

  it("redirects authenticated users away from hidden plugin routes into Profile", async () => {
    useAuthStore.setState({
      currentUser: {
        auto_login: false,
        created_at: "2026-08-13T00:00:00Z",
        display_name: "Test User",
        enabled_plugins: [],
        qaa_generator_token_set: false,
        id: 2,
        is_admin: false,
        updated_at: "2026-08-13T00:00:00Z",
        username: "test",
      },
      isBootstrapping: false,
      isHydrated: true,
      token: "token-123",
    });
    resetUiStoreState({
      enabled_plugins: [],
      is_admin: false,
    });

    renderApp("/stagings");

    expect(await screen.findByRole("heading", { name: "Account" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Account menu" })).toBeInTheDocument();
  });

  it("honors the URL plugin over a persisted workspace tab from another plugin", async () => {
    const adminUser = {
      auto_login: false,
      created_at: "2026-08-13T00:00:00Z",
      display_name: "Admin User",
      enabled_plugins: [PluginId.QAA_GENERATOR],
      qaa_generator_token_set: false,
      id: 3,
      is_admin: true,
      updated_at: "2026-08-13T00:00:00Z",
      username: "admin",
    };
    useAuthStore.setState({
      currentUser: adminUser,
      isBootstrapping: false,
      isHydrated: true,
      token: "token-123",
    });
    resetUiStoreState({
      enabled_plugins: [PluginId.QAA_GENERATOR],
      is_admin: true,
    });
    // Simulate a previous session whose last-active workspace tab belonged to a
    // different plugin than the one we deep-link into below.
    useUiStore.getState().openTab(PluginId.QAA_GENERATOR, TabId.QAA_GENERATE);
    expect(useUiStore.getState().activeWorkspaceTabId).toBe(TabId.QAA_GENERATE);

    renderApp("/profile");

    // The URL points at Profile, so the workspace must show Profile — not the
    // Generate tab restored from the persisted workspace state.
    expect(await screen.findByRole("heading", { name: "Account" })).toBeInTheDocument();
    expect(screen.queryByText("Generate tests")).not.toBeInTheDocument();
  });
});
