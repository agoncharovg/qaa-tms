import type { ReactNode } from "react";
import { Alert, Loader, Paper, Stack, Table, Text, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";

import { agentClient } from "@/api/agentClient";
import type {
  NotificatorEvent,
  NotificatorFailReason,
  NotificatorFailureMentionRule,
  NotificatorHistoryItem,
  NotificatorMuteStatus,
  NotificatorProductTeam,
  NotificatorQaaMember,
  NotificatorRecurrentFail,
  NotificatorFullUser,
} from "@/api/types";
import { QueryKey } from "@/constants";
import {
  formatBoolean,
  formatChannels,
  formatNamedEntities,
  formatNamedEntity,
  formatNullable,
  formatUser,
  formatUsers,
} from "@/plugins/notificator/formatters";
import { useAuthStore } from "@/store/authStore";

interface Column<T> {
  header: string;
  key: string;
  render: (item: T) => ReactNode;
}

interface ReadOnlyTablePanelProps<T> {
  columns: Column<T>[];
  emptyText: string;
  errorText: string;
  rows: T[];
  subtitle: string;
  title: string;
}

function ReadOnlyTablePanel<T>({
  columns,
  emptyText,
  errorText,
  rows,
  subtitle,
  title,
}: ReadOnlyTablePanelProps<T>) {
  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>{title}</Title>
        <Text c="dimmed">{subtitle}</Text>
      </div>
      <Paper p="md" withBorder>
        {rows.length === 0 ? (
          <Text c="dimmed">{emptyText}</Text>
        ) : (
          <Table.ScrollContainer minWidth={960}>
            <Table highlightOnHover striped withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  {columns.map((column) => (
                    <Table.Th key={column.key}>{column.header}</Table.Th>
                  ))}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((row, rowIndex) => (
                  <Table.Tr key={rowIndex}>
                    {columns.map((column) => (
                      <Table.Td key={column.key}>{column.render(row)}</Table.Td>
                    ))}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
        {rows.length === 0 ? null : <Text c="dimmed" mt="sm" size="sm">{errorText}</Text>}
      </Paper>
    </Stack>
  );
}

function QueryState<T>({
  agentPort,
  columns,
  emptyText,
  errorTitle,
  fallbackError,
  queryFn,
  queryKey,
  subtitle,
  title,
}: {
  agentPort: number;
  columns: Column<T>[];
  emptyText: string;
  errorTitle: string;
  fallbackError: string;
  queryFn: (port: number, token: string, signal?: AbortSignal) => Promise<T[]>;
  queryKey: string;
  subtitle: string;
  title: string;
}) {
  const token = useAuthStore((state) => state.token) ?? "";
  const query = useQuery({
    queryFn: ({ signal }) => queryFn(agentPort, token, signal),
    queryKey: [queryKey, agentPort, token],
  });

  if (query.isLoading) {
    return (
      <Stack align="center" py="xl">
        <Loader />
        <Text c="dimmed">Loading {title.toLowerCase()}.</Text>
      </Stack>
    );
  }

  if (query.error) {
    return (
      <Alert color="red" title={errorTitle}>
        {query.error instanceof Error ? query.error.message : fallbackError}
      </Alert>
    );
  }

  return (
    <ReadOnlyTablePanel
      columns={columns}
      emptyText={emptyText}
      errorText={subtitle}
      rows={query.data ?? []}
      subtitle={subtitle}
      title={title}
    />
  );
}

const teamsColumns: Column<NotificatorProductTeam>[] = [
  { header: "Team", key: "name", render: (item) => item.name },
  { header: "Product", key: "product", render: (item) => formatNamedEntity(item.product) },
  { header: "Email", key: "email", render: (item) => item.email },
  { header: "PagerDuty", key: "pagerduty", render: (item) => formatNullable(item.pagerduty_ep) },
  { header: "Manager", key: "manager", render: (item) => formatUser(item.manager) },
  { header: "Members", key: "members", render: (item) => formatUsers(item.members) },
  { header: "Notifications", key: "configs", render: (item) => item.notification_configs_count },
  { header: "Sub products", key: "sub-products", render: (item) => item.sub_products_count },
];

const usersColumns: Column<NotificatorFullUser>[] = [
  { header: "Username", key: "username", render: (item) => item.username },
  { header: "SAM", key: "sam", render: (item) => formatNullable(item.sam_account_name) },
  { header: "Principal", key: "principal", render: (item) => formatNullable(item.user_principal_name) },
  { header: "Teams", key: "teams", render: (item) => formatNamedEntities(item.teams) },
  {
    header: "Subscribed events",
    key: "events",
    render: (item) => formatNamedEntities(item.events_subscriptions),
  },
  { header: "Manager", key: "manager", render: (item) => formatUser(item.manager) },
  { header: "Slack ID", key: "slack", render: (item) => formatNullable(item.slack_id) },
  { header: "Notifications", key: "enabled", render: (item) => formatBoolean(item.notifications_enabled) },
];

const qaaMembersColumns: Column<NotificatorQaaMember>[] = [
  { header: "Product", key: "product", render: (item) => item.product.name },
  { header: "User", key: "user", render: (item) => formatUser(item.user) },
];

const failureRulesColumns: Column<NotificatorFailureMentionRule>[] = [
  { header: "Pattern", key: "pattern", render: (item) => item.pattern },
  { header: "Target", key: "target", render: (item) => item.match_target },
  { header: "Environment", key: "environment", render: (item) => item.environment },
  { header: "Enabled", key: "enabled", render: (item) => formatBoolean(item.enabled) },
  { header: "Users", key: "users", render: (item) => formatUsers(item.users) },
  { header: "Template", key: "template", render: (item) => item.message_template },
];

const eventsColumns: Column<NotificatorEvent>[] = [
  { header: "Name", key: "name", render: (item) => item.name },
  { header: "Description", key: "description", render: (item) => item.description },
  { header: "Enabled", key: "enabled", render: (item) => formatBoolean(item.enabled) },
];

const recurrentFailsColumns: Column<NotificatorRecurrentFail>[] = [
  { header: "Description", key: "description", render: (item) => item.description },
  {
    header: "Threshold",
    key: "threshold",
    render: (item) => `${item.number_of_fails} fails / ${item.time_threshold}s`,
  },
  { header: "Environment", key: "environment", render: (item) => item.environment },
  { header: "Product", key: "product", render: (item) => formatNamedEntity(item.product) },
  { header: "Fail reason", key: "reason", render: (item) => formatNamedEntity(item.fail_reasons) },
  { header: "Channels", key: "channels", render: (item) => formatChannels(item.channels) },
  { header: "Mentions", key: "mentions", render: (item) => formatUsers(item.slack_mention) },
  { header: "Mutes", key: "mutes", render: (item) => item.mute_statuses.length },
  { header: "Enabled", key: "enabled", render: (item) => formatBoolean(item.is_enabled) },
];

const failReasonsColumns: Column<NotificatorFailReason>[] = [
  { header: "Name", key: "name", render: (item) => item.name },
];

const muteStatusesColumns: Column<NotificatorMuteStatus>[] = [
  {
    header: "Configuration",
    key: "configuration",
    render: (item) => item.configuration?.description ?? `#${item.configuration?.id ?? "-"}`,
  },
  { header: "Created", key: "created", render: (item) => formatNullable(item.created_at) },
  { header: "Expires", key: "expires", render: (item) => formatNullable(item.expires_at) },
];

const historyColumns: Column<NotificatorHistoryItem>[] = [
  { header: "Author", key: "author", render: (item) => item.author },
  { header: "When muted", key: "when", render: (item) => formatNullable(item.when_muted) },
  { header: "Muted until", key: "until", render: (item) => formatNullable(item.muted_until) },
  { header: "Config ID", key: "config", render: (item) => item.config_id },
];

export function TeamsPanel({ agentPort }: { agentPort: number }) {
  return (
    <QueryState
      agentPort={agentPort}
      columns={teamsColumns}
      emptyText="No teams were returned."
      errorTitle="Notificator teams failed"
      fallbackError="Unable to load Notificator teams."
      queryFn={agentClient.listNotificatorTeams}
      queryKey={QueryKey.NOTIFICATOR_TEAMS}
      subtitle="Product teams, ownership, and notification coverage visible to the shared token."
      title="Teams"
    />
  );
}

export function UsersPanel({ agentPort }: { agentPort: number }) {
  return (
    <QueryState
      agentPort={agentPort}
      columns={usersColumns}
      emptyText="No users were returned."
      errorTitle="Notificator users failed"
      fallbackError="Unable to load Notificator users."
      queryFn={agentClient.listNotificatorUsers}
      queryKey={QueryKey.NOTIFICATOR_USERS}
      subtitle="Read-only user directory with team and event-subscription context."
      title="Users"
    />
  );
}

export function QaaMembersPanel({ agentPort }: { agentPort: number }) {
  return (
    <QueryState
      agentPort={agentPort}
      columns={qaaMembersColumns}
      emptyText="No QAA members were returned."
      errorTitle="Notificator QAA members failed"
      fallbackError="Unable to load Notificator QAA members."
      queryFn={agentClient.listNotificatorQaaMembers}
      queryKey={QueryKey.NOTIFICATOR_QAA_MEMBERS}
      subtitle="Read-only mapping between products and their QAA assignees."
      title="QAA Members"
    />
  );
}

export function FailureMentionRulesPanel({ agentPort }: { agentPort: number }) {
  return (
    <QueryState
      agentPort={agentPort}
      columns={failureRulesColumns}
      emptyText="No failure mention rules were returned."
      errorTitle="Notificator failure mention rules failed"
      fallbackError="Unable to load Notificator failure mention rules."
      queryFn={agentClient.listNotificatorFailureMentionRules}
      queryKey={QueryKey.NOTIFICATOR_FAILURE_MENTION_RULES}
      subtitle="Read-only mention rules used for targeted Slack escalation."
      title="Failure Mention Rules"
    />
  );
}

export function EventsPanel({ agentPort }: { agentPort: number }) {
  return (
    <QueryState
      agentPort={agentPort}
      columns={eventsColumns}
      emptyText="No events were returned."
      errorTitle="Notificator events failed"
      fallbackError="Unable to load Notificator events."
      queryFn={agentClient.listNotificatorEvents}
      queryKey={QueryKey.NOTIFICATOR_EVENTS}
      subtitle="Read-only event catalog driving direct-message subscriptions."
      title="Events"
    />
  );
}

export function RecurrentFailsPanel({ agentPort }: { agentPort: number }) {
  return (
    <QueryState
      agentPort={agentPort}
      columns={recurrentFailsColumns}
      emptyText="No recurrent-fail configs were returned."
      errorTitle="Notificator recurrent fails failed"
      fallbackError="Unable to load Notificator recurrent fails."
      queryFn={agentClient.listNotificatorRecurrentFails}
      queryKey={QueryKey.NOTIFICATOR_RECURRENT_FAILS}
      subtitle="Read-only recurrent-failure alerting rules and active mute counts."
      title="Recurrent Fails"
    />
  );
}

export function FailReasonsPanel({ agentPort }: { agentPort: number }) {
  return (
    <QueryState
      agentPort={agentPort}
      columns={failReasonsColumns}
      emptyText="No fail reasons were returned."
      errorTitle="Notificator fail reasons failed"
      fallbackError="Unable to load Notificator fail reasons."
      queryFn={agentClient.listNotificatorFailReasons}
      queryKey={QueryKey.NOTIFICATOR_FAIL_REASONS}
      subtitle="Read-only fail-reason dictionary referenced by recurrent-fail rules."
      title="Fail Reasons"
    />
  );
}

export function MuteStatusesPanel({ agentPort }: { agentPort: number }) {
  return (
    <QueryState
      agentPort={agentPort}
      columns={muteStatusesColumns}
      emptyText="No mute statuses were returned."
      errorTitle="Notificator mute statuses failed"
      fallbackError="Unable to load Notificator mute statuses."
      queryFn={agentClient.listNotificatorMuteStatuses}
      queryKey={QueryKey.NOTIFICATOR_MUTE_STATUSES}
      subtitle="Read-only active and historical mute windows for recurrent-fail rules."
      title="Mute Statuses"
    />
  );
}

export function HistoryPanel({ agentPort }: { agentPort: number }) {
  return (
    <QueryState
      agentPort={agentPort}
      columns={historyColumns}
      emptyText="No history entries were returned."
      errorTitle="Notificator history failed"
      fallbackError="Unable to load Notificator history."
      queryFn={agentClient.listNotificatorHistory}
      queryKey={QueryKey.NOTIFICATOR_HISTORY}
      subtitle="Read-only mute audit trail exposed through the shared token proxy."
      title="History"
    />
  );
}
