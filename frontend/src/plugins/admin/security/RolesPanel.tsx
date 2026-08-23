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
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  Textarea,
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

function RoleRow({
  role,
  token,
  onDelete,
}: {
  role: SecurityRole;
  token: string;
  onDelete: (role: SecurityRole) => void;
}) {
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

  const canDelete = !role.system && role.mutable;

  return (
    <>
      <Table.Tr>
        <Table.Td style={{ cursor: "pointer" }} onClick={() => setExpanded((v) => !v)}>
          <Group gap={4}>
            {expanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
            <Text fw={500}>{role.display_name}</Text>
          </Group>
        </Table.Td>
        <Table.Td>
          <Text size="xs" c="dimmed">{role.key ?? "—"}</Text>
        </Table.Td>
        <Table.Td>
          {role.system && <Badge size="xs" color="blue">system</Badge>}
        </Table.Td>
        <Table.Td>
          {!role.mutable && <Badge size="xs" color="gray">immutable</Badge>}
        </Table.Td>
        <Table.Td>{role.permissions.length}</Table.Td>
        <Table.Td>
          <Button
            size="xs"
            variant="light"
            color="red"
            leftSection={<IconTrash size={12} />}
            disabled={!canDelete}
            title={!canDelete ? "System or immutable roles cannot be deleted" : undefined}
            onClick={() => onDelete(role)}
          >
            Delete
          </Button>
        </Table.Td>
      </Table.Tr>
      {expanded && (
        <Table.Tr>
          <Table.Td colSpan={6}>
            <Box p="sm">
              <Stack gap={4}>
                {ALL_PERMISSIONS.map((key) => (
                  <Checkbox
                    key={key}
                    label={key}
                    checked={role.permissions.includes(key)}
                    disabled={!role.mutable || updateMutation.isPending}
                    onChange={() => togglePermission(key)}
                    size="sm"
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
  const queryClient = useQueryClient();
  const token = useAuthStore((state) => state.token);

  const [createOpened, setCreateOpened] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [deletingRole, setDeletingRole] = useState<SecurityRole | null>(null);

  const rolesQuery = useQuery({
    queryKey: [QueryKey.SECURITY_ROLES, token],
    queryFn: ({ signal }) => backendClient.listSecurityRoles(token ?? "", signal),
    enabled: Boolean(token),
  });

  const createMutation = useMutation({
    mutationFn: () => backendClient.createSecurityRole(token ?? "", displayName, description),
    onSuccess: async () => {
      setCreateOpened(false);
      setDisplayName("");
      setDescription("");
      await queryClient.invalidateQueries({ queryKey: [QueryKey.SECURITY_ROLES] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (roleId: number) => backendClient.deleteSecurityRole(token ?? "", roleId),
    onSuccess: async () => {
      setDeletingRole(null);
      await queryClient.invalidateQueries({ queryKey: [QueryKey.SECURITY_ROLES] });
    },
  });

  if (rolesQuery.isLoading) return <Loader />;

  if (rolesQuery.error) {
    return (
      <Alert icon={<IconAlertCircle size={16} />} color="red">
        Failed to load roles.
      </Alert>
    );
  }

  const roles = rolesQuery.data?.items ?? [];

  return (
    <Stack gap="md">
      <Group justify="space-between" align="center">
        <Title order={4}>Roles</Title>
        <Button size="sm" leftSection={<IconPlus size={15} />} onClick={() => { createMutation.reset(); setCreateOpened(true); }}>
          Create role
        </Button>
      </Group>

      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Name</Table.Th>
            <Table.Th>Key</Table.Th>
            <Table.Th>System</Table.Th>
            <Table.Th>Mutable</Table.Th>
            <Table.Th>Permissions</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {roles.map((role) => (
            <RoleRow key={role.id} role={role} token={token ?? ""} onDelete={setDeletingRole} />
          ))}
        </Table.Tbody>
      </Table>
      {roles.length === 0 && <Text c="dimmed">No roles found.</Text>}

      <Modal opened={createOpened} onClose={() => setCreateOpened(false)} title="Create role" centered transitionProps={{ duration: 0 }}>
        <Stack>
          {createMutation.isError && (
            <Alert color="red" icon={<IconAlertCircle size={16} />} title="Create failed">
              {createMutation.error instanceof Error ? createMutation.error.message : "Unable to create role."}
            </Alert>
          )}
          <TextInput label="Display name" value={displayName} onChange={(e) => setDisplayName(e.currentTarget.value)} />
          <Textarea label="Description" value={description} onChange={(e) => setDescription(e.currentTarget.value)} minRows={2} />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setCreateOpened(false)}>Cancel</Button>
            <Button loading={createMutation.isPending} onClick={() => createMutation.mutate()}>Create role</Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={Boolean(deletingRole)} onClose={() => setDeletingRole(null)} title="Delete role" centered transitionProps={{ duration: 0 }}>
        <Stack>
          {deleteMutation.isError && (
            <Alert color="red" icon={<IconAlertCircle size={16} />} title="Delete failed">
              {deleteMutation.error instanceof Error ? deleteMutation.error.message : "Unable to delete role."}
            </Alert>
          )}
          <Text>Delete role <strong>{deletingRole?.display_name}</strong>? Users assigned to this role will lose its permissions.</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeletingRole(null)}>Cancel</Button>
            <Button color="red" loading={deleteMutation.isPending} onClick={() => { if (deletingRole) deleteMutation.mutate(deletingRole.id); }}>
              Delete role
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
