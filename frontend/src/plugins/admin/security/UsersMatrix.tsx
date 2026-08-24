import { useState } from "react";
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
import { useAuthStore } from "@/store/authStore";

const PERMISSION_DOMAINS = [
  { label: "Security", keys: ["security.read", "security.roles.manage", "security.groups.manage"] },
  { label: "Users", keys: ["users.read", "users.manage"] },
  { label: "Jenkins", keys: ["jenkins.read", "jenkins.freeze", "jenkins.resume"] },
  {
    label: "Stagings",
    keys: ["stagings.read", "stagings.deploy", "stagings.destroy", "stagings.sync", "stagings.e2e_run"],
  },
  { label: "Kuber", keys: ["kuber.read", "kuber.use_context", "kuber.delete_pod"] },
  { label: "QAA", keys: ["qaa.read", "qaa.run", "qaa.admin"] },
  { label: "Other", keys: ["statistics.read", "leonid.read", "leonid.write"] },
];

const ALL_KEYS: string[] = PERMISSION_DOMAINS.flatMap((d) => d.keys);
const DOMAIN_FIRST_KEYS = new Set(PERMISSION_DOMAINS.map((d) => d.keys[0]));

// Show "penultimate.last" when last segment is not unique across all keys
const _lastCounts = new Map<string, number>();
for (const k of ALL_KEYS) {
  const last = k.split(".").at(-1)!;
  _lastCounts.set(last, (_lastCounts.get(last) ?? 0) + 1);
}
function shortLabel(key: string): string {
  const parts = key.split(".");
  const last = parts.at(-1) ?? key;
  if ((_lastCounts.get(last) ?? 0) > 1 && parts.length >= 2) {
    return `${parts.at(-2)}.${last}`;
  }
  return last;
}

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
  user,
  token,
  onEdit,
  onDelete,
  isSelf,
  isProtected,
}: {
  user: User;
  token: string;
  onEdit: (user: User) => void;
  onDelete: (user: User) => void;
  isSelf: boolean;
  isProtected: boolean;
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
          <span style={{ fontWeight: 500 }}>{user.role?.display_name ?? <span style={{ color: "#999" }}>—</span>}</span>
          <br />
          <span style={{ color: "#666" }}>{user.group?.display_name ?? <span style={{ color: "#bbb" }}>—</span>}</span>
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
            title={isSelf ? "Cannot delete your own account" : isProtected ? "Cannot delete admin" : undefined}
          >
            Delete
          </Button>
        </Group>
      </td>
      {permsQuery.isLoading ? (
        <td colSpan={ALL_KEYS.length} style={{ textAlign: "center" }}>
          <Loader size="xs" />
        </td>
      ) : (
        ALL_KEYS.map((key) => (
          <td
            key={key}
            style={{
              textAlign: "center",
              padding: "2px 6px",
              borderLeft: DOMAIN_FIRST_KEYS.has(key) ? "2px solid #e0e0e0" : undefined,
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
      if (currentUser?.id === updatedUser.id) setCurrentUser(updatedUser);
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
    if (editForm.resetPassword) payload.password = editForm.password;
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

  const roleSelectData = [
    { value: "", label: "— none —" },
    ...roles.map((r) => ({ value: String(r.id), label: r.display_name })),
  ];
  const groupSelectData = [
    { value: "", label: "— none —" },
    ...groups.map((g) => ({ value: String(g.id), label: g.display_name })),
  ];

  const headerStyle: React.CSSProperties = {
    writingMode: "vertical-lr",
    transform: "rotate(180deg)",
    whiteSpace: "nowrap",
    fontSize: 14,
    padding: "4px 2px",
    height: 120,
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

      {usersQuery.isLoading ? (
        <Stack align="center" py="xl">
          <Loader />
          <Text c="dimmed">Loading users…</Text>
        </Stack>
      ) : usersQuery.isError ? (
        <Alert color="red" icon={<IconAlertCircle size={16} />}>
          Failed to load users.
        </Alert>
      ) : (
        <ScrollArea>
          <table style={{ borderCollapse: "collapse", fontSize: 16 }}>
            <thead>
              <tr>
                <th rowSpan={2} style={{ padding: "6px 10px", textAlign: "left" }}>Username</th>
                <th rowSpan={2} style={{ padding: "6px 10px", textAlign: "left" }}>Role / Group</th>
                <th rowSpan={2} style={{ padding: "6px 10px", textAlign: "left" }}>Actions</th>
                {PERMISSION_DOMAINS.map((domain) => (
                  <th
                    key={domain.label}
                    colSpan={domain.keys.length}
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
                {ALL_KEYS.map((key) => (
                  <th
                    key={key}
                    style={{
                      ...headerStyle,
                      borderLeft: DOMAIN_FIRST_KEYS.has(key) ? "2px solid #d0d0d0" : undefined,
                    }}
                    title={key}
                  >
                    {shortLabel(key)}
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

      {/* Create modal */}
      <Modal opened={createOpened} onClose={() => setCreateOpened(false)} title="Create user" centered transitionProps={{ duration: 0 }}>
        <Stack>
          {createMutation.isError && (
            <Alert color="red" icon={<IconAlertCircle size={16} />} title="Create failed">
              {createMutation.error instanceof Error ? createMutation.error.message : "Unable to create the user."}
            </Alert>
          )}
          <TextInput label="Username" autoComplete="off" value={createForm.username}
            onChange={(e) => setCreateForm((s) => ({ ...s, username: e.currentTarget.value }))} />
          <TextInput label="Display name" value={createForm.displayName}
            onChange={(e) => setCreateForm((s) => ({ ...s, displayName: e.currentTarget.value }))} />
          <PasswordInput label="Password" autoComplete="new-password"
            description="Leave blank for an empty-password account."
            value={createForm.password}
            onChange={(e) => setCreateForm((s) => ({ ...s, password: e.currentTarget.value }))} />
          <Select label="Role" data={roleSelectData} value={createForm.roleId}
            onChange={(v) => setCreateForm((s) => ({ ...s, roleId: v ?? "" }))} />
          <Select label="Group" data={groupSelectData} value={createForm.groupId}
            onChange={(v) => setCreateForm((s) => ({ ...s, groupId: v ?? "" }))} />
          <Checkbox label="Admin access" checked={createForm.isAdmin}
            onChange={(e) => setCreateForm((s) => ({ ...s, isAdmin: e.currentTarget.checked }))} />
          <Checkbox label="Auto-login" checked={createForm.autoLogin}
            onChange={(e) => setCreateForm((s) => ({ ...s, autoLogin: e.currentTarget.checked }))} />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setCreateOpened(false)}>Cancel</Button>
            <Button loading={createMutation.isPending} onClick={submitCreate}>Create user</Button>
          </Group>
        </Stack>
      </Modal>

      {/* Edit modal */}
      <Modal opened={Boolean(editingUser && editForm)} onClose={() => { setEditingUser(null); setEditForm(null); }} title="Edit user" centered transitionProps={{ duration: 0 }}>
        <Stack>
          {updateMutation.isError && (
            <Alert color="red" icon={<IconAlertCircle size={16} />} title="Update failed">
              {updateMutation.error instanceof Error ? updateMutation.error.message : "Unable to update the user."}
            </Alert>
          )}
          <TextInput label="Username" readOnly value={editingUser?.username ?? ""} />
          <TextInput label="Display name" value={editForm?.displayName ?? ""}
            onChange={(e) => setEditForm((s) => s ? { ...s, displayName: e.currentTarget.value } : s)} />
          <Select label="Role" data={roleSelectData} value={editForm?.roleId ?? ""}
            onChange={(v) => setEditForm((s) => s ? { ...s, roleId: v ?? "" } : s)} />
          <Select label="Group" data={groupSelectData} value={editForm?.groupId ?? ""}
            onChange={(v) => setEditForm((s) => s ? { ...s, groupId: v ?? "" } : s)} />
          <Checkbox label="Admin access"
            checked={editForm?.isAdmin ?? false}
            disabled={editingUser?.id === currentUser?.id}
            onChange={(e) => setEditForm((s) => s ? { ...s, isAdmin: e.currentTarget.checked } : s)} />
          <Checkbox label="Auto-login"
            checked={editForm?.autoLogin ?? false}
            onChange={(e) => setEditForm((s) => s ? { ...s, autoLogin: e.currentTarget.checked } : s)} />
          <Checkbox label="Reset password"
            checked={editForm?.resetPassword ?? false}
            onChange={(e) => setEditForm((s) => s ? { ...s, resetPassword: e.currentTarget.checked, password: e.currentTarget.checked ? s.password : "" } : s)} />
          <PasswordInput label="New password" autoComplete="new-password"
            disabled={!editForm?.resetPassword}
            description="Enable reset above, then enter the new password."
            value={editForm?.password ?? ""}
            onChange={(e) => setEditForm((s) => s ? { ...s, password: e.currentTarget.value } : s)} />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => { setEditingUser(null); setEditForm(null); }}>Cancel</Button>
            <Button loading={updateMutation.isPending} onClick={submitEdit}>Save changes</Button>
          </Group>
        </Stack>
      </Modal>

      {/* Delete modal */}
      <Modal opened={Boolean(deletingUser)} onClose={() => setDeletingUser(null)} title="Delete user" centered transitionProps={{ duration: 0 }}>
        <Stack>
          {deleteMutation.isError && (
            <Alert color="red" icon={<IconAlertCircle size={16} />} title="Delete failed">
              {deleteMutation.error instanceof Error ? deleteMutation.error.message : "Unable to delete the user."}
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
    </Stack>
  );
}
