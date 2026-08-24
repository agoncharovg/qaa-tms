import { useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  Paper,
  ScrollArea,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";

import { agentClient } from "@/api/agentClient";
import { QueryKey } from "@/constants";
import { groupNotificationConfigsByTeam } from "@/plugins/notificator/groupByTeam";
import { useAuthStore } from "@/store/authStore";

interface NotificationsPanelProps {
  agentPort: number;
}

const COPY = {
  EMPTY: "No notification configs were returned.",
  ERROR_FALLBACK: "Unable to load Notificator notification configs.",
  ERROR_TITLE: "Notificator notifications failed",
  LOADING: "Loading Notificator notification configs.",
  SUBTITLE: "Review notification coverage by product team and drill into each team configuration.",
  TITLE: "Notifications",
} as const;

function formatError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function formatChannels(
  channels: { channel_id: string; description: string | null }[]
): string {
  if (channels.length === 0) {
    return "No channels";
  }

  return channels
    .map((channel) =>
      channel.description ? `${channel.description} (${channel.channel_id})` : channel.channel_id
    )
    .join(", ");
}

function formatUsers(
  users: { sam_account_name: string; user_principal_name: string }[]
): string {
  if (users.length === 0) {
    return "No DM users";
  }

  return users
    .map((user) => `${user.sam_account_name} (${user.user_principal_name})`)
    .join(", ");
}

export function NotificationsPanel({ agentPort }: NotificationsPanelProps) {
  const token = useAuthStore((state) => state.token) ?? "";
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);

  const configsQuery = useQuery({
    queryFn: ({ signal }) =>
      agentClient.listNotificatorNotificationConfigs(agentPort, token, undefined, signal),
    queryKey: [QueryKey.NOTIFICATOR_NOTIFICATION_CONFIGS, agentPort, token],
  });

  const groups = groupNotificationConfigsByTeam(configsQuery.data ?? []);
  const selectedGroup = groups.find((group) => group.teamId === selectedTeamId) ?? null;
  const error = configsQuery.error;

  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>{COPY.TITLE}</Title>
        <Text c="dimmed">{COPY.SUBTITLE}</Text>
      </div>

      {error ? (
        <Alert color="red" title={COPY.ERROR_TITLE}>
          {formatError(error, COPY.ERROR_FALLBACK)}
        </Alert>
      ) : null}

      {configsQuery.isLoading ? (
        <Stack align="center" py="xl">
          <Loader />
          <Text c="dimmed">{COPY.LOADING}</Text>
        </Stack>
      ) : groups.length === 0 ? (
        <Text c="dimmed">{COPY.EMPTY}</Text>
      ) : (
        <Paper p="md" withBorder>
          <Table.ScrollContainer minWidth={720}>
            <Table highlightOnHover striped withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Team</Table.Th>
                  <Table.Th>Total notifications</Table.Th>
                  <Table.Th>Enabled</Table.Th>
                  <Table.Th>Channels</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {groups.map((group) => (
                  <Table.Tr
                    key={group.teamId}
                    onClick={() => setSelectedTeamId(group.teamId)}
                    style={{ cursor: "pointer" }}
                  >
                    <Table.Td>
                      <Button
                        aria-label={`Open ${group.teamName} notifications`}
                        onClick={() => setSelectedTeamId(group.teamId)}
                        size="compact-sm"
                        variant="subtle"
                      >
                        {group.teamName}
                      </Button>
                    </Table.Td>
                    <Table.Td>{group.totalNotifications}</Table.Td>
                    <Table.Td>{`${group.enabledCount}/${group.totalNotifications}`}</Table.Td>
                    <Table.Td>{group.distinctChannelCount}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Paper>
      )}

      <Modal
        onClose={() => setSelectedTeamId(null)}
        opened={selectedGroup !== null}
        size="lg"
        title={selectedGroup ? `${selectedGroup.teamName} notifications` : "Notifications"}
      >
        {selectedGroup ? (
          <Stack gap="md">
            <Text c="dimmed" size="sm">
              {`${selectedGroup.enabledCount}/${selectedGroup.totalNotifications} enabled across ${selectedGroup.distinctChannelCount} channels.`}
            </Text>
            <ScrollArea.Autosize mah={420}>
              <Stack gap="sm">
                {selectedGroup.items.map((item) => (
                  <Paper key={item.id} p="sm" withBorder>
                    <Stack gap="xs">
                      <Group justify="space-between" wrap="nowrap">
                        <Text fw={600}>{item.notification_type_label}</Text>
                        <Badge color={item.enabled ? "teal" : "gray"} variant="light">
                          {item.enabled ? "Enabled" : "Disabled"}
                        </Badge>
                      </Group>
                      <Text size="sm">
                        <strong>Channels:</strong> {formatChannels(item.channels)}
                      </Text>
                      <Text size="sm">
                        <strong>Users DM:</strong> {formatUsers(item.users)}
                      </Text>
                    </Stack>
                  </Paper>
                ))}
              </Stack>
            </ScrollArea.Autosize>
          </Stack>
        ) : null}
      </Modal>
    </Stack>
  );
}
