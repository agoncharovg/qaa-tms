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
import type { SecurityRole } from "@/api/types";
import { QueryKey } from "@/constants";
import {
  buildPermissionDomains,
  type PermissionDomain,
} from "@/plugins/admin/security/permissionCatalog";
import { useAuthStore } from "@/store/authStore";

type EditState = {
  role: SecurityRole;
  displayName: string;
  description: string;
  permissions: Set<string>;
};

function formatError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function PermissionChecklist({
  domains,
  selected,
  disabled = false,
  onToggle,
}: {
  domains: PermissionDomain[];
  selected: Set<string>;
  disabled?: boolean;
  onToggle: (key: string) => void;
}) {
  return (
    <Stack gap="md">
      {domains.map((domain) => (
        <Box key={domain.key}>
          <Divider label={domain.label} labelPosition="left" mb="xs" />
          <Stack gap={4}>
            {domain.permissions.map((permission) => (
              <Checkbox
                key={permission.key}
                label={permission.key}
                checked={selected.has(permission.key)}
                disabled={disabled}
                onChange={() => onToggle(permission.key)}
                size="sm"
              />
            ))}
          </Stack>
        </Box>
      ))}
    </Stack>
  );
}

export function RolesPanel() {
  const queryClient = useQueryClient();
  const token = useAuthStore((state) => state.token);

  const [createOpened, setCreateOpened] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createDesc, setCreateDesc] = useState("");
  const [createPerms, setCreatePerms] = useState<Set<string>>(new Set());

  const [editState, setEditState] = useState<EditState | null>(null);
  const [deletingRole, setDeletingRole] = useState<SecurityRole | null>(null);

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
    mutationFn: () =>
      backendClient.createSecurityRole(token ?? "", createName, createDesc, [...createPerms]),
    onSuccess: async () => {
      setCreateOpened(false);
      setCreateName("");
      setCreateDesc("");
      setCreatePerms(new Set());
      await queryClient.invalidateQueries({ queryKey: [QueryKey.SECURITY_ROLES] });
    },
  });

  const editMutation = useMutation({
    mutationFn: () => {
      if (!editState) throw new Error("No edit state");
      return backendClient.updateSecurityRoleFull(token ?? "", editState.role.id, {
        display_name: editState.displayName,
        description: editState.description,
        permission_keys: [...editState.permissions],
      });
    },
    onSuccess: async () => {
      setEditState(null);
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

  function openEdit(role: SecurityRole) {
    editMutation.reset();
    setEditState({
      role,
      displayName: role.display_name,
      description: role.description ?? "",
      permissions: new Set(role.permissions),
    });
  }

  function toggleCreatePerm(key: string) {
    setCreatePerms((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function toggleEditPerm(key: string) {
    setEditState((prev) => {
      if (!prev) return prev;
      const next = new Set(prev.permissions);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return { ...prev, permissions: next };
    });
  }

  if (rolesQuery.isLoading || permissionsQuery.isLoading) {
    return <Loader />;
  }

  if (rolesQuery.error || permissionsQuery.error) {
    return (
      <Alert icon={<IconAlertCircle size={16} />} color="red">
        {formatError(rolesQuery.error ?? permissionsQuery.error, "Failed to load roles or permissions.")}
      </Alert>
    );
  }

  const roles = rolesQuery.data?.items ?? [];
  const permissionDomains = buildPermissionDomains(permissionsQuery.data?.items ?? []);

  return (
    <Stack gap="md">
      <Group justify="space-between" align="center">
        <Title order={4}>Roles</Title>
        <Button
          size="sm"
          leftSection={<IconPlus size={15} />}
          onClick={() => {
            createMutation.reset();
            setCreateName("");
            setCreateDesc("");
            setCreatePerms(new Set());
            setCreateOpened(true);
          }}
        >
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
          {roles.map((role) => {
            const canDelete = !role.system && role.mutable;
            return (
              <Table.Tr key={role.id}>
                <Table.Td>
                  <Text fw={500}>{role.display_name}</Text>
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
                  <Group gap={6} justify="flex-end">
                    <Button
                      size="xs"
                      variant="light"
                      leftSection={<IconEdit size={12} />}
                      onClick={() => openEdit(role)}
                    >
                      Edit
                    </Button>
                    <Button
                      size="xs"
                      variant="light"
                      color="red"
                      leftSection={<IconTrash size={12} />}
                      disabled={!canDelete}
                      title={!canDelete ? "System or immutable roles cannot be deleted" : undefined}
                      onClick={() => setDeletingRole(role)}
                    >
                      Delete
                    </Button>
                  </Group>
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
      {roles.length === 0 && <Text c="dimmed">No roles found.</Text>}

      <Modal
        opened={createOpened}
        onClose={() => setCreateOpened(false)}
        title="Create role"
        centered
        size="md"
        transitionProps={{ duration: 0 }}
      >
        <Stack>
          {createMutation.isError && (
            <Alert color="red" icon={<IconAlertCircle size={16} />} title="Create failed">
              {formatError(createMutation.error, "Unable to create role.")}
            </Alert>
          )}
          <TextInput
            label="Display name"
            value={createName}
            onChange={(e) => setCreateName(e.currentTarget.value)}
          />
          <Textarea
            label="Description"
            value={createDesc}
            onChange={(e) => setCreateDesc(e.currentTarget.value)}
            minRows={2}
          />
          <ScrollArea h={360}>
            <PermissionChecklist
              domains={permissionDomains}
              selected={createPerms}
              onToggle={toggleCreatePerm}
            />
          </ScrollArea>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setCreateOpened(false)}>Cancel</Button>
            <Button loading={createMutation.isPending} onClick={() => createMutation.mutate()}>
              Create role
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={Boolean(editState)}
        onClose={() => setEditState(null)}
        title={`Edit role: ${editState?.role.display_name ?? ""}`}
        centered
        size="md"
        transitionProps={{ duration: 0 }}
      >
        {editState && (
          <Stack>
            {editMutation.isError && (
              <Alert color="red" icon={<IconAlertCircle size={16} />} title="Save failed">
                {formatError(editMutation.error, "Unable to save role.")}
              </Alert>
            )}
            <TextInput
              label="Display name"
              value={editState.displayName}
              disabled={!editState.role.mutable}
              onChange={(e) =>
                setEditState((state) => state && { ...state, displayName: e.currentTarget.value })
              }
            />
            <Textarea
              label="Description"
              value={editState.description}
              disabled={!editState.role.mutable}
              onChange={(e) =>
                setEditState((state) => state && { ...state, description: e.currentTarget.value })
              }
              minRows={2}
            />
            {!editState.role.mutable && (
              <Box>
                <Text size="xs" c="dimmed">This role is immutable, so permissions cannot be changed.</Text>
              </Box>
            )}
            <ScrollArea h={360}>
              <PermissionChecklist
                domains={permissionDomains}
                selected={editState.permissions}
                disabled={!editState.role.mutable}
                onToggle={toggleEditPerm}
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
        opened={Boolean(deletingRole)}
        onClose={() => setDeletingRole(null)}
        title="Delete role"
        centered
        transitionProps={{ duration: 0 }}
      >
        <Stack>
          {deleteMutation.isError && (
            <Alert color="red" icon={<IconAlertCircle size={16} />} title="Delete failed">
              {formatError(deleteMutation.error, "Unable to delete role.")}
            </Alert>
          )}
          <Text>
            Delete role <strong>{deletingRole?.display_name}</strong>? Users assigned to this role will lose its permissions.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeletingRole(null)}>Cancel</Button>
            <Button
              color="red"
              loading={deleteMutation.isPending}
              onClick={() => {
                if (deletingRole) {
                  deleteMutation.mutate(deletingRole.id);
                }
              }}
            >
              Delete role
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
