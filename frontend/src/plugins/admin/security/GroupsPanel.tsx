import { useState } from "react";
import {
  Alert,
  Badge,
  Box,
  Button,
  Checkbox,
  Divider,
  Group,
  Loader,
  Modal,
  MultiSelect,
  ScrollArea,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
} from "@mantine/core";
import { IconAlertCircle, IconEdit, IconPlus, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { backendClient } from "@/api/backendClient";
import type { SecurityGroup, SecurityRole } from "@/api/types";
import { QueryKey } from "@/constants";
import {
  buildPermissionDomains,
  type PermissionDomain,
} from "@/plugins/admin/security/permissionCatalog";
import { useAuthStore } from "@/store/authStore";

type UserOption = { id: number; username: string; display_name: string };

type EditState = {
  group: SecurityGroup;
  displayName: string;
  description: string;
  permissions: Set<string>;
  memberIds: string[];
  roleIds: string[];
};

type CreateState = {
  displayName: string;
  description: string;
  permissions: Set<string>;
  memberIds: string[];
  roleIds: string[];
};

function formatError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function PermissionChecklist({
  directPermissions,
  disabled = false,
  domains,
  inheritedPermissions,
  onToggle,
}: {
  directPermissions: Set<string>;
  disabled?: boolean;
  domains: PermissionDomain[];
  inheritedPermissions: Set<string>;
  onToggle: (key: string) => void;
}) {
  return (
    <Stack gap="md">
      {domains.map((domain) => (
        <Box key={domain.key}>
          <Divider label={domain.label} labelPosition="left" mb="xs" />
          <Stack gap={4}>
            {domain.permissions.map((permission) => {
              const isInherited = inheritedPermissions.has(permission.key);
              return (
                <Checkbox
                  key={permission.key}
                  label={permission.key}
                  description={isInherited ? "Inherited from selected roles" : undefined}
                  checked={isInherited || directPermissions.has(permission.key)}
                  disabled={disabled || isInherited}
                  onChange={() => onToggle(permission.key)}
                  size="sm"
                />
              );
            })}
          </Stack>
        </Box>
      ))}
    </Stack>
  );
}

export function GroupsPanel() {
  const queryClient = useQueryClient();
  const token = useAuthStore((state) => state.token);

  const [createState, setCreateState] = useState<CreateState | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [deletingGroup, setDeletingGroup] = useState<SecurityGroup | null>(null);

  const groupsQuery = useQuery({
    queryKey: [QueryKey.SECURITY_GROUPS, token],
    queryFn: ({ signal }) => backendClient.listSecurityGroups(token ?? "", signal),
    enabled: Boolean(token),
  });

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

  const permissionsQuery = useQuery({
    queryKey: [QueryKey.SECURITY_PERMISSIONS, token],
    queryFn: ({ signal }) => backendClient.listSecurityPermissions(token ?? "", signal),
    enabled: Boolean(token),
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!createState) throw new Error("No create state");
      const group = await backendClient.createSecurityGroup(
        token ?? "",
        createState.displayName,
        createState.description,
      );
      await Promise.all([
        backendClient.updateGroupPermissions(token ?? "", group.id, [...createState.permissions]),
        backendClient.updateGroupMembers(token ?? "", group.id, createState.memberIds.map(Number)),
        backendClient.updateGroupRoles(token ?? "", group.id, createState.roleIds.map(Number)),
      ]);
    },
    onSuccess: async () => {
      setCreateState(null);
      await queryClient.invalidateQueries({ queryKey: [QueryKey.SECURITY_GROUPS] });
    },
  });

  const editMutation = useMutation({
    mutationFn: async () => {
      if (!editState) throw new Error("No edit state");
      await Promise.all([
        backendClient.patchSecurityGroup(token ?? "", editState.group.id, {
          display_name: editState.displayName,
          description: editState.description,
        }),
        backendClient.updateGroupPermissions(token ?? "", editState.group.id, [...editState.permissions]),
        backendClient.updateGroupMembers(token ?? "", editState.group.id, editState.memberIds.map(Number)),
        backendClient.updateGroupRoles(token ?? "", editState.group.id, editState.roleIds.map(Number)),
      ]);
    },
    onSuccess: async () => {
      setEditState(null);
      await queryClient.invalidateQueries({ queryKey: [QueryKey.SECURITY_GROUPS] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (groupId: number) => backendClient.deleteSecurityGroup(token ?? "", groupId),
    onSuccess: async () => {
      setDeletingGroup(null);
      await queryClient.invalidateQueries({ queryKey: [QueryKey.SECURITY_GROUPS] });
    },
  });

  const allRoles: SecurityRole[] = rolesQuery.data?.items ?? [];

  function getRolePermissions(roleIds: string[]): Set<string> {
    const permissions = new Set<string>();
    for (const idStr of roleIds) {
      const role = allRoles.find((item) => item.id === Number(idStr));
      if (!role) {
        continue;
      }
      role.permissions.forEach((permission) => permissions.add(permission));
    }
    return permissions;
  }

  function openCreate() {
    createMutation.reset();
    setCreateState({
      displayName: "",
      description: "",
      permissions: new Set(),
      memberIds: [],
      roleIds: [],
    });
  }

  function openEdit(group: SecurityGroup) {
    editMutation.reset();
    setEditState({
      group,
      displayName: group.display_name,
      description: group.description ?? "",
      permissions: new Set(group.permissions),
      memberIds: group.members.map((member) => String(member.id)),
      roleIds: group.role_ids.map(String),
    });
  }

  function toggleCreatePermission(key: string) {
    setCreateState((state) => {
      if (!state) {
        return state;
      }
      const next = new Set(state.permissions);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return { ...state, permissions: next };
    });
  }

  function toggleEditPermission(key: string) {
    setEditState((state) => {
      if (!state) {
        return state;
      }
      const next = new Set(state.permissions);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return { ...state, permissions: next };
    });
  }

  if (
    groupsQuery.isLoading ||
    usersQuery.isLoading ||
    rolesQuery.isLoading ||
    permissionsQuery.isLoading
  ) {
    return <Loader />;
  }

  if (groupsQuery.error || usersQuery.error || rolesQuery.error || permissionsQuery.error) {
    return (
      <Alert icon={<IconAlertCircle size={16} />} color="red">
        {formatError(
          groupsQuery.error ?? usersQuery.error ?? rolesQuery.error ?? permissionsQuery.error,
          "Failed to load groups, users, roles, or permissions.",
        )}
      </Alert>
    );
  }

  const groups = groupsQuery.data?.items ?? [];
  const allUsers: UserOption[] = usersQuery.data?.items ?? [];
  const permissionDomains = buildPermissionDomains(permissionsQuery.data?.items ?? []);
  const userOptions = allUsers.map((user) => ({
    value: String(user.id),
    label: `${user.display_name} (${user.username})`,
  }));
  const roleOptions = allRoles.map((role) => ({
    value: String(role.id),
    label: role.display_name,
  }));
  const createInheritedPermissions = createState ? getRolePermissions(createState.roleIds) : new Set<string>();
  const editInheritedPermissions = editState ? getRolePermissions(editState.roleIds) : new Set<string>();

  return (
    <Stack gap="md">
      <Group justify="space-between" align="center">
        <Title order={4}>Groups</Title>
        <Button size="sm" leftSection={<IconPlus size={15} />} onClick={openCreate}>
          Create group
        </Button>
      </Group>

      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Name</Table.Th>
            <Table.Th>Key</Table.Th>
            <Table.Th>System</Table.Th>
            <Table.Th>Members</Table.Th>
            <Table.Th>Permissions</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {groups.map((group) => (
            <Table.Tr key={group.id}>
              <Table.Td>
                <Text fw={500}>{group.display_name}</Text>
              </Table.Td>
              <Table.Td>
                <Text size="xs" c="dimmed">{group.key ?? "—"}</Text>
              </Table.Td>
              <Table.Td>
                {group.system && <Badge size="xs" color="blue">system</Badge>}
              </Table.Td>
              <Table.Td>{group.member_count}</Table.Td>
              <Table.Td>{group.permissions.length}</Table.Td>
              <Table.Td>
                <Group gap={6} justify="flex-end">
                  <Button
                    size="xs"
                    variant="light"
                    leftSection={<IconEdit size={12} />}
                    onClick={() => openEdit(group)}
                  >
                    Edit
                  </Button>
                  <Button
                    size="xs"
                    variant="light"
                    color="red"
                    leftSection={<IconTrash size={12} />}
                    disabled={group.system}
                    title={group.system ? "System groups cannot be deleted" : undefined}
                    onClick={() => setDeletingGroup(group)}
                  >
                    Delete
                  </Button>
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {groups.length === 0 && <Text c="dimmed">No groups found.</Text>}

      <Modal
        opened={Boolean(createState)}
        onClose={() => setCreateState(null)}
        title="Create group"
        centered
        size="md"
        transitionProps={{ duration: 0 }}
      >
        {createState && (
          <Stack>
            {createMutation.isError && (
              <Alert color="red" icon={<IconAlertCircle size={16} />} title="Create failed">
                {formatError(createMutation.error, "Unable to create group.")}
              </Alert>
            )}
            <TextInput
              label="Display name"
              value={createState.displayName}
              onChange={(e) =>
                setCreateState((state) => state && { ...state, displayName: e.currentTarget.value })
              }
            />
            <Textarea
              label="Description"
              value={createState.description}
              onChange={(e) =>
                setCreateState((state) => state && { ...state, description: e.currentTarget.value })
              }
              minRows={2}
            />
            <Divider label="Members" labelPosition="left" />
            <MultiSelect
              data={userOptions}
              value={createState.memberIds}
              onChange={(values) =>
                setCreateState((state) => state && { ...state, memberIds: values })
              }
              placeholder="Add members…"
              searchable
              size="sm"
            />
            <Divider label="Roles" labelPosition="left" />
            <MultiSelect
              data={roleOptions}
              value={createState.roleIds}
              onChange={(values) =>
                setCreateState((state) => state && { ...state, roleIds: values })
              }
              placeholder="Assign roles…"
              searchable
              size="sm"
            />
            <ScrollArea h={320}>
              <PermissionChecklist
                directPermissions={createState.permissions}
                domains={permissionDomains}
                inheritedPermissions={createInheritedPermissions}
                onToggle={toggleCreatePermission}
              />
            </ScrollArea>
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setCreateState(null)}>Cancel</Button>
              <Button loading={createMutation.isPending} onClick={() => createMutation.mutate()}>
                Create group
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      <Modal
        opened={Boolean(editState)}
        onClose={() => setEditState(null)}
        title={`Edit group: ${editState?.group.display_name ?? ""}`}
        centered
        size="md"
        transitionProps={{ duration: 0 }}
      >
        {editState && (
          <Stack>
            {editMutation.isError && (
              <Alert color="red" icon={<IconAlertCircle size={16} />} title="Save failed">
                {formatError(editMutation.error, "Unable to save group.")}
              </Alert>
            )}
            <TextInput
              label="Display name"
              value={editState.displayName}
              disabled={editState.group.system}
              onChange={(e) =>
                setEditState((state) => state && { ...state, displayName: e.currentTarget.value })
              }
            />
            <Textarea
              label="Description"
              value={editState.description}
              disabled={editState.group.system}
              onChange={(e) =>
                setEditState((state) => state && { ...state, description: e.currentTarget.value })
              }
              minRows={2}
            />
            <Divider label="Members" labelPosition="left" />
            <MultiSelect
              data={userOptions}
              value={editState.memberIds}
              onChange={(values) =>
                setEditState((state) => state && { ...state, memberIds: values })
              }
              placeholder="Add members…"
              searchable
              size="sm"
            />
            <Divider label="Roles" labelPosition="left" />
            <MultiSelect
              data={roleOptions}
              value={editState.roleIds}
              disabled={editState.group.system}
              onChange={(values) =>
                setEditState((state) => state && { ...state, roleIds: values })
              }
              placeholder="Assign roles…"
              searchable
              size="sm"
            />
            <ScrollArea h={320}>
              <PermissionChecklist
                directPermissions={editState.permissions}
                disabled={editState.group.system}
                domains={permissionDomains}
                inheritedPermissions={editInheritedPermissions}
                onToggle={toggleEditPermission}
              />
            </ScrollArea>
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setEditState(null)}>Cancel</Button>
              <Button loading={editMutation.isPending} onClick={() => editMutation.mutate()}>
                Save
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      <Modal
        opened={Boolean(deletingGroup)}
        onClose={() => setDeletingGroup(null)}
        title="Delete group"
        centered
        transitionProps={{ duration: 0 }}
      >
        <Stack>
          {deleteMutation.isError && (
            <Alert color="red" icon={<IconAlertCircle size={16} />} title="Delete failed">
              {formatError(deleteMutation.error, "Unable to delete group.")}
            </Alert>
          )}
          <Text>
            Delete group <strong>{deletingGroup?.display_name}</strong>? Users in this group will lose its permissions.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeletingGroup(null)}>Cancel</Button>
            <Button
              color="red"
              loading={deleteMutation.isPending}
              onClick={() => {
                if (deletingGroup) {
                  deleteMutation.mutate(deletingGroup.id);
                }
              }}
            >
              Delete group
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
