import { useState, type CSSProperties } from "react";
import {
  Alert,
  Button,
  Checkbox,
  Group,
  Loader,
  Modal,
  PasswordInput,
  ScrollArea,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconEdit,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { backendClient } from "@/api/backendClient";
import type {
  User,
  UserCreateRequest,
  UserPermissionsResponse,
  UserUpdateRequest,
} from "@/api/types";
import { QueryKey } from "@/constants";
import { CreateGroupModal } from "@/plugins/admin/security/CreateGroupModal";
import { CreateRoleModal } from "@/plugins/admin/security/CreateRoleModal";
import {
  buildPermissionDomains,
  buildPermissionShortLabels,
  collectDomainFirstKeys,
  collectPermissionKeys,
  type PermissionDomain,
} from "@/plugins/admin/security/permissionCatalog";
import { useAuthStore } from "@/store/authStore";

type RoleOption = { id: number; key: string | null; display_name: string };
type GroupOption = { id: number; key: string | null; display_name: string };

type CreateFormState = {
  username: string;
  password: string;
  displayName: string;
  isAdmin: boolean;
  autoLogin: boolean;
  roleId: string;
  groupId: string;
};

type EditFormState = {
  displayName: string;
  isAdmin: boolean;
  autoLogin: boolean;
  resetPassword: boolean;
  password: string;
  roleId: string;
  groupId: string;
};

const CREATE_INITIAL: CreateFormState = {
  username: "",
  password: "",
  displayName: "",
  isAdmin: false,
  autoLogin: false,
  roleId: "",
  groupId: "",
};

function buildEditState(user: User): EditFormState {
  return {
    displayName: user.display_name,
    isAdmin: user.is_admin,
    autoLogin: user.auto_login,
    resetPassword: false,
    password: "",
    roleId: user.role_id != null ? String(user.role_id) : "",
    groupId: user.group_id != null ? String(user.group_id) : "",
  };
}

function formatError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function PermissionCell({
  permKey,
  inherited,
  extra,
  userId,
  token,
}: {
  permKey: string;
  inherited: string[];
  extra: string[];
  userId: number;
  token: string;
}) {
  const queryClient = useQueryClient();

  const addMutation = useMutation({
    mutationFn: () => backendClient.addUserPermission(token, userId, permKey),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [QueryKey.USER_PERMISSIONS, userId] });
    },
  });

  const removeMutation = useMutation({
    mutationFn: () => backendClient.removeUserPermission(token, userId, permKey),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [QueryKey.USER_PERMISSIONS, userId] });
    },
  });

  const isInherited = inherited.includes(permKey);
  const isExtra = extra.includes(permKey);

  if (isInherited) {
    return (
      <input
        type="checkbox"
        checked
        disabled
        style={{ accentColor: "gray", cursor: "not-allowed" }}
        title="Inherited from role or group"
      />
    );
  }

  if (isExtra) {
    return (
      <input
        type="checkbox"
        checked
        onChange={() => removeMutation.mutate()}
        disabled={removeMutation.isPending}
        title="Individual extra permission — click to remove"
      />
    );
  }

  return (
    <input
      type="checkbox"
      checked={false}
      onChange={() => addMutation.mutate()}
      disabled={addMutation.isPending}
      title="Not granted — click to add"
    />
  );
}

