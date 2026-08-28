import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Divider,
  Group,
  Loader,
  Modal,
  MultiSelect,
  ScrollArea,
  Stack,
  Textarea,
  TextInput,
} from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { backendClient } from "@/api/backendClient";
import type { SecurityGroup, SecurityRole } from "@/api/types";
import { QueryKey } from "@/constants";
import { PermissionChecklist } from "@/plugins/admin/security/PermissionChecklist";
import { buildPermissionDomains } from "@/plugins/admin/security/permissionCatalog";
import { useAuthStore } from "@/store/authStore";

type UserOption = { id: number; username: string; display_name: string };

function formatError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function CreateGroupModal({
  opened,
  onClose,
  onCreated,
}: {
  opened: boolean;
  onClose: () => void;
  onCreated?: (group: SecurityGroup) => void;
}) {
  const queryClient = useQueryClient();
  const token = useAuthStore((state) => state.token);

  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [permissions, setPermissions] = useState<Set<string>>(new Set());
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const wasOpenedRef = useRef(false);

  const permissionsQuery = useQuery({
    queryKey: [QueryKey.SECURITY_PERMISSIONS, token],
    queryFn: ({ signal }) => backendClient.listSecurityPermissions(token ?? "", signal),
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
      const group = await backendClient.createSecurityGroup(
        token ?? "",
        displayName,
        description,
      );
      await Promise.all([
        backendClient.updateGroupPermissions(token ?? "", group.id, [...permissions]),
        backendClient.updateGroupMembers(token ?? "", group.id, memberIds.map(Number)),
        backendClient.updateGroupRoles(token ?? "", group.id, roleIds.map(Number)),
      ]);
      return group;
    },
    onSuccess: async (group) => {
      await queryClient.invalidateQueries({ queryKey: [QueryKey.SECURITY_GROUPS] });
      onCreated?.(group);
      onClose();
    },
  });
  const resetCreateMutation = createMutation.reset;

  useEffect(() => {
    if (opened && !wasOpenedRef.current) {
      setDisplayName("");
      setDescription("");
      setPermissions(new Set());
      setMemberIds([]);
      setRoleIds([]);
      resetCreateMutation();
    }
    wasOpenedRef.current = opened;
  }, [opened, resetCreateMutation]);

  const allUsers: UserOption[] = usersQuery.data?.items ?? [];
  const allRoles: SecurityRole[] = rolesQuery.data?.items ?? [];
  const permissionDomains = buildPermissionDomains(permissionsQuery.data?.items ?? []);
  const userOptions = allUsers.map((user) => ({
    value: String(user.id),
    label: `${user.display_name} (${user.username})`,
  }));
  const roleOptions = allRoles.map((role) => ({
    value: String(role.id),
    label: role.display_name,
  }));

  function getRolePermissions(nextRoleIds: string[]): Set<string> {
    const nextPermissions = new Set<string>();
    for (const idStr of nextRoleIds) {
      const role = allRoles.find((item) => item.id === Number(idStr));
      if (!role) {
        continue;
      }
      role.permissions.forEach((permission) => nextPermissions.add(permission));
    }
    return nextPermissions;
  }

  function toggle(key: string) {
    setPermissions((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  const inheritedPermissions = getRolePermissions(roleIds);

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Create group"
      centered
      size="md"
      transitionProps={{ duration: 0 }}
    >
      {permissionsQuery.isLoading || usersQuery.isLoading || rolesQuery.isLoading ? (
        <Group justify="center" py="xl">
          <Loader />
        </Group>
      ) : (
        <Stack>
          {createMutation.isError && (
            <Alert color="red" icon={<IconAlertCircle size={16} />} title="Create failed">
              {formatError(createMutation.error, "Unable to create group.")}
            </Alert>
          )}
          <TextInput
            label="Display name"
            value={displayName}
            onChange={(e) => setDisplayName(e.currentTarget.value)}
          />
          <Textarea
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
            minRows={2}
          />
          <Divider label="Members" labelPosition="left" />
          <MultiSelect
            data={userOptions}
            value={memberIds}
            onChange={setMemberIds}
            placeholder="Add members…"
            searchable
            size="sm"
          />
          <Divider label="Roles" labelPosition="left" />
          <MultiSelect
            data={roleOptions}
            value={roleIds}
            onChange={setRoleIds}
            placeholder="Assign roles…"
            searchable
            size="sm"
          />
          <ScrollArea h={320}>
            <PermissionChecklist
              domains={permissionDomains}
              selected={permissions}
              inherited={inheritedPermissions}
              onToggle={toggle}
            />
          </ScrollArea>
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>Cancel</Button>
            <Button loading={createMutation.isPending} onClick={() => createMutation.mutate()}>
              Create group
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
