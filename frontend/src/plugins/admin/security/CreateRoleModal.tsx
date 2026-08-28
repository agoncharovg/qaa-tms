import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Group,
  Loader,
  Modal,
  ScrollArea,
  Stack,
  Textarea,
  TextInput,
} from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { backendClient } from "@/api/backendClient";
import type { SecurityRole } from "@/api/types";
import { QueryKey } from "@/constants";
import { PermissionChecklist } from "@/plugins/admin/security/PermissionChecklist";
import { buildPermissionDomains } from "@/plugins/admin/security/permissionCatalog";
import { useAuthStore } from "@/store/authStore";

function formatError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function CreateRoleModal({
  opened,
  onClose,
  onCreated,
}: {
  opened: boolean;
  onClose: () => void;
  onCreated?: (role: SecurityRole) => void;
}) {
  const queryClient = useQueryClient();
  const token = useAuthStore((state) => state.token);

  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [perms, setPerms] = useState<Set<string>>(new Set());
  const wasOpenedRef = useRef(false);

  const permissionsQuery = useQuery({
    queryKey: [QueryKey.SECURITY_PERMISSIONS, token],
    queryFn: ({ signal }) => backendClient.listSecurityPermissions(token ?? "", signal),
    enabled: Boolean(token),
  });

  const createMutation = useMutation({
    mutationFn: () => backendClient.createSecurityRole(token ?? "", name, desc, [...perms]),
    onSuccess: async (role) => {
      await queryClient.invalidateQueries({ queryKey: [QueryKey.SECURITY_ROLES] });
      onCreated?.(role);
      onClose();
    },
  });
  const resetCreateMutation = createMutation.reset;

  useEffect(() => {
    if (opened && !wasOpenedRef.current) {
      setName("");
      setDesc("");
      setPerms(new Set());
      resetCreateMutation();
    }
    wasOpenedRef.current = opened;
  }, [opened, resetCreateMutation]);

  function toggle(key: string) {
    setPerms((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  const permissionDomains = buildPermissionDomains(permissionsQuery.data?.items ?? []);

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Create role"
      centered
      size="md"
      transitionProps={{ duration: 0 }}
    >
      {permissionsQuery.isLoading ? (
        <Group justify="center" py="xl">
          <Loader />
        </Group>
      ) : (
        <Stack>
          {createMutation.isError && (
            <Alert color="red" icon={<IconAlertCircle size={16} />} title="Create failed">
              {formatError(createMutation.error, "Unable to create role.")}
            </Alert>
          )}
          <TextInput
            label="Display name"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
          />
          <Textarea
            label="Description"
            value={desc}
            onChange={(e) => setDesc(e.currentTarget.value)}
            minRows={2}
          />
          <ScrollArea h={360}>
            <PermissionChecklist
              domains={permissionDomains}
              selected={perms}
              onToggle={toggle}
            />
          </ScrollArea>
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>Cancel</Button>
            <Button loading={createMutation.isPending} onClick={() => createMutation.mutate()}>
              Create role
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
