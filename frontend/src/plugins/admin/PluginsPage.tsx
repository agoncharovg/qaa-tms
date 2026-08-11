import { useState } from "react";
import {
  Alert,
  Badge,
  Group,
  Loader,
  Stack,
  Switch,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { backendClient } from "@/api/backendClient";
import type { User } from "@/api/types";
import { QueryKey } from "@/constants";
import { resolveIcon } from "@/core/plugins/icons";
import { PluginKind } from "@/core/plugins/types";
import { usePluginsContext } from "@/plugins/context";
import { useAuthStore } from "@/store/authStore";

export function PluginsPage() {
  const queryClient = useQueryClient();
  const token = useAuthStore((state) => state.token);
  const currentUser = useAuthStore((state) => state.currentUser);
  const setEnabledPlugins = useAuthStore((state) => state.setEnabledPlugins);
  const [pendingPluginId, setPendingPluginId] = useState<string | null>(null);
  const { enabledOptionalPluginIdSet, plugins, resolveEnabledOptionalPluginIds } =
    usePluginsContext();

  const updateMutation = useMutation({
    mutationFn: async (enabledPluginIds: User["enabled_plugins"]) => {
      if (!token) {
        throw new Error("Authentication is required.");
      }

      return backendClient.updateMyPlugins(token, enabledPluginIds);
    },
    onSuccess: async ({ enabled_plugins }) => {
      setEnabledPlugins(enabled_plugins);
      await queryClient.invalidateQueries({ queryKey: [QueryKey.ME_PLUGINS] });
    },
    onSettled: () => {
      setPendingPluginId(null);
    },
  });

  if (!currentUser) {
    return (
      <Stack align="center" gap="sm" py="xl">
        <Loader size="lg" />
        <Text c="dimmed">Loading plugins.</Text>
      </Stack>
    );
  }

  const resolvedCurrentUser = currentUser;
  const optionalPlugins = plugins.filter((plugin) => plugin.kind === PluginKind.OPTIONAL);
  const systemPlugins = plugins.filter((plugin) => plugin.kind === PluginKind.SYSTEM);
  const enabledOptionalIds = enabledOptionalPluginIdSet(resolvedCurrentUser.enabled_plugins);

  function handleToggle(pluginId: (typeof optionalPlugins)[number]["id"], checked: boolean): void {
    const currentIds = resolveEnabledOptionalPluginIds(resolvedCurrentUser.enabled_plugins);
    const nextEnabledPluginIds = checked
      ? [...currentIds, pluginId].filter((value, index, values) => values.indexOf(value) === index)
      : currentIds.filter((value) => value !== pluginId);

    setPendingPluginId(pluginId);
    updateMutation.mutate(nextEnabledPluginIds);
  }

  return (
    <Stack gap="lg">
      <Group align="flex-start" justify="space-between">
        <div>
          <Title order={2}>Plugins</Title>
          <Text c="dimmed">
            Enable or disable optional plugins for your own workspace. System plugins stay on for every authenticated user.
          </Text>
        </div>
      </Group>

      {updateMutation.isError ? (
        <Alert color="red" icon={<IconAlertCircle size={18} />} title="Update failed">
          {updateMutation.error instanceof Error
            ? updateMutation.error.message
            : "Unable to update plugin settings."}
        </Alert>
      ) : null}

      {optionalPlugins.length === 0 ? (
        <Alert title="No optional plugins">No optional plugins are registered in this build.</Alert>
      ) : null}

      <Table.ScrollContainer minWidth={760}>
        <Table highlightOnHover striped withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Plugin</Table.Th>
              <Table.Th>Kind</Table.Th>
              <Table.Th>Access</Table.Th>
              <Table.Th>Enabled</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {optionalPlugins.map((plugin) => {
              const checked = enabledOptionalIds.has(plugin.id);
              const Icon = resolveIcon(plugin.icon);
              return (
                <Table.Tr key={plugin.id}>
                  <Table.Td>
                    <Group gap="sm" wrap="nowrap">
                      <Icon size={18} />
                      <div>
                        <Text fw={500}>{plugin.label}</Text>
                        <Text c="dimmed" size="sm">
                          Personal optional plugin
                        </Text>
                      </div>
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <Badge variant="light">Optional</Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">Visible only when enabled for your account.</Text>
                  </Table.Td>
                  <Table.Td>
                    <Switch
                      aria-label={`Toggle ${plugin.label}`}
                      checked={checked}
                      disabled={updateMutation.isPending && pendingPluginId === plugin.id}
                      onChange={(event) => handleToggle(plugin.id, event.currentTarget.checked)}
                    />
                  </Table.Td>
                </Table.Tr>
              );
            })}
            {systemPlugins.map((plugin) => {
              const Icon = resolveIcon(plugin.icon);
              return (
                <Table.Tr key={plugin.id}>
                  <Table.Td>
                    <Group gap="sm" wrap="nowrap">
                      <Icon size={18} />
                      <div>
                        <Text fw={500}>{plugin.label}</Text>
                        <Text c="dimmed" size="sm">
                          Always available to authenticated users
                        </Text>
                      </div>
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <Badge color="blue" variant="light">
                      System
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">This plugin cannot be disabled.</Text>
                  </Table.Td>
                  <Table.Td>
                    <Switch aria-label={`${plugin.label} is enabled`} checked disabled />
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Stack>
  );
}
