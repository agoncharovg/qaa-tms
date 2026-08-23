import {
  Alert,
  Loader,
  ScrollArea,
  Select,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { backendClient } from "@/api/backendClient";
import type { User, UserPermissionsResponse } from "@/api/types";
import { QueryKey } from "@/constants";
import { useAuthStore } from "@/store/authStore";

const PERMISSION_DOMAINS = [
  {
    label: "Security",
    keys: [
      "security.read",
      "security.roles.manage",
      "security.groups.manage",
      "security.audit.read",
    ],
  },
  { label: "Users", keys: ["users.read", "users.manage"] },
  { label: "Jenkins", keys: ["jenkins.read", "jenkins.freeze", "jenkins.resume"] },
  {
    label: "Stagings",
    keys: [
      "stagings.read",
      "stagings.deploy",
      "stagings.destroy",
      "stagings.sync",
      "stagings.e2e_run",
    ],
  },
  { label: "Kuber", keys: ["kuber.read", "kuber.use_context", "kuber.delete_pod"] },
  { label: "QAA", keys: ["qaa.read", "qaa.run", "qaa.admin"] },
  { label: "Other", keys: ["statistics.read", "leonid.read", "leonid.write"] },
] as const;

const ALL_KEYS: string[] = PERMISSION_DOMAINS.flatMap((d) => [...d.keys]);

function shortLabel(key: string): string {
  const parts = key.split(".");
  return parts[parts.length - 1] ?? key;
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
  roles,
  groups,
  token,
}: {
  user: User;
  roles: Array<{ id: number; key: string | null; display_name: string }>;
  groups: Array<{ id: number; key: string | null; display_name: string }>;
  token: string;
}) {
  const queryClient = useQueryClient();

  const permsQuery = useQuery<UserPermissionsResponse>({
    queryKey: [QueryKey.USER_PERMISSIONS, user.id],
    queryFn: ({ signal }) => backendClient.getUserPermissions(token, user.id, signal),
    staleTime: 60_000,
  });

  const roleMutation = useMutation({
    mutationFn: (roleId: number | null) => backendClient.updateUserRole(token, user.id, roleId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [QueryKey.USERS] });
      void queryClient.invalidateQueries({ queryKey: [QueryKey.USER_PERMISSIONS, user.id] });
    },
  });

  const groupMutation = useMutation({
    mutationFn: (groupId: number | null) => backendClient.updateUserGroup(token, user.id, groupId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [QueryKey.USERS] });
      void queryClient.invalidateQueries({ queryKey: [QueryKey.USER_PERMISSIONS, user.id] });
    },
  });

  const inherited = permsQuery.data?.inherited ?? [];
  const extra = permsQuery.data?.extra ?? [];

  const roleOptions = [
    { value: "", label: "— none —" },
    ...roles.map((r) => ({ value: String(r.id), label: r.display_name })),
  ];

  const groupOptions = [
    { value: "", label: "— none —" },
    ...groups.map((g) => ({ value: String(g.id), label: g.display_name })),
  ];

  return (
    <tr>
      <td style={{ whiteSpace: "nowrap", padding: "4px 8px" }}>{user.username}</td>
      <td style={{ whiteSpace: "nowrap", padding: "4px 8px" }}>{user.display_name}</td>
      <td style={{ padding: "4px 4px" }}>
        <Select
          data={groupOptions}
          value={user.group_id != null ? String(user.group_id) : ""}
          onChange={(val) => groupMutation.mutate(val ? Number(val) : null)}
          size="xs"
          style={{ minWidth: 120 }}
          disabled={groupMutation.isPending}
        />
      </td>
      <td style={{ padding: "4px 4px" }}>
        <Select
          data={roleOptions}
          value={user.role_id != null ? String(user.role_id) : ""}
          onChange={(val) => roleMutation.mutate(val ? Number(val) : null)}
          size="xs"
          style={{ minWidth: 120 }}
          disabled={roleMutation.isPending}
        />
      </td>
      {permsQuery.isLoading ? (
        <td colSpan={ALL_KEYS.length} style={{ textAlign: "center" }}>
          <Loader size="xs" />
        </td>
      ) : (
        ALL_KEYS.map((key) => (
          <td key={key} style={{ textAlign: "center", padding: "2px 4px" }}>
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
  const token = useAuthStore((state) => state.token);

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

  if (usersQuery.isLoading || rolesQuery.isLoading || groupsQuery.isLoading) {
    return <Loader />;
  }

  if (usersQuery.error) {
    return (
      <Alert icon={<IconAlertCircle size={16} />} color="red">
        Failed to load users
      </Alert>
    );
  }

  const users = usersQuery.data?.items ?? [];
  const roles = rolesQuery.data?.items ?? [];
  const groups = groupsQuery.data?.items ?? [];

  const headerStyle: React.CSSProperties = {
    writingMode: "vertical-lr",
    transform: "rotate(180deg)",
    whiteSpace: "nowrap",
    fontSize: 11,
    padding: "4px 2px",
    height: 100,
    verticalAlign: "bottom",
  };

  return (
    <Stack gap="sm">
      <Title order={4}>User Permissions Matrix</Title>
      <ScrollArea>
        <table style={{ borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              <th rowSpan={2} style={{ padding: "4px 8px", textAlign: "left" }}>
                Username
              </th>
              <th rowSpan={2} style={{ padding: "4px 8px", textAlign: "left" }}>
                Display Name
              </th>
              <th rowSpan={2} style={{ padding: "4px 8px", textAlign: "left" }}>
                Group
              </th>
              <th rowSpan={2} style={{ padding: "4px 8px", textAlign: "left" }}>
                Role
              </th>
              {PERMISSION_DOMAINS.map((domain) => (
                <th
                  key={domain.label}
                  colSpan={domain.keys.length}
                  style={{
                    textAlign: "center",
                    borderBottom: "1px solid #ccc",
                    padding: "2px 4px",
                    fontSize: 11,
                    fontWeight: 600,
                  }}
                >
                  {domain.label}
                </th>
              ))}
            </tr>
            <tr>
              {ALL_KEYS.map((key) => (
                <th key={key} style={headerStyle} title={key}>
                  {shortLabel(key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <UserRow
                key={user.id}
                user={user}
                roles={roles}
                groups={groups}
                token={token ?? ""}
              />
            ))}
          </tbody>
        </table>
      </ScrollArea>
      {users.length === 0 && <Text c="dimmed">No users found.</Text>}
    </Stack>
  );
}
