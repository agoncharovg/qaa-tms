import { useEffect, useReducer, useRef, useState } from "react";
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Drawer,
  Group,
  Loader,
  LoadingOverlay,
  NumberInput,
  Paper,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconAlertCircle, IconRefresh, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { agentClient } from "@/api/agentClient";
import type { JobTerminalEvent, KubePod } from "@/api/types";
import {
  DEFAULT_KUBE_LOG_TAIL,
  JobStreamEvent,
  NamespaceLogStatus,
  NamespaceLogStatusLabel,
  OperationStatusColor,
  QueryKey,
  type NamespaceLogStatus as NamespaceLogStatusType,
} from "@/constants";
import { useKuberStore } from "@/plugins/kuber/kuberStore";
import { useAuthStore } from "@/store/authStore";

interface PodsPanelProps {
  agentPort: number;
}

interface PodLogsState {
  exitCode: number | null;
  lines: string[];
  status: NamespaceLogStatusType;
  streamError: string | null;
}

type PodLogsAction =
  | { type: "append-line"; line: string }
  | { type: "reset" }
  | { type: "set-stream-error"; message: string }
  | { type: "start" }
  | { type: "terminal"; terminal: JobTerminalEvent };

const PodsPanelCopy = {
  CONTAINER_LABEL: "Container",
  CONTEXT_LABEL: "Context",
  DELETE_BUTTON: "Delete pod",
  DELETE_ERROR: "Delete pod failed",
  DELETE_HELPER: "Type the pod name before deleting it. This action is sent to kubectl immediately.",
  DELETE_LABEL: "Type pod name to confirm delete",
  DESCRIBE_ACTION: "Describe",
  DESCRIBE_ERROR: "Describe request failed",
  DESCRIBE_HELPER: "Raw output from `kubectl describe pod`, including the Events section.",
  DRAWER_TITLE_PREFIX: "Pod",
  EMPTY_CONTEXTS: "No Kubernetes contexts are available.",
  EMPTY_NAMESPACES: "No namespaces were returned for the selected context.",
  EMPTY_PODS: "No pods were returned for the selected namespace.",
  FOLLOW_LABEL: "Follow",
  LOGS_ERROR: "Log stream failed",
  LOGS_HELPER: "Live logs stream directly from the local agent over authenticated SSE.",
  LOGS_TITLE: "Logs",
  METRICS_NOTE: "Resource usage requires metrics-server. Non-zero exits show raw stderr from kubectl.",
  MISSING_BODY: "Install kubectl or point the companion app at the correct binary to browse pods.",
  MISSING_TITLE: "kubectl is not installed",
  NAMESPACE_LABEL: "Namespace",
  PODS_ERROR: "Pod query failed",
  PODS_REFETCH: "Refresh",
  PODS_SUBTITLE:
    "Choose a context and namespace, inspect pod health, stream logs, fetch raw describe output, and delete a pod behind a confirmation gate.",
  PODS_TITLE: "Pods",
  PREVIOUS_LABEL: "Previous",
  READY_COLUMN: "Ready",
  NAME_COLUMN: "Name",
  PHASE_COLUMN: "Phase",
  RESTARTS_COLUMN: "Restarts",
  NODE_COLUMN: "Node",
  AGE_COLUMN: "Age",
  RESOURCE_ACTION: "Resource usage",
  RESOURCE_ERROR: "Resource usage request failed",
  RESOURCE_HELPER: "Raw output from `kubectl top pods` for the selected namespace.",
  RETRY: "Retry",
  STATUS_IDLE: "Idle",
  TAIL_LABEL: "Tail",
} as const;

const PodsPanelValue = {
  DEFAULT_COLOR: "gray",
  LOG_VIEW_HEIGHT: 280,
  PODS_REFETCH_INTERVAL_MS: 5000,
} as const;

const RelativeAgeUnit = {
  DAY: "d",
  HOUR: "h",
  MINUTE: "m",
  SECOND: "s",
} as const;

function createPodLogsState(): PodLogsState {
  return {
    exitCode: null,
    lines: [],
    status: NamespaceLogStatus.IDLE,
    streamError: null,
  };
}

function reducePodLogsState(state: PodLogsState, action: PodLogsAction): PodLogsState {
  switch (action.type) {
    case "append-line":
      return {
        ...state,
        lines: [...state.lines, action.line],
      };
    case "reset":
      return createPodLogsState();
    case "set-stream-error":
      return {
        ...state,
        status: NamespaceLogStatus.FAILED,
        streamError: action.message,
      };
    case "start":
      return {
        exitCode: null,
        lines: [],
        status: NamespaceLogStatus.RUNNING,
        streamError: null,
      };
    case "terminal":
      return {
        ...state,
        exitCode: action.terminal.exitCode,
        status: action.terminal.status as NamespaceLogStatusType,
        streamError: null,
      };
  }
}

