import { beforeEach, describe, expect, it } from "vitest";
import { AppShell, MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { Sidebar } from "@/app/layout/Sidebar";
import { SectionKey } from "@/constants";
import { resetAuthStoreState, useAuthStore } from "@/store/authStore";
import { resetUiStoreState } from "@/store/uiStore";

function renderSidebar() {
  return render(
    <MantineProvider forceColorScheme="dark">
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <AppShell navbar={{ breakpoint: "sm", width: 280 }}>
          <Sidebar activeSection={SectionKey.STAGINGS} />
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

  it("shows the Administration item only for admin users", () => {
    useAuthStore.setState({
      currentUser: {
        auto_login: false,
        created_at: "2026-08-09T00:00:00Z",
        display_name: "Administrator",
        id: 1,
        is_admin: true,
        updated_at: "2026-08-09T00:00:00Z",
        username: "admin",
      },
      token: "token-123",
    });

    const { unmount } = renderSidebar();
    expect(screen.getByText("Administration")).toBeInTheDocument();

    unmount();
    resetAuthStoreState();
    resetUiStoreState();
    useAuthStore.setState({
      currentUser: {
        auto_login: false,
        created_at: "2026-08-09T00:00:00Z",
        display_name: "Test User",
        id: 2,
        is_admin: false,
        updated_at: "2026-08-09T00:00:00Z",
        username: "test",
      },
      token: "token-456",
    });

    renderSidebar();
    expect(screen.queryByText("Administration")).not.toBeInTheDocument();
  });
});
