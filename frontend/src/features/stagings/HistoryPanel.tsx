import { useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Box,
  Button,
  Drawer,
  Group,
  Loader,
  Paper,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { IconAlertCircle, IconHistory, IconRotateClockwise } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import type { OperationRead } from "@/api/types";
import { backendClient } from "@/api/backendClient";
import {
  DEFAULT_OPERATIONS_PAGE_SIZE,
  OperationStatus,
  OperationStatusLabel,
  OperationTypeLabel,
  QueryKey,
  SectionKey,
  TabId,
  type OperationStatus as OperationStatusType,
} from "@/constants";
import { useAuthStore } from "@/store/authStore";
import { useStagingsStore } from "@/store/stagingsStore";
import { useUiStore } from "@/store/uiStore";

function getStatusColor(status: OperationStatusType): string {
  switch (status) {
    case OperationStatus.SUCCESS:
      return "teal";
    case OperationStatus.FAILED:
      return "red";
    case OperationStatus.ABORTED:
      return "yellow";
    case OperationStatus.RUNNING:
      return "blue";
    default:
      return "gray";
  }
}

function formatOperationTimestamp(operation: Pick<OperationRead, "created_at" | "started_at">): string {
  return new Date(operation.started_at ?? operation.created_at).toLocaleString();
}

export function HistoryPanel() {
  const [offset, setOffset] = useState(0);
  const queryClient = useQueryClient();
  const token = useAuthStore((state) => state.token);
  const prefillDeployDraft = useStagingsStore((state) => state.prefillDeployDraft);
  const selectedOperationId = useStagingsStore((state) => state.selectedOperationId);
  const setSelectedOperationId = useStagingsStore((state) => state.setSelectedOperationId);
  const openTab = useUiStore((state) => state.openTab);
  const switchTab = useUiStore((state) => state.switchTab);
  const deployOpen = useUiStore((state) =>
    state.tabsBySection[SectionKey.STAGINGS].tabIds.includes(TabId.STAGINGS_DEPLOY)
  );

  async function replayOperation(): Promise<void> {
    if (!token || !selectedOperationId) {
      return;
    }

    const replay = await queryClient.fetchQuery({
      queryFn: ({ signal }) =>
        backendClient.getOperationReplay(token, selectedOperationId, signal),
      queryKey: [QueryKey.OPERATION_REPLAY, token, selectedOperationId],
    });

    prefillDeployDraft(replay);
    if (deployOpen) {
      switchTab(SectionKey.STAGINGS, TabId.STAGINGS_DEPLOY);
      return;
    }

    openTab(SectionKey.STAGINGS, TabId.STAGINGS_DEPLOY);
  }

  const listQuery = useQuery({
    enabled: Boolean(token),
    queryFn: ({ signal }) =>
      backendClient.listOperations(
        token ?? "",
        {
          limit: DEFAULT_OPERATIONS_PAGE_SIZE,
          offset,
        },
        signal
      ),
    queryKey: [QueryKey.OPERATIONS, token, DEFAULT_OPERATIONS_PAGE_SIZE, offset],
  });

  const detailQuery = useQuery({
    enabled: Boolean(token && selectedOperationId),
    queryFn: ({ signal }) =>
      backendClient.getOperation(token ?? "", selectedOperationId ?? "", signal),
    queryKey: [QueryKey.OPERATION_DETAIL, token, selectedOperationId],
  });

  const currentRangeLabel = useMemo(() => {
    const total = listQuery.data?.total ?? 0;
    if (total === 0) {
      return "0 of 0";
    }

    const start = offset + 1;
    const end = Math.min(offset + DEFAULT_OPERATIONS_PAGE_SIZE, total);
    return `${start}-${end} of ${total}`;
  }, [listQuery.data?.total, offset]);
  const operations = listQuery.data?.items ?? [];

  if (listQuery.isLoading) {
    return (
      <Stack align="center" gap="md" py="xl">
        <Loader size="lg" />
        <Text c="dimmed">Loading recorded staging operations.</Text>
      </Stack>
    );
  }

  if (listQuery.isError) {
    return (
      <Alert color="red" icon={<IconAlertCircle size={18} />} title="History request failed">
        <Stack gap="sm">
          <Text>{listQuery.error instanceof Error ? listQuery.error.message : "Unable to load history."}</Text>
          <Group>
            <Button leftSection={<IconRotateClockwise size={16} />} onClick={() => void listQuery.refetch()}>
              Retry
            </Button>
          </Group>
        </Stack>
      </Alert>
    );
  }

  return (
    <>
      <Stack gap="lg">
        <Group justify="space-between">
          <div>
            <Title order={3}>Operation history</Title>
            <Text c="dimmed" size="sm">
              Recorded backend audit entries for deploy and other staging operations.
            </Text>
          </div>
          <Group>
            <Button
              disabled={offset === 0}
              onClick={() => setOffset((currentOffset) => Math.max(0, currentOffset - DEFAULT_OPERATIONS_PAGE_SIZE))}
              variant="light"
            >
              Previous
            </Button>
            <Button
              disabled={offset + DEFAULT_OPERATIONS_PAGE_SIZE >= (listQuery.data?.total ?? 0)}
              onClick={() => setOffset((currentOffset) => currentOffset + DEFAULT_OPERATIONS_PAGE_SIZE)}
              variant="light"
            >
              Next
            </Button>
          </Group>
        </Group>

        {operations.length === 0 ? (
          <Paper p="xl" radius="lg" withBorder>
            <Stack align="center" gap="sm">
              <Text fw={600}>No operations recorded yet.</Text>
              <Text c="dimmed" ta="center">
                Submit a deploy from the Deploy tab and it will appear here after the job finishes.
              </Text>
            </Stack>
          </Paper>
        ) : (
          <Table.ScrollContainer minWidth={920}>
            <Table highlightOnHover striped withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Type</Table.Th>
                  <Table.Th>Namespace</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th>Started / created</Table.Th>
                  <Table.Th>Agent host</Table.Th>
                  <Table.Th>Stagings SHA</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {operations.map((operation) => (
                  <Table.Tr
                    key={operation.id}
                    onClick={() => setSelectedOperationId(operation.id)}
                    style={{ cursor: "pointer" }}
                  >
                    <Table.Td>{OperationTypeLabel[operation.type]}</Table.Td>
                    <Table.Td>{operation.ns ?? "—"}</Table.Td>
                    <Table.Td>
                      <Badge color={getStatusColor(operation.status)} variant="light">
                        {OperationStatusLabel[operation.status]}
                      </Badge>
                    </Table.Td>
                    <Table.Td>{formatOperationTimestamp(operation)}</Table.Td>
                    <Table.Td>{operation.agent_host ?? "—"}</Table.Td>
                    <Table.Td>
                      <Text ff="monospace" size="sm">
                        {operation.stagings_sha ?? "—"}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}

        <Text c="dimmed" size="sm">
          Showing {currentRangeLabel}
        </Text>
      </Stack>

      <Drawer
        onClose={() => setSelectedOperationId(null)}
        opened={Boolean(selectedOperationId)}
        padding="lg"
        position="right"
        size="xl"
        title="Operation details"
      >
        {detailQuery.isLoading ? (
          <Stack align="center" gap="md" py="xl">
            <Loader size="lg" />
            <Text c="dimmed">Loading operation detail.</Text>
          </Stack>
        ) : detailQuery.isError ? (
          <Alert color="red" icon={<IconAlertCircle size={18} />} title="Detail request failed">
            <Text>{detailQuery.error instanceof Error ? detailQuery.error.message : "Unable to load detail."}</Text>
          </Alert>
        ) : detailQuery.data ? (
          <Stack gap="lg">
            <Group align="flex-start" justify="space-between">
              <div>
                <Title order={4}>{OperationTypeLabel[detailQuery.data.type]}</Title>
                <Text c="dimmed" size="sm">
                  {detailQuery.data.ns ?? "No namespace"} • {formatOperationTimestamp(detailQuery.data)}
                </Text>
              </div>
              <Button
                leftSection={<IconHistory size={16} />}
                onClick={() => {
                  void replayOperation();
                }}
                variant="light"
              >
                Replay
              </Button>
            </Group>

            <Group>
              <Badge color={getStatusColor(detailQuery.data.status)} variant="light">
                {OperationStatusLabel[detailQuery.data.status]}
              </Badge>
              <Text c="dimmed" size="sm">
                Exit code: {detailQuery.data.exit_code ?? "n/a"}
              </Text>
            </Group>

            <Paper p="md" radius="md" withBorder>
              <Stack gap="xs">
                <Text fw={600}>Recipe</Text>
                <Text size="sm">Services: {detailQuery.data.recipe.services.join(", ") || "None"}</Text>
                <Text size="sm">Images: {Object.keys(detailQuery.data.recipe.images).length}</Text>
                <Text size="sm">Flags:</Text>
                <Box
                  bg="rgba(2, 6, 12, 0.95)"
                  c="gray.1"
                  p="sm"
                  style={{
                    borderRadius: "12px",
                    fontFamily: "monospace",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {JSON.stringify(detailQuery.data.recipe, null, 2)}
                </Box>
              </Stack>
            </Paper>

            <Paper p="md" radius="md" withBorder>
              <Stack gap="xs">
                <Text fw={600}>Full log</Text>
                <Box
                  bg="rgba(2, 6, 12, 0.95)"
                  c="gray.1"
                  h={360}
                  p="sm"
                  style={{
                    borderRadius: "12px",
                    fontFamily: "monospace",
                    overflowY: "auto",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {detailQuery.data.log ?? "No log captured."}
                </Box>
              </Stack>
            </Paper>
          </Stack>
        ) : null}
      </Drawer>
    </>
  );
}
