import { useState } from "react";
import {
  Alert,
  Badge,
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
import { useAuthStore } from "@/store/authStore";

const ALL_PERMISSIONS = [
  "security.read",
  "security.roles.read",
  "security.roles.manage",
  "security.groups.read",
  "security.groups.manage",
  "security.audit.read",
  "users.read",
  "users.manage",
  "profile.self.read",
  "profile.self.manage",
  "server_settings.read",
  "server_settings.manage",
  "operations.read_own",
  "operations.read_all",
  "jenkins.read",
  "jenkins.freeze",
  "jenkins.resume",
  "statistics.read",
  "stagings.read",
  "stagings.deploy",
  "stagings.destroy",
  "stagings.sync",
  "stagings.e2e_run",
  "stagings.credentials.read",
  "kuber.read",
  "kuber.use_context",
  "kuber.delete_pod",
  "qaa.read",
  "qaa.run",
  "qaa.admin",
  "leonid.read",
  "leonid.write",
] as const;

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
    const perms = new Set<string>();
    for (const idStr of roleIds) {
      const role = allRoles.find((r) => r.id === Number(idStr));
      if (role) role.permissions.forEach((p) => perms.add(p));
    }
    return perms;
  }

  function openCreate() {
    createMutation.reset();
    setCreateState({ displayName: "", description: "", permissions: new Set(), memberIds: [], roleIds: [] });
  }

  function openEdit(group: SecurityGroup) {
    editMutation.reset();
    const roleIds = group.role_ids.map(String);
    const ownPerms = new Set(group.permissions);
    const rolePerms = getRolePermissions(roleIds);
    rolePerms.forEach((p) => ownPerms.add(p));
    setEditState({
      group,
      displayName: group.display_name,
      description: group.description ?? "",
      permissions: ownPerms,
      memberIds: group.members.map((m) => String(m.id)),
      roleIds,
    });
  }

  if (groupsQuery.isLoading || usersQuery.isLoading || rolesQuery.isLoading) return <Loader />;
  if (groupsQuery.error) {
    return (
      <Alert icon={<IconAlertCircle size={16} />} color="red">
        Failed to load groups.
      </Alert>
    );
  }

  const groups = groupsQuery.data?.items ?? [];
  const allUsers: UserOption[] = usersQuery.data?.items ?? [];
  const userOptions = allUsers.map((u) => ({
    value: String(u.id),
    label: `${u.display_name} (${u.username})`,
  }));
  const roleOptions = allRoles.map((r) => ({
    value: String(r.id),
    label: r.display_name,
  }));

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

      {/* Create modal */}
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
                {createMutation.error instanceof Error ? createMutation.error.message : "Unable to create group."}
              </Alert>
            )}
            <TextInput
              label="Display name"
              value={createState.displayName}
              onChange={(e) => setCreateState((s) => s && { ...s, displayName: e.currentTarget.value })}
            />
            <Textarea
              label="Description"
              value={createState.description}
              onChange={(e) => setCreateState((s) => s && { ...s, description: e.currentTarget.value })}
              minRows={2}
            />
            <Divider label="Members" labelPosition="left" />
            <MultiSelect
              data={userOptions}
              value={createState.memberIds}
              onChange={(vals) => setCreateState((s) => s && { ...s, memberIds: vals })}
              placeholder="Add members…"
              searchable
              size="sm"
            />
            <Divider label="Roles" labelPosition="left" />
            <MultiSelect
              data={roleOptions}
              value={createState.roleIds}
              onChange={(vals) =>
                setCreateState((s) => {
                  if (!s) return s;
                  const rolePerms = getRolePermissions(vals);
                  const next = new Set(s.permissions);
                  rolePerms.forEach((p) => next.add(p));
                  return { ...s, roleIds: vals, permissions: next };
                })
              }
              placeholder="Assign roles…"
              searchable
              size="sm"
            />
            <Divider label="Permissions" labelPosition="left" />
            <ScrollArea h={220}>
              <Stack gap={4}>
                {ALL_PERMISSIONS.map((key) => (
                  <Checkbox
                    key={key}
                    label={key}
                    checked={createState.permissions.has(key)}
                    onChange={() =>
                      setCreateState((s) => {
                        if (!s) return s;
                        const next = new Set(s.permissions);
                        if (next.has(key)) { next.delete(key); } else { next.add(key); }
                        return { ...s, permissions: next };
                      })
                    }
                    size="sm"
                  />
                ))}
              </Stack>
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

      {/* Edit modal */}
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
                {editMutation.error instanceof Error ? editMutation.error.message : "Unable to save group."}
              </Alert>
            )}
            <TextInput
              label="Display name"
              value={editState.displayName}
              disabled={editState.group.system}
              onChange={(e) => setEditState((s) => s && { ...s, displayName: e.currentTarget.value })}
            />
            <Textarea
              label="Description"
              value={editState.description}
              disabled={editState.group.system}
              onChange={(e) => setEditState((s) => s && { ...s, description: e.currentTarget.value })}
              minRows={2}
            />
            <Divider label="Members" labelPosition="left" />
            <MultiSelect
              data={userOptions}
              value={editState.memberIds}
              onChange={(vals) => setEditState((s) => s && { ...s, memberIds: vals })}
              placeholder="Add members…"
              searchable
              size="sm"
            />
            <Divider label="Roles" labelPosition="left" />
            <MultiSelect
              data={roleOptions}
              value={editState.roleIds}
              disabled={editState.group.system}
              onChange={(vals) =>
                setEditState((s) => {
                  if (!s) return s;
                  const rolePerms = getRolePermissions(vals);
                  const next = new Set(s.permissions);
                  rolePerms.forEach((p) => next.add(p));
                  return { ...s, roleIds: vals, permissions: next };
                })
              }
              placeholder="Assign roles…"
              searchable
              size="sm"
            />
            <Divider label="Permissions" labelPosition="left" />
            <ScrollArea h={220}>
              <Stack gap={4}>
                {ALL_PERMISSIONS.map((key) => (
                  <Checkbox
                    key={key}
                    label={key}
                    checked={editState.permissions.has(key)}
                    disabled={editState.group.system}
                    onChange={() =>
                      setEditState((s) => {
                        if (!s) return s;
                        const next = new Set(s.permissions);
                        if (next.has(key)) { next.delete(key); } else { next.add(key); }
                        return { ...s, permissions: next };
                      })
                    }
                    size="sm"
                  />
                ))}
              </Stack>
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

      {/* Delete confirmation modal */}
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
              {deleteMutation.error instanceof Error ? deleteMutation.error.message : "Unable to delete group."}
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
              onClick={() => { if (deletingGroup) deleteMutation.mutate(deletingGroup.id); }}
            >
              Delete group
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
