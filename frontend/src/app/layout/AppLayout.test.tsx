import { beforeEach, describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { AppRoutes } from "@/app/routes";
import { resetAuthStoreState, useAuthStore } from "@/store/authStore";
import { resetUiStoreState } from "@/store/uiStore";
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
});