function UserRow({
  allKeys,
  domainFirstKeys,
  isProtected,
  isSelf,
  onDelete,
  onEdit,
  token,
  user,
}: {
  allKeys: string[];
  domainFirstKeys: Set<string>;
  isProtected: boolean;
  isSelf: boolean;
  onDelete: (user: User) => void;
  onEdit: (user: User) => void;
  token: string;
  user: User;
}) {
  const permsQuery = useQuery<UserPermissionsResponse>({
    queryKey: [QueryKey.USER_PERMISSIONS, user.id],
    queryFn: ({ signal }) => backendClient.getUserPermissions(token, user.id, signal),
    staleTime: 60_000,
  });

  const inherited = permsQuery.data?.inherited ?? [];
  const extra = permsQuery.data?.extra ?? [];

  return (
    <tr>
      <td style={{ whiteSpace: "nowrap", padding: "6px 10px", fontWeight: 500 }}>
        {user.username}
      </td>
      <td style={{ whiteSpace: "nowrap", padding: "6px 10px" }}>
        <div style={{ fontSize: 13, lineHeight: 1.4 }}>
          <span style={{ fontWeight: 500 }}>
            {user.role?.display_name ?? <span style={{ color: "#999" }}>—</span>}
          </span>
          <br />
          <span style={{ color: "#666" }}>
            {user.group?.display_name ?? <span style={{ color: "#bbb" }}>—</span>}
          </span>
        </div>
      </td>
      <td style={{ whiteSpace: "nowrap", padding: "6px 6px" }}>
        <Group gap={4} wrap="nowrap">
          <Button
            size="xs"
            variant="light"
            leftSection={<IconEdit size={13} />}
            onClick={() => onEdit(user)}
          >
            Edit
          </Button>
          <Button
            size="xs"
            variant="light"
            color="red"
            leftSection={<IconTrash size={13} />}
            disabled={isProtected}
            onClick={() => onDelete(user)}
            title={
              isSelf
                ? "Cannot delete your own account"
                : isProtected
                  ? "Cannot delete admin"
                  : undefined
            }
          >
            Delete
          </Button>
        </Group>
      </td>
      {permsQuery.isLoading ? (
        <td colSpan={Math.max(allKeys.length, 1)} style={{ textAlign: "center" }}>
          <Loader size="xs" />
        </td>
      ) : (
        allKeys.map((key) => (
          <td
            key={key}
            style={{
              textAlign: "center",
              padding: "2px 6px",
              borderLeft: domainFirstKeys.has(key) ? "2px solid #e0e0e0" : undefined,
            }}
          >
            <PermissionCell
              permKey={key}
              inherited={inherited}
              extra={extra}
              userId={user.id}
              token={token}
            />
          </td>
        ))
      )}
    </tr>
  );
}

