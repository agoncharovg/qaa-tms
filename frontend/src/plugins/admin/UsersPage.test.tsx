import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const backendClientMock = vi.hoisted(() => ({
  createUser: vi.fn(),
  deleteUser: vi.fn(),
  listUsers: vi.fn(),
  updateUser: vi.fn(),
}));

vi.mock("@/api/backendClient", () => ({
  backendClient: backendClientMock,
}));

import { UsersPage } from "@/plugins/admin/UsersPage";
import { renderWithProviders } from "@/test/render";
import { resetAuthStoreState, useAuthStore } from "@/store/authStore";
import type { User, UserListResponse } from "@/api/types";

const adminUser: User = {
  auto_login: false,
  created_at: "2026-08-09T00:00:00Z",
  display_name: "Administrator",
  enabled_plugins: ["stagings"],
  qaa_generator_token_set: false,
  id: 1,
  is_admin: true,
  updated_at: "2026-08-09T00:00:00Z",
  username: "admin",
};

const secondUser: User = {
  auto_login: true,
  created_at: "2026-08-09T01:00:00Z",
  display_name: "Jane Viewer",
  enabled_plugins: ["stagings"],
  qaa_generator_token_set: false,
  id: 2,
  is_admin: false,
  updated_at: "2026-08-09T01:00:00Z",
  username: "jane",
};

const userListResponse: UserListResponse = {
  items: [adminUser, secondUser],
  total: 2,
};

describe("UsersPage", () => {
  beforeEach(() => {
    backendClientMock.createUser.mockReset();
    backendClientMock.deleteUser.mockReset();
    backendClientMock.listUsers.mockReset();
    backendClientMock.updateUser.mockReset();
    resetAuthStoreState();
    localStorage.clear();

    useAuthStore.setState({
      currentUser: adminUser,
      token: "token-123",
    });

    backendClientMock.listUsers.mockResolvedValue(userListResponse);
  });

  it("renders rows from the backend list", async () => {
    renderWithProviders(<UsersPage />);

    expect(await screen.findByText("admin")).toBeInTheDocument();
    expect(screen.getByText("jane")).toBeInTheDocument();
    expect(backendClientMock.listUsers).toHaveBeenCalledWith("token-123", expect.any(AbortSignal));
  });

  it("creates a user and invalidates the list", async () => {
    const user = userEvent.setup();
    backendClientMock.createUser.mockResolvedValue({
      auto_login: true,
      created_at: "2026-08-09T02:00:00Z",
      display_name: "Eve Adams",
      enabled_plugins: ["stagings"],
      qaa_generator_token_set: false,
      id: 3,
      is_admin: true,
      updated_at: "2026-08-09T02:00:00Z",
      username: "eve",
    });

    renderWithProviders(<UsersPage />);
    await screen.findByText("admin");

    await user.click(screen.getByRole("button", { name: "Create user" }));
    await screen.findByLabelText("Username");
    await user.type(screen.getByLabelText("Username"), "eve");
    await user.type(screen.getByLabelText("Display name"), "Eve Adams");
    await user.type(screen.getByLabelText("Password"), "eve-secret");
    await user.click(screen.getByLabelText("Admin access"));
    await user.click(screen.getByLabelText("Auto-login"));
    await user.click(screen.getByRole("button", { name: "Submit create user" }));

    await waitFor(() => {
      expect(backendClientMock.createUser).toHaveBeenCalledWith(
        "token-123",
        {
          auto_login: true,
          display_name: "Eve Adams",
          is_admin: true,
          password: "eve-secret",
          username: "eve",
        }
      );
    });
    await waitFor(() => {
      expect(backendClientMock.listUsers).toHaveBeenCalledTimes(2);
    });
  });

  it("edits a user with the exact update payload and keeps currentUser coherent on self-edit", async () => {
    const user = userEvent.setup();
    backendClientMock.updateUser.mockResolvedValue({
      ...adminUser,
      auto_login: true,
      display_name: "Admin Renamed",
      updated_at: "2026-08-10T00:00:00Z",
    });

    renderWithProviders(<UsersPage />);
    await screen.findByText("admin");

    await user.click(screen.getByRole("button", { name: "Edit admin" }));
    const displayNameInput = await screen.findByLabelText("Display name");
    await user.clear(displayNameInput);
    await user.type(displayNameInput, "Admin Renamed");
    await user.click(screen.getByLabelText("Auto-login"));
    await user.click(screen.getByLabelText("Reset password"));
    await user.type(screen.getByLabelText("New password"), "rotated");
    expect(screen.getByLabelText("Admin access")).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(backendClientMock.updateUser).toHaveBeenCalledWith(
        "token-123",
        1,
        {
          auto_login: true,
          display_name: "Admin Renamed",
          is_admin: true,
          password: "rotated",
        }
      );
    });
    await waitFor(() => {
      expect(useAuthStore.getState().currentUser?.display_name).toBe("Admin Renamed");
    });
  });

  it("waits for explicit delete confirmation and surfaces backend 409 errors", async () => {
    const user = userEvent.setup();
    backendClientMock.deleteUser.mockRejectedValue(
      new Error("This user has recorded operations; audit history must be preserved.")
    );

    renderWithProviders(<UsersPage />);
    await screen.findByText("jane");

    await user.click(screen.getByRole("button", { name: "Delete jane" }));
    const confirmButton = await screen.findByRole("button", { name: "Delete user" });
    expect(confirmButton).toBeDisabled();
    expect(backendClientMock.deleteUser).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Confirmation"), "jane");
    expect(confirmButton).toBeEnabled();
    await user.click(confirmButton);

    await waitFor(() => {
      expect(backendClientMock.deleteUser).toHaveBeenCalledWith("token-123", 2);
    });
    expect(
      await screen.findByText("This user has recorded operations; audit history must be preserved.")
    ).toBeInTheDocument();
  });

  it("guards self-delete controls", async () => {
    const user = userEvent.setup();

    renderWithProviders(<UsersPage />);
    await screen.findByText("admin");

    expect(screen.getByRole("button", { name: "Delete admin" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Edit admin" }));
    expect(await screen.findByLabelText("Admin access")).toBeDisabled();
  });
});
