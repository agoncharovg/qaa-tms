import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const backendClientMock = vi.hoisted(() => ({
  createSecurityGroup: vi.fn(),
  createSecurityRole: vi.fn(),
  getUserPermissions: vi.fn(),
  listSecurityGroups: vi.fn(),
  listSecurityPermissions: vi.fn(),
  listSecurityRoles: vi.fn(),
  listUsers: vi.fn(),
  updateGroupMembers: vi.fn(),
  updateGroupPermissions: vi.fn(),
  updateGroupRoles: vi.fn(),
}));

vi.mock("@/api/backendClient", () => ({ backendClient: backendClientMock }));

import { RolesPanel } from "@/plugins/admin/security/RolesPanel";
import { UsersMatrix } from "@/plugins/admin/security/UsersMatrix";
import { resetAuthStoreState, useAuthStore } from "@/store/authStore";
import { renderWithProviders } from "@/test/render";

const TOKEN = "test-token";
const INITIAL_ROLES_RESPONSE = {
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
};
const INITIAL_GROUPS_RESPONSE = { items: [], total: 0 };
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
    backendClientMock.listSecurityRoles.mockResolvedValue(INITIAL_ROLES_RESPONSE);
    backendClientMock.listSecurityGroups.mockResolvedValue(INITIAL_GROUPS_RESPONSE);
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
    backendClientMock.createSecurityRole.mockResolvedValue({
      id: 42,
      key: null,
      display_name: "QA Lead",
      description: null,
      system: false,
      mutable: true,
      permissions: [],
    });
    backendClientMock.createSecurityGroup.mockResolvedValue({
      id: 84,
      key: null,
      display_name: "QA Guild",
      description: null,
      system: false,
      members: [],
      member_count: 0,
      permissions: [],
      role_ids: [],
    });
    backendClientMock.updateGroupPermissions.mockResolvedValue(undefined);
    backendClientMock.updateGroupMembers.mockResolvedValue(undefined);
    backendClientMock.updateGroupRoles.mockResolvedValue(undefined);
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

  it("creates a role inline from the create-user flow", async () => {
    const user = userEvent.setup();
    backendClientMock.listSecurityRoles
      .mockResolvedValueOnce(INITIAL_ROLES_RESPONSE)
      .mockResolvedValue({
        items: [
          ...INITIAL_ROLES_RESPONSE.items,
          {
            id: 42,
            key: null,
            display_name: "QA Lead",
            description: null,
            system: false,
            mutable: true,
            permissions: [],
          },
        ],
        total: 2,
      });

    renderWithProviders(<UsersMatrix />);

    await user.click(await screen.findByRole("button", { name: "Create user" }));
    expect(await screen.findByLabelText("Username")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /\+ new role/i }));

    const createRoleDialog = await screen.findByRole("dialog", { name: "Create role" });
    await user.type(within(createRoleDialog).getByLabelText("Display name"), "QA Lead");
    await user.click(within(createRoleDialog).getByRole("button", { name: "Create role" }));

    expect(backendClientMock.createSecurityRole).toHaveBeenCalledWith(
      TOKEN,
      "QA Lead",
      "",
      [],
    );
    expect(await screen.findByLabelText("Username")).toBeInTheDocument();
  });

  it("creates a group inline from the create-user flow", async () => {
    const user = userEvent.setup();
    backendClientMock.listSecurityGroups
      .mockResolvedValueOnce(INITIAL_GROUPS_RESPONSE)
      .mockResolvedValue({
        items: [
          {
            id: 84,
            key: null,
            display_name: "QA Guild",
            description: null,
            system: false,
            members: [],
            member_count: 0,
            permissions: [],
            role_ids: [],
          },
        ],
        total: 1,
      });

    renderWithProviders(<UsersMatrix />);

    await user.click(await screen.findByRole("button", { name: "Create user" }));
    expect(await screen.findByLabelText("Username")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /\+ new group/i }));

    const createGroupDialog = await screen.findByRole("dialog", { name: "Create group" });
    await user.type(within(createGroupDialog).getByLabelText("Display name"), "QA Guild");
    await user.click(within(createGroupDialog).getByRole("button", { name: "Create group" }));

    expect(backendClientMock.createSecurityGroup).toHaveBeenCalledWith(TOKEN, "QA Guild", "");
    expect(await screen.findByLabelText("Username")).toBeInTheDocument();
  });
});
