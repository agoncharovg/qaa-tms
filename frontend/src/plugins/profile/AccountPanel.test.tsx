import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const backendClientMock = vi.hoisted(() => ({
  updateMe: vi.fn(),
}));

vi.mock("@/api/backendClient", () => ({
  backendClient: backendClientMock,
}));

import { AccountPanel } from "@/plugins/profile/AccountPanel";
import { renderWithProviders } from "@/test/render";
import { resetAuthStoreState, useAuthStore } from "@/store/authStore";

describe("AccountPanel", () => {
  beforeEach(() => {
    backendClientMock.updateMe.mockReset();
    localStorage.clear();
    resetAuthStoreState();
    useAuthStore.setState({
      currentUser: {
        auto_login: false,
        created_at: "2026-08-13T00:00:00Z",
        display_name: "Test User",
        enabled_plugins: ["stagings"],
        qaa_generator_token_set: false,
        id: 2,
        is_admin: false,
        updated_at: "2026-08-13T00:00:00Z",
        username: "test",
      },
      token: "token-123",
    });
  });

  it("submits only changed fields and updates the auth store", async () => {
    const user = userEvent.setup();
    backendClientMock.updateMe.mockResolvedValue({
      ...useAuthStore.getState().currentUser,
      auto_login: true,
      display_name: "Updated User",
    });

    renderWithProviders(<AccountPanel />);

    await user.clear(screen.getByLabelText("Display name"));
    await user.type(screen.getByLabelText("Display name"), "Updated User");
    await user.type(screen.getByLabelText("New password"), "rotated");
    await user.type(screen.getByLabelText("Confirm password"), "rotated");
    await user.click(screen.getByLabelText("Auto-login"));
    await user.click(screen.getByRole("button", { name: "Save account changes" }));

    await waitFor(() => {
      expect(backendClientMock.updateMe).toHaveBeenCalledWith("token-123", {
        auto_login: true,
        display_name: "Updated User",
        password: "rotated",
      });
    });
    expect(useAuthStore.getState().currentUser?.display_name).toBe("Updated User");
    expect(useAuthStore.getState().currentUser?.auto_login).toBe(true);
  });
});