function getNamespaceLogStatusColor(status: NamespaceLogStatusType): string {
  if (status === NamespaceLogStatus.IDLE) {
    return PodsPanelValue.DEFAULT_COLOR;
  }

  return OperationStatusColor[status];
}

function getPhaseColor(phase: string | null): string {
  const normalized = phase?.trim().toLowerCase();
  if (normalized === "running" || normalized === "active") {
    return "teal";
  }
  if (normalized === "pending") {
    return "yellow";
  }
  if (normalized === "failed" || normalized === "error") {
    return "red";
  }
  return PodsPanelValue.DEFAULT_COLOR;
}

function formatRelativeAge(createdAt: string | null): string {
  if (!createdAt) {
    return "n/a";
  }

  const createdAtMs = Date.parse(createdAt);
  if (Number.isNaN(createdAtMs)) {
    return createdAt;
  }

  const diffSeconds = Math.max(0, Math.floor((Date.now() - createdAtMs) / 1000));
  if (diffSeconds >= 86400) {
    return `${Math.floor(diffSeconds / 86400)}${RelativeAgeUnit.DAY}`;
  }
  if (diffSeconds >= 3600) {
    return `${Math.floor(diffSeconds / 3600)}${RelativeAgeUnit.HOUR}`;
  }
  if (diffSeconds >= 60) {
    return `${Math.floor(diffSeconds / 60)}${RelativeAgeUnit.MINUTE}`;
  }
  return `${diffSeconds}${RelativeAgeUnit.SECOND}`;
}

function buildContextOptions(
  contexts: { name: string; current: boolean }[] | undefined
): { label: string; value: string }[] {
  return (contexts ?? []).map((context) => ({
    label: context.current ? `${context.name} (current)` : context.name,
    value: context.name,
  }));
}

function buildNamespaceOptions(
  namespaces: { name: string }[] | undefined
): { label: string; value: string }[] {
  return (namespaces ?? []).map((namespace) => ({
    label: namespace.name,
    value: namespace.name,
  }));
}

