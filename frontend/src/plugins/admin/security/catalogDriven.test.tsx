import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const backendClientMock = vi.hoisted(() => ({
  getUserPermissions: vi.fn(),
  listSecurityGroups: vi.fn(),
  listSecurityPermissions: vi.fn(),
  listSecurityRoles: vi.fn(),
  listUsers: vi.fn(),
}));

vi.mock("@/api/backendClient", () => ({ backendClient: backendClientMock }));

import { RolesPanel } from "@/plugins/admin/security/RolesPanel";
import { UsersMatrix } from "@/plugins/admin/security/UsersMatrix";
import { resetAuthStoreState, useAuthStore } from "@/store/authStore";
import { renderWithProviders } from "@/test/render";

const TOKEN = "test-token";
const PERMISSIONS_RESPONSE = {
  items: [
    {
      id: 1,
      key: "security.read",
      display_name: "Security read",
      description: null,
      system: true,
    },
    {
      id: 2,
      key: "notificator.read",
      display_name: "Notificator read",
      description: null,
      system: true,
    },
    {
      id: 3,
      key: "notificator.write",
      display_name: "Notificator write",
      description: null,
      system: true,
    },
    {
      id: 4,
      key: "leonid.read",
      display_name: "Leonid read",
      description: null,
      system: true,
    },
    {
      id: 5,
      key: "leonid.write",
      display_name: "Leonid write",
      description: null,
      system: true,
    },
  ],
  total: 5,
};

describe("security catalog-driven permissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAuthStoreState();
    useAuthStore.setState({
      token: TOKEN,
      currentUser: {
        id: 1,
        username: "admin",
        display_name: "Admin",
        is_admin: true,
        auto_login: false,
        role_id: null,
        group_id: null,
        role: null,
        group: null,
        enabled_plugins: [],
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    });
    backendClientMock.listSecurityPermissions.mockResolvedValue(PERMISSIONS_RESPONSE);
    backendClientMock.listSecurityRoles.mockResolvedValue({
      items: [
        {
          id: 1,
          key: "admin",
          display_name: "Administrator",
          description: null,
          system: true,
          mutable: false,
          permissions: ["security.read"],
        },
      ],
      total: 1,
    });
    backendClientMock.listSecurityGroups.mockResolvedValue({ items: [], total: 0 });
    backendClientMock.listUsers.mockResolvedValue({
      items: [
        {
          id: 2,
          username: "alice",
          display_name: "Alice",
          is_admin: false,
          auto_login: false,
          role_id: null,
          group_id: null,
          role: null,
          group: null,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ],
      total: 1,
    });
    backendClientMock.getUserPermissions.mockResolvedValue({
      inherited: ["notificator.read"],
      extra: ["leonid.write"],
    });
  });

  it("renders role permissions from the backend catalog", async () => {
    const user = userEvent.setup();
    renderWithProviders(<RolesPanel />);

    await user.click(await screen.findByRole("button", { name: "Create role" }));

    expect(await screen.findByText("Notificator")).toBeInTheDocument();
    expect(screen.getByLabelText("notificator.read")).toBeInTheDocument();
    expect(screen.getByLabelText("notificator.write")).toBeInTheDocument();
    expect(screen.getByLabelText("leonid.write")).toBeInTheDocument();
  });

  it("renders user matrix columns from the backend catalog", async () => {
    renderWithProviders(<UsersMatrix />);

    expect(await screen.findByText("Notificator")).toBeInTheDocument();
    expect(screen.getByText("Leonid")).toBeInTheDocument();
    expect(await screen.findByTitle("notificator.read")).toBeInTheDocument();
    expect(screen.getByTitle("leonid.write")).toBeInTheDocument();
  });
});
