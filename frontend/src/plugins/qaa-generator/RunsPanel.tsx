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

import { qaaAgentClient } from "@/api/qaaAgentClient";
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
import { isTerminalQaaRunStatus } from "@/plugins/qaa-generator/runState";
import { useQaaRunLive } from "@/plugins/qaa-generator/useQaaRunLive";

const RUNS_PANEL_COPY = {
  ARTIFACTS_PENDING_MESSAGE: "Artifacts appear after the run reaches a terminal status.",
  ARTIFACTS_PENDING_TITLE: "Artifacts pending",
  DETAIL_TITLE: "Run details",
  EMPTY: "No QAA runs matched the current filters.",
  ERROR_TITLE: "QAA runs request failed",
  JIRA_KEY_HINT: "Partial values filter the current page immediately. A full Jira key queries the backend.",
  MISSING_TOKEN_PREFIX: "Set your personal qaa-generator token in ",
  MISSING_TOKEN_SUFFIX: " before browsing runs.",
  MISSING_TOKEN_TITLE: "Personal qaa-generator token required",
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
const PROFILE_SETTINGS_HREF = "/profile?section=settings" as const;
const RUNS_FILTER_DEBOUNCE_MS = 250;

interface RunsFiltersState {
  createdFrom: string;
  createdTo: string;
  effectiveActor: string;
  jiraKey: string;
  status: string[];
}

interface RunsPanelProps {
  agentPort: number;
  hasPersonalToken: boolean;
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

export function RunsPanel({ agentPort, hasPersonalToken }: RunsPanelProps) {
  const token = useAuthStore((state) => state.token);
  const [filters, setFilters] = useState<RunsFiltersState>(DEFAULT_RUNS_FILTERS_STATE);
  const [serverFilters, setServerFilters] = useState<RunsFiltersState>(DEFAULT_RUNS_FILTERS_STATE);
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([null]);
  const [cursorIndex, setCursorIndex] = useState(0);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const activateTab = useActivateQaaGeneratorTab();
  const { startRun } = useQaaRunLive(agentPort, hasPersonalToken);
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
    enabled: Boolean(token) && hasPersonalToken,
    placeholderData: (previousData) => previousData,
    queryFn: ({ signal }) => qaaAgentClient.listQaaRuns(agentPort, token ?? "", runsListParams, signal),
    queryKey: [QueryKey.QAA_RUNS, agentPort, token, runsListParams],
  });

  const detailQuery = useQuery({
    enabled: Boolean(token && selectedRunId && hasPersonalToken),
    queryFn: ({ signal }) => qaaAgentClient.getQaaRun(agentPort, token ?? "", selectedRunId ?? "", signal),
    queryKey: [QueryKey.QAA_RUN_DETAIL, agentPort, token, selectedRunId],
  });

  const selectedRunStatus = detailQuery.data?.status;
  const selectedRunIsTerminal = selectedRunStatus ? isTerminalQaaRunStatus(selectedRunStatus) : false;
  const artifactsQuery = useQuery({
    enabled: Boolean(token && selectedRunId && hasPersonalToken && selectedRunIsTerminal),
    queryFn: ({ signal }) =>
      qaaAgentClient.getQaaRunArtifacts(agentPort, token ?? "", selectedRunId ?? "", signal),
    queryKey: [QueryKey.QAA_RUN_ARTIFACTS, agentPort, token, selectedRunId],
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
    // Close the detail drawer so the switched-to Live tab isn't left covered by the
    // drawer overlay (the drawer renders in a body-level portal).
    setSelectedRunId(null);
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
              disabled={cursorIndex === 0 || runsQuery.isFetching || !hasPersonalToken}
              onClick={() => {
                setCursorIndex((current) => Math.max(0, current - 1));
              }}
              variant="light"
            >
              {RUNS_PANEL_COPY.PREVIOUS}
            </Button>
            <Button
              disabled={!nextCursor || runsQuery.isFetching || !hasPersonalToken}
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

        {!hasPersonalToken ? (
          <Alert color="yellow" icon={<IconAlertCircle size={18} />} title={RUNS_PANEL_COPY.MISSING_TOKEN_TITLE}>
            {RUNS_PANEL_COPY.MISSING_TOKEN_PREFIX}
            <Anchor href={PROFILE_SETTINGS_HREF}>Profile / Settings</Anchor>
            {RUNS_PANEL_COPY.MISSING_TOKEN_SUFFIX}
          </Alert>
        ) : null}

        <Paper p="md" radius="lg" withBorder>
          <Stack gap="md">
            <TextInput
              description={RUNS_PANEL_COPY.JIRA_KEY_HINT}
              label="Jira key"
              onChange={(event) => {
                const value = event.currentTarget.value;
                setFilters((current) => ({ ...current, jiraKey: value }));
              }}
              placeholder="QAA-123"
              value={filters.jiraKey}
            />

            <MultiSelect
              clearable
              data={QAA_RUN_STATUS_OPTIONS}
              label="Status"
              onChange={(value) => {
                setFilters((current) => ({ ...current, status: value }));
              }}
              placeholder="Any status"
              value={filters.status}
            />

            <Group grow>
              <TextInput
                label="Effective actor"
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setFilters((current) => ({ ...current, effectiveActor: value }));
                }}
                placeholder="email:user@example.com"
                value={filters.effectiveActor}
              />
              <TextInput
                label="Created from"
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setFilters((current) => ({ ...current, createdFrom: value }));
                }}
                placeholder="2026-08-11T10:00:00+00:00"
                value={filters.createdFrom}
              />
              <TextInput
                label="Created to"
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setFilters((current) => ({ ...current, createdTo: value }));
                }}
                placeholder="2026-08-11T11:00:00+00:00"
                value={filters.createdTo}
              />
            </Group>
          </Stack>
        </Paper>

        {showInitialRunsLoader ? (
          <Stack align="center" gap="sm" py="xl">
            <Loader size="lg" />
            <Text c="dimmed">Loading QAA runs.</Text>
          </Stack>
        ) : null}

        {showInitialRunsError ? (
          <Alert color="red" icon={<IconAlertCircle size={18} />} title={RUNS_PANEL_COPY.ERROR_TITLE}>
            <Stack gap="sm">
              <Text>{runsErrorMessage}</Text>
              <Group>
                <Button leftSection={<IconRotateClockwise size={16} />} onClick={() => void runsQuery.refetch()} variant="light">
                  Retry
                </Button>
              </Group>
            </Stack>
          </Alert>
        ) : null}

        {showBackgroundRefreshError ? (
          <Alert color="yellow" icon={<IconAlertCircle size={18} />} title={RUNS_PANEL_COPY.ERROR_TITLE}>
            <Text>{RUNS_PANEL_COPY.STALE_RESULTS}</Text>
            <Text c="dimmed" size="sm">
              {runsErrorMessage}
            </Text>
          </Alert>
        ) : null}

        {!showInitialRunsLoader && !showInitialRunsError ? (
          <Box pos="relative">
            <LoadingOverlay visible={runsQuery.isFetching && Boolean(runsQuery.data)} zIndex={1} />
            {displayedRuns.length === 0 ? (
              <Alert title={RUNS_PANEL_COPY.TITLE}>{RUNS_PANEL_COPY.EMPTY}</Alert>
            ) : (
              <Table.ScrollContainer minWidth={920}>
                <Table highlightOnHover striped withTableBorder>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Run ID</Table.Th>
                      <Table.Th>Jira key</Table.Th>
                      <Table.Th>Status</Table.Th>
                      <Table.Th>Effective actor</Table.Th>
                      <Table.Th>Updated</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {displayedRuns.map((run) => (
                      <Table.Tr key={run.run_id} onClick={() => setSelectedRunId(run.run_id)} style={{ cursor: "pointer" }}>
                        <Table.Td>{run.run_id}</Table.Td>
                        <Table.Td>{run.jira_key}</Table.Td>
                        <Table.Td>
                          <Badge color={QaaRunStatusColor[run.status]} variant="light">
                            {QaaRunStatusLabel[run.status]}
                          </Badge>
                        </Table.Td>
                        <Table.Td>{run.effective_actor ?? "—"}</Table.Td>
                        <Table.Td>{formatTimestamp(run.updated_at)}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            )}
          </Box>
        ) : null}
      </Stack>

      <Drawer
        onClose={() => setSelectedRunId(null)}
        opened={selectedRunId !== null}
        padding="lg"
        position="right"
        size="xl"
        title={RUNS_PANEL_COPY.DETAIL_TITLE}
      >
        <Stack gap="lg">
          {detailQuery.isLoading ? (
            <Stack align="center" gap="sm" py="xl">
              <Loader size="lg" />
              <Text c="dimmed">Loading run details.</Text>
            </Stack>
          ) : null}

          {detailQuery.data ? (
            <Paper p="md" radius="lg" withBorder>
              <Stack gap="sm">
                <Group justify="space-between">
                  <Title order={4}>{detailQuery.data.jira_key}</Title>
                  <Badge color={QaaRunStatusColor[detailQuery.data.status]} variant="light">
                    {QaaRunStatusLabel[detailQuery.data.status]}
                  </Badge>
                </Group>
                <Text size="sm">Run ID: {detailQuery.data.run_id}</Text>
                <Text size="sm">Actor: {detailQuery.data.effective_actor ?? "—"}</Text>
                <Text size="sm">Created: {formatTimestamp(detailQuery.data.created_at)}</Text>
                <Text size="sm">Updated: {formatTimestamp(detailQuery.data.updated_at)}</Text>
                <Group>
                  <Button leftSection={<IconPlayerPlay size={16} />} onClick={() => openRunInLive(detailQuery.data.run_id)} variant="light">
                    {RUNS_PANEL_COPY.OPEN_IN_LIVE}
                  </Button>
                  {artifactsQuery.data?.pr_url ? (
                    <Button component="a" href={artifactsQuery.data.pr_url} rel="noreferrer" target="_blank" variant="default">
                      {RUNS_PANEL_COPY.PR_LINK}
                    </Button>
                  ) : null}
                </Group>
              </Stack>
            </Paper>
          ) : null}

          {detailQuery.isError ? (
            <Alert color="red" icon={<IconAlertCircle size={18} />} title={RUNS_PANEL_COPY.ERROR_TITLE}>
              <Text>{detailQuery.error instanceof Error ? detailQuery.error.message : RUNS_PANEL_COPY.ERROR_TITLE}</Text>
            </Alert>
          ) : null}

          {artifactsQuery.isLoading ? (
            <Stack align="center" gap="sm" py="xl">
              <Loader size="lg" />
              <Text c="dimmed">Loading artifacts.</Text>
            </Stack>
          ) : null}

          {detailQuery.data && !selectedRunIsTerminal ? (
            <Alert color="blue" title={RUNS_PANEL_COPY.ARTIFACTS_PENDING_TITLE}>
              <Text>{RUNS_PANEL_COPY.ARTIFACTS_PENDING_MESSAGE}</Text>
            </Alert>
          ) : null}

          {artifactsQuery.isError ? (
            <Alert color="red" icon={<IconAlertCircle size={18} />} title="Artifacts request failed">
              <Text>{artifactsQuery.error instanceof Error ? artifactsQuery.error.message : "Artifacts request failed"}</Text>
            </Alert>
          ) : null}

          {artifactsQuery.data ? (
            <Paper p="md" radius="lg" withBorder>
              <Stack gap="sm">
                <Title order={4}>Artifacts</Title>
                <Text size="sm">PR URL: {artifactsQuery.data.pr_url ?? "—"}</Text>
                <Text size="sm">Report</Text>
                <Box
                  bg="rgba(2, 6, 12, 0.95)"
                  c="gray.1"
                  p="md"
                  style={{
                    border: "1px solid rgba(255, 255, 255, 0.08)",
                    borderRadius: "12px",
                    fontFamily: "monospace",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {artifactsQuery.data.report_text ?? "No report text returned."}
                </Box>
              </Stack>
            </Paper>
          ) : null}
        </Stack>
      </Drawer>
    </>
  );
}