export function PodsPanel({ agentPort }: PodsPanelProps) {
  const queryClient = useQueryClient();
  const token = useAuthStore((state) => state.token);
  const selectedContext = useKuberStore((state) => state.selectedContext);
  const selectedNamespace = useKuberStore((state) => state.selectedNamespace);
  const setSelectedContext = useKuberStore((state) => state.setSelectedContext);
  const setSelectedNamespace = useKuberStore((state) => state.setSelectedNamespace);
  const [selectedPod, setSelectedPod] = useState<KubePod | null>(null);
  const [selectedContainer, setSelectedContainer] = useState<string | null>(null);
  const [followLogs, setFollowLogs] = useState(true);
  const [tailCount, setTailCount] = useState<number>(DEFAULT_KUBE_LOG_TAIL);
  const [previousLogs, setPreviousLogs] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [logsState, dispatchLogs] = useReducer(reducePodLogsState, undefined, createPodLogsState);
  const logViewportRef = useRef<HTMLDivElement | null>(null);

  const contextsQuery = useQuery({
    enabled: Boolean(token),
    queryFn: ({ signal }) => agentClient.getKubeContexts(agentPort, token ?? "", signal),
    queryKey: [QueryKey.KUBE_CONTEXTS, agentPort, token],
    refetchOnWindowFocus: false,
    retry: false,
  });

  const activeContext = selectedContext ?? contextsQuery.data?.currentContext ?? null;

  const namespacesQuery = useQuery({
    enabled: Boolean(token && activeContext !== undefined),
    queryFn: ({ signal }) => agentClient.listKubeNamespaces(agentPort, token ?? "", activeContext, signal),
    queryKey: [QueryKey.KUBE_NAMESPACES, agentPort, token, activeContext],
    refetchOnWindowFocus: false,
    retry: false,
  });

  const activeNamespace = selectedNamespace;

  const podsQuery = useQuery({
    enabled: Boolean(token && activeNamespace),
    queryFn: ({ signal }) => agentClient.listKubePods(agentPort, token ?? "", activeContext, activeNamespace ?? "", signal),
    queryKey: [QueryKey.KUBE_PODS, agentPort, token, activeContext, activeNamespace],
    refetchInterval: PodsPanelValue.PODS_REFETCH_INTERVAL_MS,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const describeMutation = useMutation({
    mutationFn: async () => {
      if (!token || !selectedPod || !activeNamespace) {
        throw new Error(PodsPanelCopy.DESCRIBE_ERROR);
      }
      return agentClient.describeKubePod(
        agentPort,
        token,
        selectedPod.name,
        activeContext,
        activeNamespace
      );
    },
  });

  const topMutation = useMutation({
    mutationFn: async () => {
      if (!token || !activeNamespace) {
        throw new Error(PodsPanelCopy.RESOURCE_ERROR);
      }
      return agentClient.getKubeTop(agentPort, token, activeContext, activeNamespace);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!token || !selectedPod || !activeNamespace) {
        throw new Error(PodsPanelCopy.DELETE_ERROR);
      }
      return agentClient.deleteKubePod(
        agentPort,
        token,
        selectedPod.name,
        {
          context: activeContext,
          namespace: activeNamespace,
        }
      );
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({
        queryKey: [QueryKey.KUBE_PODS, agentPort, token, activeContext, activeNamespace],
      });
      if (result.exitCode === 0) {
        setSelectedPod(null);
      }
    },
  });

  async function handleRefresh(): Promise<void> {
    setIsRefreshing(true);

    try {
      await Promise.all([
        contextsQuery.refetch(),
        namespacesQuery.refetch(),
        podsQuery.refetch(),
      ]);
    } finally {
      setIsRefreshing(false);
    }
  }

  useEffect(() => {
    if (!contextsQuery.data?.contexts.length) {
      return;
    }

    const availableContextNames = new Set(contextsQuery.data.contexts.map((context) => context.name));
    if (selectedContext && availableContextNames.has(selectedContext)) {
      return;
    }

    const fallbackContext = contextsQuery.data.currentContext ?? contextsQuery.data.contexts[0]?.name ?? null;
    if (fallbackContext !== selectedContext) {
      setSelectedContext(fallbackContext);
    }
  }, [contextsQuery.data, selectedContext, setSelectedContext]);

  useEffect(() => {
    if (!namespacesQuery.data?.namespaces.length) {
      return;
    }

    const availableNamespaces = new Set(namespacesQuery.data.namespaces.map((namespace) => namespace.name));
    if (selectedNamespace && availableNamespaces.has(selectedNamespace)) {
      return;
    }

    const preferredNamespace =
      contextsQuery.data?.contexts.find((context) => context.name === activeContext)?.namespace ?? null;
    const fallbackNamespace = availableNamespaces.has(preferredNamespace ?? "")
      ? preferredNamespace
      : namespacesQuery.data.namespaces[0]?.name ?? null;
    if (fallbackNamespace !== selectedNamespace) {
      setSelectedNamespace(fallbackNamespace);
    }
  }, [activeContext, contextsQuery.data, namespacesQuery.data, selectedNamespace, setSelectedNamespace]);

  useEffect(() => {
    if (!selectedPod) {
      setSelectedContainer(null);
      setDeleteConfirmation("");
      dispatchLogs({ type: "reset" });
      return;
    }

    const defaultContainer = selectedPod.containers[0] ?? null;
    setSelectedContainer((currentContainer) =>
      currentContainer && selectedPod.containers.includes(currentContainer)
        ? currentContainer
        : defaultContainer
    );
    setDeleteConfirmation("");
    dispatchLogs({ type: "reset" });
  }, [selectedPod]);

  useEffect(() => {
    if (!token || !selectedPod || !activeNamespace) {
      return;
    }

    const controller = new AbortController();
    dispatchLogs({ type: "start" });

    void agentClient
      .streamKubePodLogs(
        agentPort,
        token,
        selectedPod.name,
        {
          context: activeContext,
          namespace: activeNamespace,
          container: selectedContainer,
          follow: followLogs,
          tail: tailCount,
          previous: previousLogs,
        },
        (message) => {
          if (message.event === JobStreamEvent.LOG) {
            dispatchLogs({
              type: "append-line",
              line: message.data.line,
            });
            return;
          }

          dispatchLogs({
            type: "terminal",
            terminal: message.data,
          });
        },
        controller.signal
      )
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        dispatchLogs({
          type: "set-stream-error",
          message: error instanceof Error ? error.message : PodsPanelCopy.LOGS_ERROR,
        });
      });

    return () => {
      controller.abort();
    };
  }, [
    activeContext,
    activeNamespace,
    agentPort,
    followLogs,
    previousLogs,
    selectedContainer,
    selectedPod,
    tailCount,
    token,
  ]);

  useEffect(() => {
    if (logViewportRef.current) {
      logViewportRef.current.scrollTop = logViewportRef.current.scrollHeight;
    }
  }, [logsState.lines.length]);

  if (contextsQuery.isLoading) {
    return (
      <Stack align="center" gap="md" py="xl">
        <Loader size="lg" />
        <Text c="dimmed">{PodsPanelCopy.PODS_SUBTITLE}</Text>
      </Stack>
    );
  }

  if (contextsQuery.isError) {
    if (contextsQuery.error instanceof Error && contextsQuery.error.message === "kubectl is not installed.") {
      return (
        <Paper p="xl" radius="lg" withBorder>
          <Stack gap="sm">
            <Title order={3}>{PodsPanelCopy.MISSING_TITLE}</Title>
            <Text c="dimmed">{PodsPanelCopy.MISSING_BODY}</Text>
            <Group>
              <Button leftSection={<IconRefresh size={16} />} onClick={() => void contextsQuery.refetch()}>
                {PodsPanelCopy.RETRY}
              </Button>
            </Group>
          </Stack>
        </Paper>
      );
    }

    return (
      <Alert color="red" icon={<IconAlertCircle size={18} />} title={PodsPanelCopy.PODS_ERROR}>
        <Text>
          {contextsQuery.error instanceof Error ? contextsQuery.error.message : PodsPanelCopy.PODS_ERROR}
        </Text>
      </Alert>
    );
  }

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <div>
          <Title order={3}>{PodsPanelCopy.PODS_TITLE}</Title>
          <Text c="dimmed" size="sm">
            {PodsPanelCopy.PODS_SUBTITLE}
          </Text>
        </div>
        <Button
          disabled={isRefreshing}
          leftSection={<IconRefresh size={16} />}
          loading={isRefreshing}
          onClick={() => void handleRefresh()}
          variant="light"
        >
          {PodsPanelCopy.PODS_REFETCH}
        </Button>
      </Group>

      <Group align="flex-end" grow>
        <Select
          data={buildContextOptions(contextsQuery.data?.contexts)}
          label={PodsPanelCopy.CONTEXT_LABEL}
          onChange={(value) => {
            setSelectedContext(value);
            setSelectedNamespace(null);
            setSelectedPod(null);
          }}
          value={activeContext}
        />
        <Select
          data={buildNamespaceOptions(namespacesQuery.data?.namespaces)}
          label={PodsPanelCopy.NAMESPACE_LABEL}
          onChange={(value) => {
            setSelectedNamespace(value);
            setSelectedPod(null);
          }}
          value={activeNamespace}
        />
      </Group>

      {namespacesQuery.isError ? (
        <Alert color="red" icon={<IconAlertCircle size={18} />} title={PodsPanelCopy.PODS_ERROR}>
          <Text>
            {namespacesQuery.error instanceof Error
              ? namespacesQuery.error.message
              : PodsPanelCopy.PODS_ERROR}
          </Text>
        </Alert>
      ) : null}

      {podsQuery.isError ? (
        <Alert color="red" icon={<IconAlertCircle size={18} />} title={PodsPanelCopy.PODS_ERROR}>
          <Text>{podsQuery.error instanceof Error ? podsQuery.error.message : PodsPanelCopy.PODS_ERROR}</Text>
        </Alert>
      ) : null}

      {namespacesQuery.isLoading || (activeNamespace && podsQuery.isLoading) ? (
        <Stack align="center" gap="md" py="xl">
          <Loader size="lg" />
          <Text c="dimmed">Loading Kubernetes resources from the local agent.</Text>
        </Stack>
      ) : !contextsQuery.data?.contexts.length ? (
        <Paper p="xl" radius="lg" withBorder>
          <Text c="dimmed">{PodsPanelCopy.EMPTY_CONTEXTS}</Text>
        </Paper>
      ) : !namespacesQuery.data?.namespaces.length ? (
        <Paper p="xl" radius="lg" withBorder>
          <Text c="dimmed">{PodsPanelCopy.EMPTY_NAMESPACES}</Text>
        </Paper>
      ) : !podsQuery.data?.pods.length ? (
        <Paper p="xl" radius="lg" withBorder>
          <Text c="dimmed">{PodsPanelCopy.EMPTY_PODS}</Text>
        </Paper>
      ) : (
        <Box pos="relative">
          <LoadingOverlay visible={isRefreshing} zIndex={1} />
          <Table.ScrollContainer minWidth={900}>
            <Table highlightOnHover striped withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{PodsPanelCopy.NAME_COLUMN}</Table.Th>
                  <Table.Th>{PodsPanelCopy.READY_COLUMN}</Table.Th>
                  <Table.Th>{PodsPanelCopy.PHASE_COLUMN}</Table.Th>
                  <Table.Th>{PodsPanelCopy.RESTARTS_COLUMN}</Table.Th>
                  <Table.Th>{PodsPanelCopy.NODE_COLUMN}</Table.Th>
                  <Table.Th>{PodsPanelCopy.AGE_COLUMN}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {podsQuery.data.pods.map((pod) => (
                  <Table.Tr
                    key={pod.name}
                    onClick={() => setSelectedPod(pod)}
                    style={{ cursor: "pointer" }}
                  >
                    <Table.Td>{pod.name}</Table.Td>
                    <Table.Td>{pod.ready}</Table.Td>
                    <Table.Td>
                      <Badge color={getPhaseColor(pod.phase)} variant="light">
                        {pod.phase ?? "Unknown"}
                      </Badge>
                    </Table.Td>
                    <Table.Td>{pod.restarts}</Table.Td>
                    <Table.Td>{pod.node ?? "n/a"}</Table.Td>
                    <Table.Td>{formatRelativeAge(pod.createdAt)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Box>
      )}

      <Drawer
        onClose={() => setSelectedPod(null)}
        opened={Boolean(selectedPod)}
        padding="lg"
        position="right"
        size="xl"
        title={selectedPod ? `${PodsPanelCopy.DRAWER_TITLE_PREFIX} ${selectedPod.name}` : PodsPanelCopy.DRAWER_TITLE_PREFIX}
      >
        {selectedPod ? (
          <Stack gap="lg">
            <Card padding="lg" radius="lg" withBorder>
              <Stack gap="md">
                <Group justify="space-between">
                  <div>
                    <Text fw={600}>{PodsPanelCopy.LOGS_TITLE}</Text>
                    <Text c="dimmed" size="sm">
                      {PodsPanelCopy.LOGS_HELPER}
                    </Text>
                  </div>
                  <Badge color={getNamespaceLogStatusColor(logsState.status)} variant="light">
                    {logsState.status === NamespaceLogStatus.IDLE
                      ? PodsPanelCopy.STATUS_IDLE
                      : NamespaceLogStatusLabel[logsState.status]}
                  </Badge>
                </Group>

                <Group align="flex-end" grow>
                  <Select
                    data={selectedPod.containers.map((container) => ({ label: container, value: container }))}
                    label={PodsPanelCopy.CONTAINER_LABEL}
                    onChange={setSelectedContainer}
                    value={selectedContainer}
                  />
                  <NumberInput
                    label={PodsPanelCopy.TAIL_LABEL}
                    min={0}
                    onChange={(value) => setTailCount(typeof value === "number" ? value : DEFAULT_KUBE_LOG_TAIL)}
                    value={tailCount}
                  />
                </Group>

                <Group>
                  <Switch checked={followLogs} label={PodsPanelCopy.FOLLOW_LABEL} onChange={(event) => setFollowLogs(event.currentTarget.checked)} />
                  <Switch
                    checked={previousLogs}
                    label={PodsPanelCopy.PREVIOUS_LABEL}
                    onChange={(event) => setPreviousLogs(event.currentTarget.checked)}
                  />
                </Group>

                {logsState.streamError ? (
                  <Alert color="red" icon={<IconAlertCircle size={18} />} title={PodsPanelCopy.LOGS_ERROR}>
                    <Text>{logsState.streamError}</Text>
                  </Alert>
                ) : null}

                <Box
                  aria-label="Pod logs output"
                  bg="rgba(2, 6, 12, 0.95)"
                  c="gray.1"
                  h={PodsPanelValue.LOG_VIEW_HEIGHT}
                  p="sm"
                  ref={logViewportRef}
                  style={{
                    borderRadius: "12px",
                    fontFamily: "monospace",
                    overflowY: "auto",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {logsState.lines.length > 0 ? logsState.lines.join("\n") : "Waiting for agent output..."}
                </Box>
              </Stack>
            </Card>

            <Card padding="lg" radius="lg" withBorder>
              <Stack gap="md">
                <Group justify="space-between">
                  <div>
                    <Text fw={600}>{PodsPanelCopy.DESCRIBE_ACTION}</Text>
                    <Text c="dimmed" size="sm">
                      {PodsPanelCopy.DESCRIBE_HELPER}
                    </Text>
                  </div>
                  <Button loading={describeMutation.isPending} onClick={() => describeMutation.mutate()} variant="light">
                    {PodsPanelCopy.DESCRIBE_ACTION}
                  </Button>
                </Group>

                {describeMutation.isError ? (
                  <Alert color="red" icon={<IconAlertCircle size={18} />} title={PodsPanelCopy.DESCRIBE_ERROR}>
                    <Text>
                      {describeMutation.error instanceof Error
                        ? describeMutation.error.message
                        : PodsPanelCopy.DESCRIBE_ERROR}
                    </Text>
                  </Alert>
                ) : null}

                {describeMutation.data ? (
                  <>
                    <Badge color={describeMutation.data.exitCode === 0 ? "teal" : "yellow"} variant="light">
                      Exit code: {describeMutation.data.exitCode}
                    </Badge>
                    <Box
                      bg="rgba(2, 6, 12, 0.95)"
                      c="gray.1"
                      p="sm"
                      style={{
                        borderRadius: "12px",
                        fontFamily: "monospace",
                        overflowX: "auto",
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {describeMutation.data.raw}
                    </Box>
                  </>
                ) : null}
              </Stack>
            </Card>

            <Card padding="lg" radius="lg" withBorder>
              <Stack gap="md">
                <Group justify="space-between">
                  <div>
                    <Text fw={600}>{PodsPanelCopy.RESOURCE_ACTION}</Text>
                    <Text c="dimmed" size="sm">
                      {PodsPanelCopy.RESOURCE_HELPER}
                    </Text>
                  </div>
                  <Button loading={topMutation.isPending} onClick={() => topMutation.mutate()} variant="light">
                    {PodsPanelCopy.RESOURCE_ACTION}
                  </Button>
                </Group>
                <Text c="dimmed" size="sm">
                  {PodsPanelCopy.METRICS_NOTE}
                </Text>

                {topMutation.isError ? (
                  <Alert color="red" icon={<IconAlertCircle size={18} />} title={PodsPanelCopy.RESOURCE_ERROR}>
                    <Text>
                      {topMutation.error instanceof Error
                        ? topMutation.error.message
                        : PodsPanelCopy.RESOURCE_ERROR}
                    </Text>
                  </Alert>
                ) : null}

                {topMutation.data ? (
                  <>
                    <Badge color={topMutation.data.exitCode === 0 ? "teal" : "yellow"} variant="light">
                      Exit code: {topMutation.data.exitCode}
                    </Badge>
                    <Box
                      bg="rgba(2, 6, 12, 0.95)"
                      c="gray.1"
                      p="sm"
                      style={{
                        borderRadius: "12px",
                        fontFamily: "monospace",
                        overflowX: "auto",
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {topMutation.data.raw}
                    </Box>
                  </>
                ) : null}
              </Stack>
            </Card>

            <Card padding="lg" radius="lg" withBorder>
              <Stack gap="md">
                <div>
                  <Text fw={600}>{PodsPanelCopy.DELETE_BUTTON}</Text>
                  <Text c="dimmed" size="sm">
                    {PodsPanelCopy.DELETE_HELPER}
                  </Text>
                </div>

                <TextInput
                  description={PodsPanelCopy.DELETE_HELPER}
                  label={PodsPanelCopy.DELETE_LABEL}
                  onChange={(event) => setDeleteConfirmation(event.currentTarget.value)}
                  placeholder={selectedPod.name}
                  value={deleteConfirmation}
                />

                {deleteMutation.isError ? (
                  <Alert color="red" icon={<IconAlertCircle size={18} />} title={PodsPanelCopy.DELETE_ERROR}>
                    <Text>
                      {deleteMutation.error instanceof Error
                        ? deleteMutation.error.message
                        : PodsPanelCopy.DELETE_ERROR}
                    </Text>
                  </Alert>
                ) : null}

                <Group justify="flex-end">
                  <Button
                    color="red"
                    disabled={deleteConfirmation.trim() !== selectedPod.name}
                    leftSection={<IconTrash size={16} />}
                    loading={deleteMutation.isPending}
                    onClick={() => deleteMutation.mutate()}
                  >
                    {PodsPanelCopy.DELETE_BUTTON}
                  </Button>
                </Group>
              </Stack>
            </Card>
          </Stack>
        ) : null}
      </Drawer>
    </Stack>
  );
}
