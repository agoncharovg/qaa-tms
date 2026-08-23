import { useState } from "react";
import {
  Alert,
  Badge,
  Box,
  Checkbox,
  Group,
  Loader,
  MultiSelect,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { IconAlertCircle, IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

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
}: {
  group: SecurityGroup;
  token: string;
  allUsers: Array<{ id: number; username: string; display_name: string }>;
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
      <Table.Tr style={{ cursor: "pointer" }} onClick={() => setExpanded((v) => !v)}>
        <Table.Td>
          <Group gap={4}>
            {expanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
            {group.display_name}
          </Group>
        </Table.Td>
        <Table.Td>
          <Text size="xs" c="dimmed">
            {group.key ?? "—"}
          </Text>
        </Table.Td>
        <Table.Td>
          {group.system && <Badge size="xs" color="blue">system</Badge>}
        </Table.Td>
        <Table.Td>{group.member_count}</Table.Td>
        <Table.Td>{group.permissions.length}</Table.Td>
      </Table.Tr>
      {expanded && (
        <Table.Tr>
          <Table.Td colSpan={5}>
            <Box p="sm">
              <Stack gap="md">
                <Box>
                  <Text fw={600} size="sm" mb={4}>
                    Members
                  </Text>
                  <MultiSelect
                    data={userOptions}
                    value={memberIds}
                    onChange={(vals) => memberMutation.mutate(vals.map(Number))}
                    disabled={memberMutation.isPending}
                    placeholder="Add members..."
                    searchable
                    size="xs"
                  />
                </Box>
                <Box>
                  <Text fw={600} size="sm" mb={4}>
                    Permissions
                  </Text>
                  <Stack gap={4}>
                    {ALL_PERMISSIONS.map((key) => (
                      <Checkbox
                        key={key}
                        label={key}
                        checked={group.permissions.includes(key)}
                        disabled={permMutation.isPending}
                        onChange={() => togglePermission(key)}
                        size="xs"
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
  const token = useAuthStore((state) => state.token);

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

  if (groupsQuery.isLoading || usersQuery.isLoading) return <Loader />;

  if (groupsQuery.error) {
    return (
      <Alert icon={<IconAlertCircle size={16} />} color="red">
        Failed to load groups
      </Alert>
    );
  }

  const groups = groupsQuery.data?.items ?? [];
  const allUsers = usersQuery.data?.items ?? [];

  return (
    <Stack gap="sm">
      <Title order={4}>Groups</Title>
      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Name</Table.Th>
            <Table.Th>Key</Table.Th>
            <Table.Th>System</Table.Th>
            <Table.Th>Members</Table.Th>
            <Table.Th>Permissions</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {groups.map((group) => (
            <GroupRow key={group.id} group={group} token={token ?? ""} allUsers={allUsers} />
          ))}
        </Table.Tbody>
      </Table>
      {groups.length === 0 && <Text c="dimmed">No groups found.</Text>}
    </Stack>
  );
}
