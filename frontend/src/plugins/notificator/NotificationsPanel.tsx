import { useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  MultiSelect,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { agentClient } from "@/api/agentClient";
import type {
  NotificatorNotificationConfig,
  NotificatorNotificationConfigInput,
} from "@/api/types";
import { QueryKey } from "@/constants";
import { formatChannels, formatUser, formatUsers } from "@/plugins/notificator/formatters";
import { groupNotificationConfigsByTeam } from "@/plugins/notificator/groupByTeam";
import { useAuthStore } from "@/store/authStore";

interface NotificationsPanelProps {
  agentPort: number;
}

interface NotificationFormState {
  productTeam: string;
  notificationType: string;
  enabled: boolean;
  channels: string[];
  users: string[];
}

const EMPTY_FORM: NotificationFormState = {
  productTeam: "",
  notificationType: "",
  enabled: true,
  channels: [],
  users: [],
};

const COPY = {
  EMPTY: "No notification configs were returned.",
  ERROR_FALLBACK: "Unable to load or update Notificator notification configs.",
  ERROR_TITLE: "Notificator notifications failed",
  LOADING: "Loading Notificator notification configs.",
  SUBTITLE:
    "Review notification coverage by product team and drill into each team configuration.",
  TITLE: "Notifications",
} as const;

function formatError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function NotificationsPanel({ agentPort }: NotificationsPanelProps) {
  const token = useAuthStore((state) => state.token) ?? "";
  const queryClient = useQueryClient();
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<NotificatorNotificationConfig | null>(null);
  const [form, setForm] = useState<NotificationFormState>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<NotificatorNotificationConfig | null>(null);

  const configsQuery = useQuery({
    queryFn: ({ signal }) =>
      agentClient.listNotificatorNotificationConfigs(agentPort, token, undefined, signal),
    queryKey: [QueryKey.NOTIFICATOR_NOTIFICATION_CONFIGS, agentPort, token],
  });
  const choicesQuery = useQuery({
    queryFn: ({ signal }) => agentClient.getNotificatorChoices(agentPort, token, signal),
    queryKey: [QueryKey.NOTIFICATOR_CHOICES, agentPort, token],
  });
  const teamsQuery = useQuery({
    queryFn: ({ signal }) => agentClient.listNotificatorTeams(agentPort, token, signal),
    queryKey: [QueryKey.NOTIFICATOR_TEAMS, agentPort, token],
  });
  const channelsQuery = useQuery({
    queryFn: ({ signal }) => agentClient.listNotificatorSlackChannels(agentPort, token, signal),
    queryKey: [QueryKey.NOTIFICATOR_SLACK_CHANNELS, agentPort, token],
  });
  const usersQuery = useQuery({
    queryFn: ({ signal }) => agentClient.listNotificatorUsers(agentPort, token, signal),
    queryKey: [QueryKey.NOTIFICATOR_USERS, agentPort, token],
  });

  const mutation = useMutation({
    mutationFn: (payload: { id: number | null; body: NotificatorNotificationConfigInput }) =>
      payload.id === null
        ? agentClient.createNotificatorNotificationConfig(agentPort, token, payload.body)
        : agentClient.updateNotificatorNotificationConfig(agentPort, token, payload.id, payload.body),
    onSuccess: async () => {
      setEditingConfig(null);
      setForm(EMPTY_FORM);
      setFormOpen(false);
      await queryClient.invalidateQueries({ queryKey: [QueryKey.NOTIFICATOR_NOTIFICATION_CONFIGS] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (configId: number) =>
      agentClient.deleteNotificatorNotificationConfig(agentPort, token, configId),
    onSuccess: async () => {
      setDeleteTarget(null);
      await queryClient.invalidateQueries({ queryKey: [QueryKey.NOTIFICATOR_NOTIFICATION_CONFIGS] });
    },
  });

  function openCreate(): void {
    mutation.reset();
    setEditingConfig(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  }

  function openEdit(item: NotificatorNotificationConfig): void {
    mutation.reset();
    setEditingConfig(item);
    setForm({
      productTeam: String(item.product_team_id),
      notificationType: item.notification_type,
      enabled: item.enabled,
      channels: item.channels.map((channel) => String(channel.id)),
      users: item.users.map((user) => String(user.id)),
    });
    setFormOpen(true);
  }

  function submit(): void {
    mutation.mutate({
      id: editingConfig?.id ?? null,
      body: {
        product_team: Number(form.productTeam),
        notification_type: form.notificationType,
        enabled: form.enabled,
        channels: form.channels.map(Number),
        users: form.users.map(Number),
      },
    });
  }

  const groups = groupNotificationConfigsByTeam(configsQuery.data ?? []);
  const selectedGroup = groups.find((group) => group.teamId === selectedTeamId) ?? null;
  const teamOptions = (teamsQuery.data ?? []).map((team) => ({ label: team.name, value: String(team.id) }));
  const notificationTypeOptions = (choicesQuery.data?.notification_types ?? []).map((item) => ({
    label: item.label,
    value: item.code,
  }));
  const channelOptions = (channelsQuery.data ?? []).map((channel) => ({
    label: channel.description ? `${channel.description} (${channel.channel_id})` : channel.channel_id,
    value: String(channel.id),
  }));
  const userOptions = (usersQuery.data ?? []).map((user) => ({
    label: formatUser(user),
    value: String(user.id),
  }));
  const error =
    configsQuery.error ??
    choicesQuery.error ??
    teamsQuery.error ??
    channelsQuery.error ??
    usersQuery.error ??
    mutation.error ??
    deleteMutation.error;
  const isLoading =
    configsQuery.isLoading ||
    choicesQuery.isLoading ||
    teamsQuery.isLoading ||
    channelsQuery.isLoading ||
    usersQuery.isLoading;

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-start">
        <div>
          <Title order={2}>{COPY.TITLE}</Title>
          <Text c="dimmed">{COPY.SUBTITLE}</Text>
        </div>
        <Button onClick={openCreate} size="xs">Add notification</Button>
      </Group>

      {error ? (
        <Alert color="red" title={COPY.ERROR_TITLE}>
          {formatError(error, COPY.ERROR_FALLBACK)}
        </Alert>
      ) : null}

      {isLoading ? (
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
                        <Group gap="sm">
                          <Text fw={600}>{item.notification_type_label}</Text>
                          <Badge color={item.enabled ? "teal" : "gray"} variant="light">
                            {item.enabled ? "Enabled" : "Disabled"}
                          </Badge>
                        </Group>
                        <Group gap="xs">
                          <Button onClick={() => openEdit(item)} size="xs" variant="light">Edit</Button>
                          <Button color="red" onClick={() => setDeleteTarget(item)} size="xs" variant="light">Delete</Button>
                        </Group>
                      </Group>
                      <Text size="sm">
                        <strong>Channels:</strong> {formatChannels(item.channels, "No channels")}
                      </Text>
                      <Text size="sm">
                        <strong>Users DM:</strong> {formatUsers(item.users, "No DM users")}
                      </Text>
                    </Stack>
                  </Paper>
                ))}
              </Stack>
            </ScrollArea.Autosize>
          </Stack>
        ) : null}
      </Modal>

      <Modal
        opened={formOpen}
        onClose={() => {
          setEditingConfig(null);
          setForm(EMPTY_FORM);
          setFormOpen(false);
        }}
        size="lg"
        title={editingConfig ? "Edit notification" : "Create notification"}
      >
        <Stack>
          <Select
            label="Product team"
            data={teamOptions}
            value={form.productTeam}
            onChange={(value) => setForm((current) => ({ ...current, productTeam: value ?? "" }))}
          />
          <Select
            label="Notification type"
            data={notificationTypeOptions}
            value={form.notificationType}
            onChange={(value) => setForm((current) => ({ ...current, notificationType: value ?? "" }))}
          />
          <MultiSelect
            label="Channels"
            data={channelOptions}
            value={form.channels}
            onChange={(value) => setForm((current) => ({ ...current, channels: value }))}
            searchable
          />
          <MultiSelect
            label="Users DM"
            data={userOptions}
            value={form.users}
            onChange={(value) => setForm((current) => ({ ...current, users: value }))}
            searchable
          />
          <Switch
            checked={form.enabled}
            label="Enabled"
            onChange={(event) =>
              setForm((current) => ({ ...current, enabled: event.currentTarget.checked }))
            }
          />
          <Button
            disabled={
              form.productTeam.length === 0 ||
              form.notificationType.length === 0 ||
              mutation.isPending
            }
            onClick={submit}
          >
            {editingConfig ? "Save" : "Create"}
          </Button>
        </Stack>
      </Modal>

      <Modal opened={deleteTarget !== null} onClose={() => setDeleteTarget(null)} title="Delete notification">
        <Stack>
          <Text>{`Delete ${deleteTarget?.notification_type_label ?? "this notification"}?`}</Text>
          <Button
            color="red"
            disabled={!deleteTarget || deleteMutation.isPending}
            onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
          >
            Delete
          </Button>
        </Stack>
      </Modal>
    </Stack>
  );
}
