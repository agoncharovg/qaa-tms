import { useState } from "react";
import {
  Alert,
  Badge,
  Box,
  Checkbox,
  Group,
  Loader,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { IconAlertCircle, IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { backendClient } from "@/api/backendClient";
import type { SecurityRole } from "@/api/types";
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

function RoleRow({ role, token }: { role: SecurityRole; token: string }) {
  const [expanded, setExpanded] = useState(false);
  const queryClient = useQueryClient();

  const updateMutation = useMutation({
    mutationFn: (permissionKeys: string[]) =>
      backendClient.updateSecurityRole(token, role.id, permissionKeys),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [QueryKey.SECURITY_ROLES] });
    },
  });

  function togglePermission(key: string) {
    const current = new Set(role.permissions);
    if (current.has(key)) {
      current.delete(key);
    } else {
      current.add(key);
    }
    updateMutation.mutate([...current]);
  }

  return (
    <>
      <Table.Tr style={{ cursor: "pointer" }} onClick={() => setExpanded((v) => !v)}>
        <Table.Td>
          <Group gap={4}>
            {expanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
            {role.display_name}
          </Group>
        </Table.Td>
        <Table.Td>
          <Text size="xs" c="dimmed">
            {role.key ?? "—"}
          </Text>
        </Table.Td>
        <Table.Td>
          {role.system && <Badge size="xs" color="blue">system</Badge>}
        </Table.Td>
        <Table.Td>
          {!role.mutable && <Badge size="xs" color="gray">immutable</Badge>}
        </Table.Td>
        <Table.Td>{role.permissions.length}</Table.Td>
      </Table.Tr>
      {expanded && (
        <Table.Tr>
          <Table.Td colSpan={5}>
            <Box p="sm">
              <Stack gap={4}>
                {ALL_PERMISSIONS.map((key) => (
                  <Checkbox
                    key={key}
                    label={key}
                    checked={role.permissions.includes(key)}
                    disabled={!role.mutable || updateMutation.isPending}
                    onChange={() => togglePermission(key)}
                    size="xs"
                  />
                ))}
              </Stack>
            </Box>
          </Table.Td>
        </Table.Tr>
      )}
    </>
  );
}

export function RolesPanel() {
  const token = useAuthStore((state) => state.token);

  const rolesQuery = useQuery({
    queryKey: [QueryKey.SECURITY_ROLES, token],
    queryFn: ({ signal }) => backendClient.listSecurityRoles(token ?? "", signal),
    enabled: Boolean(token),
  });

  if (rolesQuery.isLoading) return <Loader />;

  if (rolesQuery.error) {
    return (
      <Alert icon={<IconAlertCircle size={16} />} color="red">
        Failed to load roles
      </Alert>
    );
  }

  const roles = rolesQuery.data?.items ?? [];

  return (
    <Stack gap="sm">
      <Title order={4}>Roles</Title>
      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Name</Table.Th>
            <Table.Th>Key</Table.Th>
            <Table.Th>System</Table.Th>
            <Table.Th>Mutable</Table.Th>
            <Table.Th>Permissions</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {roles.map((role) => (
            <RoleRow key={role.id} role={role} token={token ?? ""} />
          ))}
        </Table.Tbody>
      </Table>
      {roles.length === 0 && <Text c="dimmed">No roles found.</Text>}
    </Stack>
  );
}