export function UsersMatrix() {
  const queryClient = useQueryClient();
  const token = useAuthStore((state) => state.token);
  const currentUser = useAuthStore((state) => state.currentUser);
  const setCurrentUser = useAuthStore((state) => state.setCurrentUser);

  const [createOpened, setCreateOpened] = useState(false);
  const [createRoleOpen, setCreateRoleOpen] = useState(false);
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [inlineTarget, setInlineTarget] = useState<"create" | "edit">("create");
  const [createForm, setCreateForm] = useState<CreateFormState>(CREATE_INITIAL);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editForm, setEditForm] = useState<EditFormState | null>(null);
  const [deletingUser, setDeletingUser] = useState<User | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");

  const usersQuery = useQuery({
    queryKey: [QueryKey.USERS, token],
    queryFn: ({ signal }) => backendClient.listUsers(token ?? "", signal),
    enabled: Boolean(token),
  });

  const rolesQuery = useQuery({
    queryKey: [QueryKey.SECURITY_ROLES, token],
    queryFn: ({ signal }) => backendClient.listSecurityRoles(token ?? "", signal),
    enabled: Boolean(token),
  });

  const groupsQuery = useQuery({
    queryKey: [QueryKey.SECURITY_GROUPS, token],
    queryFn: ({ signal }) => backendClient.listSecurityGroups(token ?? "", signal),
    enabled: Boolean(token),
  });

  const permissionsQuery = useQuery({
    queryKey: [QueryKey.SECURITY_PERMISSIONS, token],
    queryFn: ({ signal }) => backendClient.listSecurityPermissions(token ?? "", signal),
    enabled: Boolean(token),
  });

  const createMutation = useMutation({
    mutationFn: async (payload: UserCreateRequest) => {
      if (!token) throw new Error("Authentication is required.");
      return backendClient.createUser(token, payload);
    },
    onSuccess: async (newUser) => {
      if (createForm.roleId || createForm.groupId) {
        await backendClient.updateUserRole(token ?? "", newUser.id, createForm.roleId ? Number(createForm.roleId) : null);
        await backendClient.updateUserGroup(token ?? "", newUser.id, createForm.groupId ? Number(createForm.groupId) : null);
      }
      setCreateOpened(false);
      setCreateForm(CREATE_INITIAL);
      await queryClient.invalidateQueries({ queryKey: [QueryKey.USERS] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({
      userId,
      payload,
      roleId,
      groupId,
    }: {
      userId: number;
      payload: UserUpdateRequest;
      roleId: number | null;
      groupId: number | null;
    }) => {
      if (!token) throw new Error("Authentication is required.");
      const updated = await backendClient.updateUser(token, userId, payload);
      await backendClient.updateUserRole(token, userId, roleId);
      await backendClient.updateUserGroup(token, userId, groupId);
      return updated;
    },
    onSuccess: async (updatedUser) => {
      if (currentUser?.id === updatedUser.id) {
        setCurrentUser(updatedUser);
      }
      setEditingUser(null);
      setEditForm(null);
      await queryClient.invalidateQueries({ queryKey: [QueryKey.USERS] });
      await queryClient.invalidateQueries({ queryKey: [QueryKey.USER_PERMISSIONS, updatedUser.id] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (userId: number) => {
      if (!token) throw new Error("Authentication is required.");
      await backendClient.deleteUser(token, userId);
    },
    onSuccess: async () => {
      setDeletingUser(null);
      setDeleteConfirmation("");
      await queryClient.invalidateQueries({ queryKey: [QueryKey.USERS] });
    },
  });

  function openCreate() {
    createMutation.reset();
    setCreateForm(CREATE_INITIAL);
    setCreateOpened(true);
  }

  function openEdit(user: User) {
    updateMutation.reset();
    setEditingUser(user);
    setEditForm(buildEditState(user));
  }

  function openDelete(user: User) {
    deleteMutation.reset();
    setDeletingUser(user);
    setDeleteConfirmation("");
  }

  function submitCreate() {
    createMutation.mutate({
      username: createForm.username,
      display_name: createForm.displayName,
      password: createForm.password,
      is_admin: createForm.isAdmin,
      auto_login: createForm.autoLogin,
    });
  }

  function submitEdit() {
    if (!editingUser || !editForm) return;
    const payload: UserUpdateRequest = {
      display_name: editForm.displayName,
      is_admin: editForm.isAdmin,
      auto_login: editForm.autoLogin,
    };
    if (editForm.resetPassword) {
      payload.password = editForm.password;
    }
    updateMutation.mutate({
      userId: editingUser.id,
      payload,
      roleId: editForm.roleId ? Number(editForm.roleId) : null,
      groupId: editForm.groupId ? Number(editForm.groupId) : null,
    });
  }

  const roles: RoleOption[] = rolesQuery.data?.items ?? [];
  const groups: GroupOption[] = groupsQuery.data?.items ?? [];
  const users = usersQuery.data?.items ?? [];
  const permissionDomains: PermissionDomain[] = buildPermissionDomains(permissionsQuery.data?.items ?? []);
  const allKeys = collectPermissionKeys(permissionDomains);
  const domainFirstKeys = collectDomainFirstKeys(permissionDomains);
  const shortLabels = buildPermissionShortLabels(allKeys);

  const roleSelectData = [
    { value: "", label: "— none —" },
    ...roles.map((role) => ({ value: String(role.id), label: role.display_name })),
  ];
  const groupSelectData = [
    { value: "", label: "— none —" },
    ...groups.map((group) => ({ value: String(group.id), label: group.display_name })),
  ];

  const headerStyle: CSSProperties = {
    writingMode: "vertical-lr",
    transform: "rotate(180deg)",
    whiteSpace: "nowrap",
    fontSize: 14,
    padding: "8px 2px",
    height: 180,
    verticalAlign: "bottom",
  };

  const deleteConfirmMatches = deleteConfirmation.trim() === deletingUser?.username;

  return (
    <Stack gap="md">
      <Group justify="space-between" align="center">
        <Title order={4}>User Permissions Matrix</Title>
        <Button size="sm" leftSection={<IconPlus size={15} />} onClick={openCreate}>
          Create user
        </Button>
      </Group>

      {usersQuery.isLoading || rolesQuery.isLoading || groupsQuery.isLoading || permissionsQuery.isLoading ? (
        <Stack align="center" py="xl">
          <Loader />
          <Text c="dimmed">Loading users and permissions…</Text>
        </Stack>
      ) : usersQuery.isError || rolesQuery.isError || groupsQuery.isError || permissionsQuery.isError ? (
        <Alert color="red" icon={<IconAlertCircle size={16} />}>
          {formatError(
            usersQuery.error ?? rolesQuery.error ?? groupsQuery.error ?? permissionsQuery.error,
            "Failed to load users, roles, groups, or permissions.",
          )}
        </Alert>
      ) : (
        <ScrollArea>
          <table style={{ borderCollapse: "collapse", fontSize: 16 }}>
            <thead>
              <tr>
                <th rowSpan={2} style={{ padding: "6px 10px", textAlign: "left" }}>Username</th>
                <th rowSpan={2} style={{ padding: "6px 10px", textAlign: "left" }}>Role / Group</th>
                <th rowSpan={2} style={{ padding: "6px 10px", textAlign: "left" }}>Actions</th>
                {permissionDomains.map((domain) => (
                  <th
                    key={domain.key}
                    colSpan={domain.permissions.length}
                    style={{
                      textAlign: "center",
                      borderBottom: "1px solid #ccc",
                      borderLeft: "2px solid #d0d0d0",
                      padding: "2px 6px",
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    {domain.label}
                  </th>
                ))}
              </tr>
              <tr>
                {allKeys.map((key) => (
                  <th
                    key={key}
                    style={{
                      ...headerStyle,
                      borderLeft: domainFirstKeys.has(key) ? "2px solid #d0d0d0" : undefined,
                    }}
                    title={key}
                  >
                    {shortLabels.get(key) ?? key}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const isSelf = user.id === currentUser?.id;
                const isProtected = isSelf || user.username === "admin";
                return (
                  <UserRow
                    key={user.id}
                    allKeys={allKeys}
                    domainFirstKeys={domainFirstKeys}
                    user={user}
                    token={token ?? ""}
                    onEdit={openEdit}
                    onDelete={openDelete}
                    isSelf={isSelf}
                    isProtected={isProtected}
                  />
                );
              })}
            </tbody>
          </table>
          {users.length === 0 && <Text c="dimmed" p="sm">No users found.</Text>}
        </ScrollArea>
      )}

      <Modal opened={createOpened} onClose={() => setCreateOpened(false)} title="Create user" centered transitionProps={{ duration: 0 }}>
        <Stack>
          {createMutation.isError && (
            <Alert color="red" icon={<IconAlertCircle size={16} />} title="Create failed">
              {formatError(createMutation.error, "Unable to create the user.")}
            </Alert>
          )}
          <TextInput label="Username" autoComplete="off" value={createForm.username}
            onChange={(e) => setCreateForm((state) => ({ ...state, username: e.currentTarget.value }))} />
          <TextInput label="Display name" value={createForm.displayName}
            onChange={(e) => setCreateForm((state) => ({ ...state, displayName: e.currentTarget.value }))} />
          <PasswordInput label="Password" autoComplete="new-password"
            description="Leave blank for an empty-password account."
            value={createForm.password}
            onChange={(e) => setCreateForm((state) => ({ ...state, password: e.currentTarget.value }))} />
          <Stack gap={4}>
            <Select label="Role" data={roleSelectData} value={createForm.roleId}
              onChange={(value) => setCreateForm((state) => ({ ...state, roleId: value ?? "" }))} />
            <Button
              variant="subtle"
              size="compact-xs"
              justify="flex-start"
              leftSection={<IconPlus size={12} />}
              onClick={() => {
                setInlineTarget("create");
                setCreateRoleOpen(true);
              }}
            >
              + New role
            </Button>
          </Stack>
          <Stack gap={4}>
            <Select label="Group" data={groupSelectData} value={createForm.groupId}
              onChange={(value) => setCreateForm((state) => ({ ...state, groupId: value ?? "" }))} />
            <Button
              variant="subtle"
              size="compact-xs"
              justify="flex-start"
              leftSection={<IconPlus size={12} />}
              onClick={() => {
                setInlineTarget("create");
                setCreateGroupOpen(true);
              }}
            >
              + New group
            </Button>
          </Stack>
          <Checkbox label="Admin access" checked={createForm.isAdmin}
            onChange={(e) => setCreateForm((state) => ({ ...state, isAdmin: e.currentTarget.checked }))} />
          <Checkbox label="Auto-login" checked={createForm.autoLogin}
            onChange={(e) => setCreateForm((state) => ({ ...state, autoLogin: e.currentTarget.checked }))} />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setCreateOpened(false)}>Cancel</Button>
            <Button loading={createMutation.isPending} onClick={submitCreate}>Create user</Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={Boolean(editingUser && editForm)} onClose={() => { setEditingUser(null); setEditForm(null); }} title="Edit user" centered transitionProps={{ duration: 0 }}>
        <Stack>
          {updateMutation.isError && (
            <Alert color="red" icon={<IconAlertCircle size={16} />} title="Update failed">
              {formatError(updateMutation.error, "Unable to update the user.")}
            </Alert>
          )}
          <TextInput label="Username" readOnly value={editingUser?.username ?? ""} />
          <TextInput label="Display name" value={editForm?.displayName ?? ""}
            onChange={(e) => setEditForm((state) => state ? { ...state, displayName: e.currentTarget.value } : state)} />
          <Stack gap={4}>
            <Select label="Role" data={roleSelectData} value={editForm?.roleId ?? ""}
              onChange={(value) => setEditForm((state) => state ? { ...state, roleId: value ?? "" } : state)} />
            <Button
              variant="subtle"
              size="compact-xs"
              justify="flex-start"
              leftSection={<IconPlus size={12} />}
              onClick={() => {
                setInlineTarget("edit");
                setCreateRoleOpen(true);
              }}
            >
              + New role
            </Button>
          </Stack>
          <Stack gap={4}>
            <Select label="Group" data={groupSelectData} value={editForm?.groupId ?? ""}
              onChange={(value) => setEditForm((state) => state ? { ...state, groupId: value ?? "" } : state)} />
            <Button
              variant="subtle"
              size="compact-xs"
              justify="flex-start"
              leftSection={<IconPlus size={12} />}
              onClick={() => {
                setInlineTarget("edit");
                setCreateGroupOpen(true);
              }}
            >
              + New group
            </Button>
          </Stack>
          <Checkbox label="Admin access"
            checked={editForm?.isAdmin ?? false}
            disabled={editingUser?.id === currentUser?.id}
            onChange={(e) => setEditForm((state) => state ? { ...state, isAdmin: e.currentTarget.checked } : state)} />
          <Checkbox label="Auto-login"
            checked={editForm?.autoLogin ?? false}
            onChange={(e) => setEditForm((state) => state ? { ...state, autoLogin: e.currentTarget.checked } : state)} />
          <Checkbox label="Reset password"
            checked={editForm?.resetPassword ?? false}
            onChange={(e) => setEditForm((state) => state ? { ...state, resetPassword: e.currentTarget.checked, password: e.currentTarget.checked ? state.password : "" } : state)} />
          <PasswordInput label="New password" autoComplete="new-password"
            disabled={!editForm?.resetPassword}
            description="Enable reset above, then enter the new password."
            value={editForm?.password ?? ""}
            onChange={(e) => setEditForm((state) => state ? { ...state, password: e.currentTarget.value } : state)} />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => { setEditingUser(null); setEditForm(null); }}>Cancel</Button>
            <Button loading={updateMutation.isPending} onClick={submitEdit}>Save changes</Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={Boolean(deletingUser)} onClose={() => setDeletingUser(null)} title="Delete user" centered transitionProps={{ duration: 0 }}>
        <Stack>
          {deleteMutation.isError && (
            <Alert color="red" icon={<IconAlertCircle size={16} />} title="Delete failed">
              {formatError(deleteMutation.error, "Unable to delete the user.")}
            </Alert>
          )}
          <Text>
            Type <strong>{deletingUser?.username ?? ""}</strong> to confirm deletion.
          </Text>
          <TextInput label="Confirmation" value={deleteConfirmation}
            onChange={(e) => setDeleteConfirmation(e.currentTarget.value)} />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeletingUser(null)}>Cancel</Button>
            <Button color="red" disabled={!deleteConfirmMatches} loading={deleteMutation.isPending}
              onClick={() => { if (deletingUser) deleteMutation.mutate(deletingUser.id); }}>
              Delete user
            </Button>
          </Group>
        </Stack>
      </Modal>

      <CreateRoleModal
        opened={createRoleOpen}
        onClose={() => setCreateRoleOpen(false)}
        onCreated={(role) => {
          const id = String(role.id);
          if (inlineTarget === "edit") {
            setEditForm((state) => (state ? { ...state, roleId: id } : state));
            return;
          }
          setCreateForm((state) => ({ ...state, roleId: id }));
        }}
      />
      <CreateGroupModal
        opened={createGroupOpen}
        onClose={() => setCreateGroupOpen(false)}
        onCreated={(group) => {
          const id = String(group.id);
          if (inlineTarget === "edit") {
            setEditForm((state) => (state ? { ...state, groupId: id } : state));
            return;
          }
          setCreateForm((state) => ({ ...state, groupId: id }));
        }}
      />
    </Stack>
  );
}
