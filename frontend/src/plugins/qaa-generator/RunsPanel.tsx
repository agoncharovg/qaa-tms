import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Drawer,
  Group,
  Loader,
  LoadingOverlay,
  MultiSelect,
  Paper,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconAlertCircle, IconPlayerPlay, IconRotateClockwise } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";

import { backendClient } from "@/api/backendClient";
import type { QaaRunListResponse, QaaRunSummary } from "@/api/types";
import {
  DEFAULT_QAA_RUNS_PAGE_SIZE,
  QaaRunStatus,
  QaaRunStatusColor,
  QaaRunStatusLabel,
  QueryKey,
  TabId,
} from "@/constants";
import { useAuthStore } from "@/store/authStore";
import { useActivateQaaGeneratorTab } from "@/plugins/qaa-generator/tabNavigation";
import { useQaaRunLive } from "@/plugins/qaa-generator/useQaaRunLive";

const RUNS_PANEL_COPY = {
  DETAIL_TITLE: "Run details",
  EMPTY: "No QAA runs matched the current filters.",
  ERROR_TITLE: "QAA runs request failed",
  JIRA_KEY_HINT: "Partial values filter the current page immediately. A full Jira key queries the backend.",
  NEXT: "Next",
  OPEN_IN_LIVE: "Open in Live",
  PREVIOUS: "Previous",
  PR_LINK: "Open PR",
  STALE_RESULTS: "Showing the last loaded page while the refresh failed.",
  TITLE: "Runs",
} as const;

const QAA_RUN_STATUS_OPTIONS = Object.values(QaaRunStatus).map((statusValue) => ({
  label: QaaRunStatusLabel[statusValue],
  value: statusValue,
}));
const FULL_JIRA_KEY_PATTERN = /^[A-Z][A-Z0-9_]*-\d+$/i;
const RUNS_FILTER_DEBOUNCE_MS = 250;

interface RunsFiltersState {
  createdFrom: string;
  createdTo: string;
  effectiveActor: string;
  jiraKey: string;
  status: string[];
}

const DEFAULT_RUNS_FILTERS_STATE: RunsFiltersState = {
  createdFrom: "",
  createdTo: "",
  effectiveActor: "",
  jiraKey: "",
  status: [],
};

function formatTimestamp(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString() : "—";
}

function buildRemoteJiraKey(value: string): string | undefined {
  const normalizedValue = value.trim().toUpperCase();
  if (normalizedValue.length === 0 || !FULL_JIRA_KEY_PATTERN.test(normalizedValue)) {
    return undefined;
  }

  return normalizedValue;
}

function buildLocalJiraKeyFilter(value: string): string {
  const normalizedValue = value.trim().toLowerCase();
  if (normalizedValue.length === 0 || buildRemoteJiraKey(value)) {
    return "";
  }

  return normalizedValue;
}

