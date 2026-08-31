import { Fragment, useState } from "react";
import { ActionIcon, Button, Group, Stack, Table, Text } from "@mantine/core";
import { IconChevronDown, IconChevronRight, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { agentClient } from "@/api/agentClient";
import { QueryKey } from "@/constants";
import { hasPermission } from "@/plugins/permissions";
import {
  RequestsCompanionUnavailableAlert,
  RequestsEmptyCard,
  RequestsErrorAlert,
  RequestsLoadingState,
  RequestsNoticeAlert,
  RequestsSurface,
} from "@/plugins/requests/RequestsShared";
import { getErrorMessage, type RequestsNotice, useRequestsAgent } from "@/plugins/requests/requestsShared";
import { useAuthStore } from "@/store/authStore";

const REQUESTS_WRITE_PERMISSION = "requests.write";

export function RequestsHistoryPanel() {
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((state) => state.currentUser);
  const canWrite = hasPermission(currentUser, REQUESTS_WRITE_PERMISSION);
  const { agentPort, companionUnavailable, preflightQuery, probedPorts, token } = useRequestsAgent();
  const [notice, setNotice] = useState<RequestsNotice | null>(null);
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null);

  const historyQuery = useQuery({
    enabled: Boolean(token && agentPort !== null),
    queryFn: ({ signal }) => agentClient.listHistory(agentPort ?? 0, token ?? "", signal),
    queryKey: [QueryKey.REQUESTS_HISTORY, token, agentPort],
    refetchOnWindowFocus: false,
    retry: false,
  });

  const deleteEntryMutation = useMutation({
    mutationFn: async (entryId: string) => {
      if (!token || agentPort === null) {
        throw new Error("Authentication is required.");
      }
      return agentClient.deleteHistoryEntry(agentPort, token, entryId);
    },
    onError: (error) => {
      setNotice({ message: getErrorMessage(error, "Unable to delete the history entry."), status: "error" });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [QueryKey.REQUESTS_HISTORY] });
    },
  });

  const clearMutation = useMutation({
    mutationFn: async () => {
      if (!token || agentPort === null) {
        throw new Error("Authentication is required.");
      }
      return agentClient.clearHistory(agentPort, token);
    },
    onError: (error) => {
      setNotice({ message: getErrorMessage(error, "Unable to clear the history."), status: "error" });
    },
    onSuccess: async () => {
      setExpandedEntryId(null);
      await queryClient.invalidateQueries({ queryKey: [QueryKey.REQUESTS_HISTORY] });
    },
  });

  if (preflightQuery.isLoading) {
    return <RequestsLoadingState message="Checking the local companion app before loading history." />;
  }

  if (companionUnavailable) {
    return (
      <RequestsCompanionUnavailableAlert
        onRetry={() => void preflightQuery.refetch()}
        probedPorts={probedPorts}
      />
    );
  }

  if (preflightQuery.isError) {
    return (
      <RequestsErrorAlert
        error={preflightQuery.error}
        fallback="Unable to detect the local companion app."
        onRetry={() => void preflightQuery.refetch()}
        title="Companion check failed"
      />
    );
  }

  if (historyQuery.isLoading) {
    return <RequestsLoadingState message="Loading request history from the companion app." />;
  }

  if (historyQuery.isError) {
    return (
      <RequestsErrorAlert
        error={historyQuery.error}
        fallback="Unable to load request history."
        onRetry={() => void historyQuery.refetch()}
        title="History failed"
      />
    );
  }

  const entries = historyQuery.data?.entries ?? [];

  return (
    <Stack gap="md">
      <RequestsNoticeAlert notice={notice} />
      {!canWrite ? <Text c="dimmed" size="sm">Read-only access. History deletion controls are hidden.</Text> : null}
      <RequestsSurface
        description="Recent request executions are stored locally with Authorization values already redacted by the companion app."
        title="History"
      >
        {canWrite ? (
          <Group justify="flex-end">
            <Button
              color="red"
              loading={clearMutation.isPending}
              onClick={() => {
                if (window.confirm("Clear all request history?")) {
                  void clearMutation.mutateAsync();
                }
              }}
              variant="light"
            >
              Clear all
            </Button>
          </Group>
        ) : null}
        {entries.length === 0 ? (
          <RequestsEmptyCard body="No executions have been recorded yet." title="History" />
        ) : (
          <Table striped withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th></Table.Th>
                <Table.Th>Method</Table.Th>
                <Table.Th>URL</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Elapsed</Table.Th>
                <Table.Th>At</Table.Th>
                {canWrite ? <Table.Th></Table.Th> : null}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {entries.map((entry) => {
                const expanded = expandedEntryId === entry.id;
                return (
                  <Fragment key={entry.id}>
                    <Table.Tr key={entry.id}>
                      <Table.Td>
                        <ActionIcon
                          aria-label={`${expanded ? "Collapse" : "Expand"} ${entry.requestSummary.url}`}
                          onClick={() => setExpandedEntryId(expanded ? null : entry.id)}
                          variant="subtle"
                        >
                          {expanded ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
                        </ActionIcon>
                      </Table.Td>
                      <Table.Td>{entry.requestSummary.method}</Table.Td>
                      <Table.Td>{entry.requestSummary.url}</Table.Td>
                      <Table.Td>{entry.responseSummary.statusCode ?? "Error"}</Table.Td>
                      <Table.Td>{entry.responseSummary.elapsedMs ?? 0} ms</Table.Td>
                      <Table.Td>{entry.at}</Table.Td>
                      {canWrite ? (
                        <Table.Td>
                          <Button
                            color="red"
                            leftSection={<IconTrash size={16} />}
                            loading={deleteEntryMutation.isPending}
                            onClick={() => {
                              if (window.confirm("Delete this history entry?")) {
                                void deleteEntryMutation.mutateAsync(entry.id);
                              }
                            }}
                            size="xs"
                            variant="light"
                          >
                            Delete
                          </Button>
                        </Table.Td>
                      ) : null}
                    </Table.Tr>
                    {expanded ? (
                      <Table.Tr key={`${entry.id}-details`}>
                        <Table.Td colSpan={canWrite ? 7 : 6}>
                          <Stack gap="xs">
                            <Text fw={600}>Request summary</Text>
                            <Text size="sm">
                              {entry.requestSummary.method} {entry.requestSummary.url}
                            </Text>
                            {entry.requestSummary.headers.map((header) => (
                              <Text key={`${entry.id}-${header.name}-${header.value}`} size="sm">
                                {header.name}: {header.value}
                              </Text>
                            ))}
                            <Text fw={600}>Response summary</Text>
                            <Text size="sm">Status: {entry.responseSummary.statusCode ?? "Error"}</Text>
                            <Text size="sm">Elapsed: {entry.responseSummary.elapsedMs ?? 0} ms</Text>
                            <Text size="sm">Size: {entry.responseSummary.sizeBytes} B</Text>
                            {entry.responseSummary.error ? <Text c="red">{entry.responseSummary.error}</Text> : null}
                          </Stack>
                        </Table.Td>
                      </Table.Tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </Table.Tbody>
          </Table>
        )}
      </RequestsSurface>
    </Stack>
  );
}

