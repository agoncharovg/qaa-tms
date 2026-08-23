import { useState } from "react";
import {
  Alert,
  Badge,
  Box,
  Button,
  Checkbox,
  Group,
  Loader,
  Modal,
  MultiSelect,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconChevronDown,
  IconChevronRight,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { backendClient } from "@/api/backendClient";
import type { SecurityGroup } from "@/api/types";
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

function GroupRow({
  group,
  token,
  allUsers,
  onDelete,
}: {
  group: SecurityGroup;
  token: string;
  allUsers: Array<{ id: number; username: string; display_name: string }>;
  onDelete: (group: SecurityGroup) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const queryClient = useQueryClient();

  const permMutation = useMutation({
    mutationFn: (permissionKeys: string[]) =>
      backendClient.updateGroupPermissions(token, group.id, permissionKeys),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [QueryKey.SECURITY_GROUPS] });
    },
  });

  const memberMutation = useMutation({
    mutationFn: (userIds: number[]) =>
      backendClient.updateGroupMembers(token, group.id, userIds),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [QueryKey.SECURITY_GROUPS] });
    },
  });

  function togglePermission(key: string) {
    const current = new Set(group.permissions);
    if (current.has(key)) {
      current.delete(key);
    } else {
      current.add(key);
    }
    permMutation.mutate([...current]);
  }

  const memberIds = group.members.map((m) => String(m.id));
  const userOptions = allUsers.map((u) => ({
    value: String(u.id),
    label: `${u.display_name} (${u.username})`,
  }));

  return (
    <>
      <Table.Tr>
        <Table.Td style={{ cursor: "pointer" }} onClick={() => setExpanded((v) => !v)}>
          <Group gap={4}>
            {expanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
            <Text fw={500}>{group.display_name}</Text>
          </Group>
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
          <Button
            size="xs"
            variant="light"
            color="red"
            leftSection={<IconTrash size={12} />}
            disabled={group.system}
            title={group.system ? "System groups cannot be deleted" : undefined}
            onClick={() => onDelete(group)}
          >
            Delete
          </Button>
        </Table.Td>
      </Table.Tr>
      {expanded && (
        <Table.Tr>
          <Table.Td colSpan={6}>
            <Box p="sm">
              <Stack gap="md">
                <Box>
                  <Text fw={600} size="sm" mb={4}>Members</Text>
                  <MultiSelect
                    data={userOptions}
                    value={memberIds}
                    onChange={(vals) => memberMutation.mutate(vals.map(Number))}
                    disabled={memberMutation.isPending}
                    placeholder="Add members…"
                    searchable
                    size="sm"
                  />
                </Box>
                <Box>
                  <Text fw={600} size="sm" mb={4}>Permissions</Text>
                  <Stack gap={4}>
                    {ALL_PERMISSIONS.map((key) => (
                      <Checkbox
                        key={key}
                        label={key}
                        checked={group.permissions.includes(key)}
                        disabled={permMutation.isPending}
                        onChange={() => togglePermission(key)}
                        size="sm"
                      />
                    ))}
                  </Stack>
                </Box>
              </Stack>
            </Box>
          </Table.Td>
        </Table.Tr>
      )}
    </>
  );
}

export function GroupsPanel() {
  const queryClient = useQueryClient();
  const token = useAuthStore((state) => state.token);

  const [createOpened, setCreateOpened] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
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

  const createMutation = useMutation({
    mutationFn: () => backendClient.createSecurityGroup(token ?? "", displayName, description),
    onSuccess: async () => {
      setCreateOpened(false);
      setDisplayName("");
      setDescription("");
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

  if (groupsQuery.isLoading || usersQuery.isLoading) return <Loader />;

  if (groupsQuery.error) {
    return (
      <Alert icon={<IconAlertCircle size={16} />} color="red">
        Failed to load groups.
      </Alert>
    );
  }

  const groups = groupsQuery.data?.items ?? [];
  const allUsers = usersQuery.data?.items ?? [];

  return (
    <Stack gap="md">
      <Group justify="space-between" align="center">
        <Title order={4}>Groups</Title>
        <Button size="sm" leftSection={<IconPlus size={15} />} onClick={() => { createMutation.reset(); setCreateOpened(true); }}>
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
            <GroupRow key={group.id} group={group} token={token ?? ""} allUsers={allUsers} onDelete={setDeletingGroup} />
          ))}
        </Table.Tbody>
      </Table>
      {groups.length === 0 && <Text c="dimmed">No groups found.</Text>}

      <Modal opened={createOpened} onClose={() => setCreateOpened(false)} title="Create group" centered transitionProps={{ duration: 0 }}>
        <Stack>
          {createMutation.isError && (
            <Alert color="red" icon={<IconAlertCircle size={16} />} title="Create failed">
              {createMutation.error instanceof Error ? createMutation.error.message : "Unable to create group."}
            </Alert>
          )}
          <TextInput label="Display name" value={displayName} onChange={(e) => setDisplayName(e.currentTarget.value)} />
          <Textarea label="Description" value={description} onChange={(e) => setDescription(e.currentTarget.value)} minRows={2} />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setCreateOpened(false)}>Cancel</Button>
            <Button loading={createMutation.isPending} onClick={() => createMutation.mutate()}>Create group</Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={Boolean(deletingGroup)} onClose={() => setDeletingGroup(null)} title="Delete group" centered transitionProps={{ duration: 0 }}>
        <Stack>
          {deleteMutation.isError && (
            <Alert color="red" icon={<IconAlertCircle size={16} />} title="Delete failed">
              {deleteMutation.error instanceof Error ? deleteMutation.error.message : "Unable to delete group."}
            </Alert>
          )}
          <Text>Delete group <strong>{deletingGroup?.display_name}</strong>? Users in this group will lose its permissions.</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeletingGroup(null)}>Cancel</Button>
            <Button color="red" loading={deleteMutation.isPending} onClick={() => { if (deletingGroup) deleteMutation.mutate(deletingGroup.id); }}>
              Delete group
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