export function RunsPanel() {
  const token = useAuthStore((state) => state.token);
  const [filters, setFilters] = useState<RunsFiltersState>(DEFAULT_RUNS_FILTERS_STATE);
  const [serverFilters, setServerFilters] = useState<RunsFiltersState>(DEFAULT_RUNS_FILTERS_STATE);
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([null]);
  const [cursorIndex, setCursorIndex] = useState(0);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const activateTab = useActivateQaaGeneratorTab();
  const { startRun } = useQaaRunLive();
  const currentCursor = cursorStack[cursorIndex] ?? null;
  const serverStatusFilterSignature = serverFilters.status.join(",");

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      setServerFilters(filters);
    }, RUNS_FILTER_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [filters]);

  const runsListParams = useMemo(
    () => ({
      createdFrom: serverFilters.createdFrom || undefined,
      createdTo: serverFilters.createdTo || undefined,
      cursor: currentCursor,
      effectiveActor: serverFilters.effectiveActor.trim() || undefined,
      jiraKey: buildRemoteJiraKey(serverFilters.jiraKey),
      limit: DEFAULT_QAA_RUNS_PAGE_SIZE,
      status: serverFilters.status.length > 0 ? serverFilters.status : undefined,
    }),
    [
      currentCursor,
      serverFilters.createdFrom,
      serverFilters.createdTo,
      serverFilters.effectiveActor,
      serverFilters.jiraKey,
      serverFilters.status,
    ]
  );

  useEffect(() => {
    setCursorStack([null]);
    setCursorIndex(0);
  }, [
    serverFilters.createdFrom,
    serverFilters.createdTo,
    serverFilters.effectiveActor,
    runsListParams.jiraKey,
    serverStatusFilterSignature,
  ]);

  const runsQuery = useQuery<QaaRunListResponse>({
    enabled: Boolean(token),
    placeholderData: (previousData) => previousData,
    queryFn: ({ signal }) => backendClient.listQaaRuns(token ?? "", runsListParams, signal),
    queryKey: [QueryKey.QAA_RUNS, token, runsListParams],
  });

  const detailQuery = useQuery({
    enabled: Boolean(token && selectedRunId),
    queryFn: ({ signal }) => backendClient.getQaaRun(token ?? "", selectedRunId ?? "", signal),
    queryKey: [QueryKey.QAA_RUN_DETAIL, token, selectedRunId],
  });

  const artifactsQuery = useQuery({
    enabled: Boolean(token && selectedRunId),
    queryFn: ({ signal }) =>
      backendClient.getQaaRunArtifacts(token ?? "", selectedRunId ?? "", signal),
    queryKey: [QueryKey.QAA_RUN_ARTIFACTS, token, selectedRunId],
  });

  const nextCursor = runsQuery.data?.next_cursor ?? null;
  const localJiraKeyFilter = buildLocalJiraKeyFilter(filters.jiraKey);
  const displayedRuns: QaaRunSummary[] =
    runsQuery.data?.items.filter((run) => {
      if (localJiraKeyFilter.length === 0) {
        return true;
      }

      return run.jira_key.toLowerCase().includes(localJiraKeyFilter);
    }) ?? [];

  function openRunInLive(runId: string): void {
    startRun(runId);
    activateTab(TabId.QAA_LIVE);
  }

  const runsErrorMessage =
    runsQuery.error instanceof Error ? runsQuery.error.message : RUNS_PANEL_COPY.ERROR_TITLE;
  const showInitialRunsLoader = runsQuery.isLoading && !runsQuery.data;
  const showInitialRunsError = runsQuery.isError && !runsQuery.data;
  const showBackgroundRefreshError = runsQuery.isError && Boolean(runsQuery.data);

  return (
    <>
      <Stack gap="lg">
        <Group justify="space-between">
          <div>
            <Title order={3}>{RUNS_PANEL_COPY.TITLE}</Title>
            <Text c="dimmed" size="sm">
              Browse centrally shared qaa-generator runs with cursor pagination.
            </Text>
          </div>
          <Group>
            <Button
              disabled={cursorIndex === 0 || runsQuery.isFetching}
              onClick={() => {
                setCursorIndex((current) => Math.max(0, current - 1));
              }}
              variant="light"
            >
              {RUNS_PANEL_COPY.PREVIOUS}
            </Button>
            <Button
              disabled={!nextCursor || runsQuery.isFetching}
              onClick={() => {
                if (!nextCursor) {
                  return;
                }
                setCursorStack((current) => {
                  const prefix = current.slice(0, cursorIndex + 1);
                  return [...prefix, nextCursor];
                });
                setCursorIndex((current) => current + 1);
              }}
              variant="light"
            >
              {RUNS_PANEL_COPY.NEXT}
            </Button>
          </Group>
        </Group>

        <Paper p="md" radius="lg" withBorder>
          <Stack gap="md">
            <TextInput
              description={RUNS_PANEL_COPY.JIRA_KEY_HINT}
              label="Jira key"
              onChange={(event) => {
                const { value } = event.currentTarget;
                setFilters((current) => ({
                  ...current,
                  jiraKey: value,
                }));
              }}
              placeholder="QAA-123"
              value={filters.jiraKey}
            />

            <MultiSelect
              data={QAA_RUN_STATUS_OPTIONS}
              label="Status"
              onChange={(value) => {
                setFilters((current) => ({
                  ...current,
                  status: value,
                }));
              }}
              placeholder="Any status"
              value={filters.status}
            />

            <TextInput
              label="Effective actor"
              onChange={(event) => {
                const { value } = event.currentTarget;
                setFilters((current) => ({
                  ...current,
                  effectiveActor: value,
                }));
              }}
              placeholder="email:user@example.com"
              value={filters.effectiveActor}
            />

            <Group grow>
              <TextInput
                label="Created from"
                onChange={(event) => {
                  const { value } = event.currentTarget;
                  setFilters((current) => ({
                    ...current,
                    createdFrom: value,
                  }));
                }}
                type="date"
                value={filters.createdFrom}
              />
              <TextInput
                label="Created to"
                onChange={(event) => {
                  const { value } = event.currentTarget;
                  setFilters((current) => ({
                    ...current,
                    createdTo: value,
                  }));
                }}
                type="date"
                value={filters.createdTo}
              />
            </Group>
          </Stack>
        </Paper>

        {showBackgroundRefreshError ? (
          <Alert color="orange" icon={<IconAlertCircle size={18} />} title={RUNS_PANEL_COPY.ERROR_TITLE}>
            <Stack gap="sm">
              <Text>{runsErrorMessage}</Text>
              <Text size="sm">{RUNS_PANEL_COPY.STALE_RESULTS}</Text>
              <Group>
                <Button leftSection={<IconRotateClockwise size={16} />} onClick={() => void runsQuery.refetch()}>
                  Retry
                </Button>
              </Group>
            </Stack>
          </Alert>
        ) : null}

        <Box pos="relative">
          <LoadingOverlay visible={runsQuery.isFetching && Boolean(runsQuery.data)} zIndex={5} />

          {showInitialRunsLoader ? (
            <Paper p="xl" radius="lg" withBorder>
              <Stack align="center" gap="md" py="xl">
                <Loader size="lg" />
                <Text c="dimmed">Loading QAA runs.</Text>
              </Stack>
            </Paper>
          ) : showInitialRunsError ? (
            <Alert color="red" icon={<IconAlertCircle size={18} />} title={RUNS_PANEL_COPY.ERROR_TITLE}>
              <Stack gap="sm">
                <Text>{runsErrorMessage}</Text>
                <Group>
                  <Button leftSection={<IconRotateClockwise size={16} />} onClick={() => void runsQuery.refetch()}>
                    Retry
                  </Button>
                </Group>
              </Stack>
            </Alert>
          ) : displayedRuns.length === 0 ? (
            <Paper p="xl" radius="lg" withBorder>
              <Stack align="center" gap="sm">
                <Text fw={600}>{RUNS_PANEL_COPY.EMPTY}</Text>
              </Stack>
            </Paper>
          ) : (
            <Table.ScrollContainer minWidth={960}>
              <Table highlightOnHover striped withTableBorder>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Jira key</Table.Th>
                    <Table.Th>Status</Table.Th>
                    <Table.Th>Actor</Table.Th>
                    <Table.Th>Created</Table.Th>
                    <Table.Th>Updated</Table.Th>
                    <Table.Th>Run ID</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {displayedRuns.map((run) => (
                    <Table.Tr
                      key={run.run_id}
                      onClick={() => {
                        setSelectedRunId(run.run_id);
                      }}
                      style={{ cursor: "pointer" }}
                    >
                      <Table.Td>{run.jira_key}</Table.Td>
                      <Table.Td>
                        <Badge color={QaaRunStatusColor[run.status]} variant="light">
                          {QaaRunStatusLabel[run.status]}
                        </Badge>
                      </Table.Td>
                      <Table.Td>{run.effective_actor ?? "—"}</Table.Td>
                      <Table.Td>{formatTimestamp(run.created_at)}</Table.Td>
                      <Table.Td>{formatTimestamp(run.updated_at)}</Table.Td>
                      <Table.Td>
                        <Text ff="monospace" size="sm">
                          {run.run_id}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}
        </Box>
      </Stack>

      <Drawer
        onClose={() => {
          setSelectedRunId(null);
        }}
        opened={Boolean(selectedRunId)}
        padding="lg"
        position="right"
        size="xl"
        title={RUNS_PANEL_COPY.DETAIL_TITLE}
      >
        {detailQuery.isLoading ? (
          <Stack align="center" gap="md" py="xl">
            <Loader size="lg" />
            <Text c="dimmed">Loading run details.</Text>
          </Stack>
        ) : detailQuery.isError ? (
          <Alert color="red" icon={<IconAlertCircle size={18} />} title={RUNS_PANEL_COPY.ERROR_TITLE}>
            <Text>{detailQuery.error instanceof Error ? detailQuery.error.message : RUNS_PANEL_COPY.ERROR_TITLE}</Text>
          </Alert>
        ) : detailQuery.data ? (
          <Stack gap="lg">
            <Group justify="space-between">
              <div>
                <Title order={4}>{detailQuery.data.jira_key}</Title>
                <Text c="dimmed" size="sm">
                  {detailQuery.data.run_id}
                </Text>
              </div>
              <Button
                leftSection={<IconPlayerPlay size={16} />}
                onClick={() => openRunInLive(detailQuery.data.run_id)}
                variant="light"
              >
                {RUNS_PANEL_COPY.OPEN_IN_LIVE}
              </Button>
            </Group>

            <Group>
              <Badge color={QaaRunStatusColor[detailQuery.data.status]} variant="light">
                {QaaRunStatusLabel[detailQuery.data.status]}
              </Badge>
              <Text c="dimmed" size="sm">
                Actor: {detailQuery.data.effective_actor ?? "—"}
              </Text>
            </Group>

            <Paper p="md" radius="md" withBorder>
              <Stack gap="xs">
                <Text fw={600}>Run payload</Text>
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
                  {JSON.stringify(detailQuery.data, null, 2)}
                </Box>
              </Stack>
            </Paper>

            {artifactsQuery.isLoading ? (
              <Group gap="sm">
                <Loader size="sm" />
                <Text c="dimmed" size="sm">
                  Loading artifacts.
                </Text>
              </Group>
            ) : artifactsQuery.data ? (
              <Paper p="md" radius="md" withBorder>
                <Stack gap="xs">
                  <Text fw={600}>Artifacts</Text>
                  {artifactsQuery.data.pr_url ? (
                    <Anchor href={artifactsQuery.data.pr_url} rel="noreferrer" target="_blank">
                      {RUNS_PANEL_COPY.PR_LINK}
                    </Anchor>
                  ) : null}
                  <Text size="sm">{artifactsQuery.data.report_text ?? "No report text returned."}</Text>
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
                    {JSON.stringify(artifactsQuery.data.archive ?? {}, null, 2)}
                  </Box>
                </Stack>
              </Paper>
            ) : null}
          </Stack>
        ) : null}
      </Drawer>
    </>
  );
}
