import { useEffect, useReducer, useState } from "react";
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Drawer,
  Group,
  Loader,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconEye,
  IconEyeOff,
  IconKey,
  IconPlayerPlay,
  IconPlayerStop,
  IconPlugConnectedX,
  IconRotateClockwise,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { agentClient, getPreflight } from "@/api/agentClient";
import { backendClient } from "@/api/backendClient";
import type { JobTerminalEvent, NamespaceListEntry, NamespaceLogsState, OperationSummary } from "@/api/types";
import {
  NamespaceLogStatus,
  NamespaceLogStatusLabel,
  NamespaceOrigin,
  NamespaceOriginLabel,
  OperationType,
  QueryKey,
  SectionKey,
  TabId,
  type NamespaceLogStatus as NamespaceLogStatusType,
} from "@/constants";
import { createDeployDraftFromReplay } from "@/features/stagings/deployDraft";
import { LiveJobPanel } from "@/features/stagings/LiveJobPanel";
import { useTransientLiveJob } from "@/features/stagings/useTransientLiveJob";
import { useAuthStore } from "@/store/authStore";
import { useStagingsStore } from "@/store/stagingsStore";
import { useUiStore } from "@/store/uiStore";

type NamespaceLogsAction =
  | { type: "append-line"; line: string }
  | { type: "reset" }
  | { type: "set-aborted" }
  | { type: "set-deploy"; deploy: string }
  | { type: "set-stream-error"; message: string }
  | { type: "start" }
  | { type: "terminal"; terminal: JobTerminalEvent };

function createNamespaceLogsState(): NamespaceLogsState {
  return {
    deploy: "",
    exitCode: null,
    lines: [],
    status: NamespaceLogStatus.IDLE,
    streamError: null,
  };
}

function reduceNamespaceLogsState(
  state: NamespaceLogsState,
  action: NamespaceLogsAction
): NamespaceLogsState {
  switch (action.type) {
    case "append-line":
      return {
        ...state,
        lines: [...state.lines, action.line],
      };
    case "reset":
      return createNamespaceLogsState();
    case "set-aborted":
      return {
        ...state,
        exitCode: null,
        status: NamespaceLogStatus.ABORTED,
        streamError: null,
      };
    case "set-deploy":
      return {
        ...state,
        deploy: action.deploy,
      };
    case "set-stream-error":
      return {
        ...state,
        status: NamespaceLogStatus.FAILED,
        streamError: action.message,
      };
    case "start":
      return {
        deploy: state.deploy.trim(),
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
  switch (status) {
    case NamespaceLogStatus.SUCCESS:
      return "teal";
    case NamespaceLogStatus.FAILED:
      return "red";
    case NamespaceLogStatus.ABORTED:
      return "yellow";
    case NamespaceLogStatus.RUNNING:
      return "blue";
    default:
      return "gray";
  }
}

function getClusterStatusColor(status: string): string {
  const normalized = status.trim().toLowerCase();
  if (normalized === "active" || normalized === "running") {
    return "teal";
  }
  if (normalized === "pending") {
    return "yellow";
  }
  if (normalized === "failed" || normalized === "error") {
    return "red";
  }
  return "gray";
}

function maskSensitiveText(raw: string): string {
  return raw.replace(/[^\s]/g, "*");
}

function mapClusterEntries(entries: { name: string; status: string; createdAt: string | null }[]): NamespaceListEntry[] {
  return entries.map((entry) => ({
    createdAt: entry.createdAt,
    name: entry.name,
    origin: NamespaceOrigin.CLUSTER,
    statusLabel: entry.status,
  }));
}

function mapLocalOverlayEntries(entries: { name: string }[]): NamespaceListEntry[] {
  return entries.map((entry) => ({
    name: entry.name,
    origin: NamespaceOrigin.LOCAL,
    statusLabel: NamespaceOriginLabel[NamespaceOrigin.LOCAL],
  }));
}


function createClusterRedeployDraft(replay: Pick<OperationSummary, "ns" | "recipe">) {
  const draft = createDeployDraftFromReplay(replay);
  draft.flags.clean = false;
  draft.flags.full = false;
  draft.flags.dryRun = false;
  draft.flags.noSync = false;
  draft.flags.stageText = "";
  return draft;
}

export function NamespacesPanel() {
  const queryClient = useQueryClient();
  const token = useAuthStore((state) => state.token);
  const prefillDeployDraft = useStagingsStore((state) => state.prefillDeployDraft);
  const setDeployDraft = useStagingsStore((state) => state.setDeployDraft);
  const setSelectedOperationId = useStagingsStore((state) => state.setSelectedOperationId);
  const openTab = useUiStore((state) => state.openTab);
  const switchTab = useUiStore((state) => state.switchTab);
  const deployOpen = useUiStore((state) =>
    state.tabsBySection[SectionKey.STAGINGS].tabIds.includes(TabId.STAGINGS_DEPLOY)
  );
  const historyOpen = useUiStore((state) =>
    state.tabsBySection[SectionKey.STAGINGS].tabIds.includes(TabId.STAGINGS_HISTORY)
  );
  const [selectedNamespace, setSelectedNamespace] = useState<string | null>(null);
  const [selectedOrigin, setSelectedOrigin] = useState<NamespaceListEntry["origin"] | null>(null);
  const [credsVisible, setCredsVisible] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [destroyConfirmation, setDestroyConfirmation] = useState("");
  const [logsState, dispatchLogs] = useReducer(
    reduceNamespaceLogsState,
    undefined,
    createNamespaceLogsState
  );
  const [logsAbortController, setLogsAbortController] = useState<AbortController | null>(null);

  const preflightQuery = useQuery({
    enabled: Boolean(token),
    queryFn: ({ signal }) => getPreflight(token ?? "", signal),
    queryKey: [QueryKey.AGENT_PREFLIGHT, token],
    refetchOnWindowFocus: false,
    retry: false,
  });

  const agentPort = preflightQuery.data?.detected ? preflightQuery.data.port : null;
  const probedPorts =
    preflightQuery.data && !preflightQuery.data.detected ? preflightQuery.data.ports.join(", ") : "";
  const companionUnavailable = !preflightQuery.data?.detected;
  const logsRunning = logsState.status === NamespaceLogStatus.RUNNING;
  const transientJob = useTransientLiveJob(agentPort, token);

  const namespacesQuery = useQuery({
    enabled: Boolean(token && agentPort !== null),
    queryFn: ({ signal }) => agentClient.listNamespaces(agentPort ?? 0, token ?? "", signal),
    queryKey: [QueryKey.AGENT_NAMESPACES, token, agentPort],
    refetchOnWindowFocus: false,
    retry: false,
  });

  const statusQuery = useQuery({
    enabled: Boolean(token && agentPort !== null && selectedNamespace),
    queryFn: ({ signal }) =>
      agentClient.getNamespaceStatus(agentPort ?? 0, token ?? "", selectedNamespace ?? "", signal),
    queryKey: [QueryKey.AGENT_NAMESPACE_STATUS, token, agentPort, selectedNamespace],
    refetchOnWindowFocus: false,
    retry: false,
  });

  const credsQuery = useQuery({
    enabled: false,
    gcTime: 0,
    queryFn: ({ signal }) => {
      if (!token || agentPort === null || !selectedNamespace) {
        throw new Error("No namespace is selected.");
      }

      return agentClient.getNamespaceCreds(agentPort, token, selectedNamespace, signal);
    },
    queryKey: [QueryKey.AGENT_NAMESPACE_CREDS, token, agentPort, selectedNamespace],
    refetchOnWindowFocus: false,
    retry: false,
  });

  const destroyMutation = useMutation({
    mutationFn: async () => {
      if (!token || agentPort === null || !selectedNamespace) {
        throw new Error("No namespace is selected.");
      }

      return agentClient.destroy(agentPort, token, { ns: selectedNamespace });
    },
    onSuccess: (response) => {
      transientJob.startLiveJob(response.jobId, response.opId);
      setSelectedOperationId(null);
      setDestroyConfirmation("");
    },
  });

  const adoptMutation = useMutation({
    mutationFn: async () => {
      if (!token || agentPort === null || !selectedNamespace) {
        throw new Error("No namespace is selected.");
      }

      return agentClient.adopt(agentPort, token, { ns: selectedNamespace });
    },
    onSuccess: (response) => {
      transientJob.startLiveJob(response.jobId, response.opId);
      setSelectedOperationId(null);
    },
  });

  async function loadLatestDeployReplay(namespace: string): Promise<Pick<OperationSummary, "ns" | "recipe">> {
    if (!token) {
      throw new Error("You must be logged in to load deploy history.");
    }

    const response = await backendClient.listOperations(token, {
      limit: 1,
      ns: namespace,
      offset: 0,
      type: OperationType.DEPLOY,
    });
    const latestDeploy = response.items[0];

    if (!latestDeploy || latestDeploy.type !== OperationType.DEPLOY || !latestDeploy.ns) {
      throw new Error(`No recorded deploy recipe was found for ${namespace}.`);
    }

    return {
      ns: latestDeploy.ns,
      recipe: latestDeploy.recipe,
    };
  }

  async function loadLocalOverlayDeployRecipe(
    namespace: string
  ): Promise<Pick<OperationSummary, "ns" | "recipe">> {
    if (!token || agentPort === null) {
      throw new Error("The agent must be connected to load a local deploy recipe.");
    }

    const response = await agentClient.getNamespaceDeployRecipe(agentPort, token, namespace);
    return {
      ns: response.ns,
      recipe: {
        product: response.recipe.product,
        services: response.recipe.services,
        images: response.recipe.images,
        suites: response.recipe.suites,
        flags: { ...response.recipe.flags },
      },
    };
  }

  function openDeployWithDraft(mode: NamespaceListEntry["origin"], replay: Pick<OperationSummary, "ns" | "recipe">): void {
    if (mode === NamespaceOrigin.CLUSTER) {
      setDeployDraft(createClusterRedeployDraft(replay));
    } else {
      prefillDeployDraft(replay);
    }

    setSelectedOperationId(null);
    if (deployOpen) {
      switchTab(SectionKey.STAGINGS, TabId.STAGINGS_DEPLOY);
      return;
    }

    openTab(SectionKey.STAGINGS, TabId.STAGINGS_DEPLOY);
  }

  const prepareRedeployMutation = useMutation({
    mutationFn: async (origin: NamespaceListEntry["origin"]) => {
      if (!selectedNamespace) {
        throw new Error("No namespace is selected.");
      }

      const replay =
        origin === NamespaceOrigin.CLUSTER
          ? await loadLatestDeployReplay(selectedNamespace)
          : await loadLocalOverlayDeployRecipe(selectedNamespace);
      return {
        origin,
        replay,
      };
    },
    onSuccess: ({ origin, replay }) => {
      openDeployWithDraft(origin, replay);
    },
  });

  const clusterEntries = mapClusterEntries(namespacesQuery.data?.clusterNamespaces ?? []);
  const localEntries = mapLocalOverlayEntries(namespacesQuery.data?.localOverlays ?? []);
  const listRaw = namespacesQuery.data?.raw ?? "";
  const listExitCode = namespacesQuery.data?.exitCode ?? null;
  const maskedCreds = credsQuery.data ? maskSensitiveText(credsQuery.data.raw) : "";

  useEffect(() => {
    return () => {
      logsAbortController?.abort();
    };
  }, [logsAbortController]);

  function clearSensitiveState(namespaceToClear: string | null): void {
    if (!namespaceToClear) {
      return;
    }

    queryClient.removeQueries({
      queryKey: [QueryKey.AGENT_NAMESPACE_CREDS, token, agentPort, namespaceToClear],
    });
  }

  function stopLogs(markAborted: boolean): void {
    logsAbortController?.abort();
    setLogsAbortController(null);
    if (markAborted && logsRunning) {
      dispatchLogs({ type: "set-aborted" });
    }
  }

  function selectNamespace(entry: NamespaceListEntry): void {
    stopLogs(true);
    clearSensitiveState(selectedNamespace);
    transientJob.clearLiveJob();
    setSelectedNamespace(entry.name);
    setSelectedOrigin(entry.origin);
    setCredsVisible(false);
    setCopyFeedback(null);
    setDestroyConfirmation("");
    dispatchLogs({ type: "reset" });
  }

  function closeNamespaceDrawer(): void {
    stopLogs(true);
    clearSensitiveState(selectedNamespace);
    transientJob.clearLiveJob();
    setSelectedNamespace(null);
    setSelectedOrigin(null);
    setCredsVisible(false);
    setCopyFeedback(null);
    setDestroyConfirmation("");
    dispatchLogs({ type: "reset" });
  }

  async function copyCreds(raw: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(raw);
      setCopyFeedback("Credentials copied locally.");
    } catch {
      setCopyFeedback("Clipboard copy failed.");
    }
  }

  function startLogs(): void {
    if (!token || agentPort === null || !selectedNamespace) {
      return;
    }

    const deploy = logsState.deploy.trim();
    if (!deploy) {
      return;
    }

    stopLogs(false);
    dispatchLogs({ type: "start" });

    const controller = new AbortController();
    setLogsAbortController(controller);

    void agentClient
      .streamNamespaceLogs(
        agentPort,
        token,
        selectedNamespace,
        deploy,
        (message) => {
          if (message.event === "log") {
            dispatchLogs({
              line: message.data.line,
              type: "append-line",
            });
            return;
          }

          dispatchLogs({
            terminal: message.data,
            type: "terminal",
          });
        },
        controller.signal
      )
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        dispatchLogs({
          message: error instanceof Error ? error.message : "Live log stream failed.",
          type: "set-stream-error",
        });
      })
      .finally(() => {
        setLogsAbortController((currentController) =>
          currentController === controller ? null : currentController
        );
      });
  }

  function openHistoryForLiveJob(): void {
    if (!transientJob.liveJob) {
      return;
    }

    setSelectedOperationId(transientJob.liveJob.opId);
    if (historyOpen) {
      switchTab(SectionKey.STAGINGS, TabId.STAGINGS_HISTORY);
      return;
    }

    openTab(SectionKey.STAGINGS, TabId.STAGINGS_HISTORY);
  }

  if (preflightQuery.isLoading) {
    return (
      <Stack align="center" gap="md" py="xl">
        <Loader size="lg" />
        <Text c="dimmed">Checking the local companion app before loading namespaces.</Text>
      </Stack>
    );
  }

  if (preflightQuery.isError) {
    return (
      <Alert color="red" icon={<IconAlertCircle size={18} />} title="Namespaces request failed">
        <Stack gap="sm">
          <Text>
            {preflightQuery.error instanceof Error
              ? preflightQuery.error.message
              : "Unable to reach the companion app."}
          </Text>
          <Group>
            <Button leftSection={<IconRotateClockwise size={16} />} onClick={() => void preflightQuery.refetch()}>
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
            <Title order={3}>Namespaces</Title>
            <Text c="dimmed" size="sm">
              The parsed view now keeps cluster namespaces and local overlay directories separate. The raw CLI output remains the source of truth.
            </Text>
          </div>
          <Button
            disabled={companionUnavailable || namespacesQuery.isFetching}
            leftSection={<IconRotateClockwise size={16} />}
            onClick={() => void namespacesQuery.refetch()}
            variant="light"
          >
            Refresh namespaces
          </Button>
        </Group>

        {companionUnavailable ? (
          <Alert color="yellow" icon={<IconPlugConnectedX size={18} />} title="Companion app is not running">
            <Stack gap="sm">
              <Text>Start the local companion app, then retry discovery before opening namespace details.</Text>
              <Text c="dimmed" size="sm">
                Probed ports: {probedPorts}
              </Text>
              <Group>
                <Button
                  leftSection={<IconRotateClockwise size={16} />}
                  onClick={() => void preflightQuery.refetch()}
                  variant="light"
                >
                  Retry
                </Button>
              </Group>
            </Stack>
          </Alert>
        ) : namespacesQuery.isLoading ? (
          <Stack align="center" gap="md" py="xl">
            <Loader size="lg" />
            <Text c="dimmed">Loading namespaces from the companion app.</Text>
          </Stack>
        ) : namespacesQuery.isError ? (
          <Alert color="red" icon={<IconAlertCircle size={18} />} title="Namespace list failed">
            <Stack gap="sm">
              <Text>
                {namespacesQuery.error instanceof Error
                  ? namespacesQuery.error.message
                  : "Unable to load the namespace list."}
              </Text>
              <Group>
                <Button leftSection={<IconRotateClockwise size={16} />} onClick={() => void namespacesQuery.refetch()}>
                  Retry
                </Button>
              </Group>
            </Stack>
          </Alert>
        ) : (
          <SimpleGrid cols={{ base: 1, md: 3 }}>
            <Card padding="lg" radius="lg" withBorder>
              <Stack gap="md">
                <Group justify="space-between">
                  <div>
                    <Text fw={600}>Cluster namespaces</Text>
                    <Text c="dimmed" size="sm">
                      Provisioned namespaces returned from the cluster section of `staging list`.
                    </Text>
                  </div>
                  <Badge color={listExitCode === 0 ? "teal" : "yellow"} variant="light">
                    Exit code: {listExitCode ?? "n/a"}
                  </Badge>
                </Group>

                {clusterEntries.length === 0 ? (
                  <Paper p="lg" radius="md" withBorder>
                    <Text c="dimmed" ta="center">
                      No cluster namespaces were parsed.
                    </Text>
                  </Paper>
                ) : (
                  <Stack gap="sm">
                    {clusterEntries.map((entry) => (
                      <Button fullWidth key={entry.name} onClick={() => selectNamespace(entry)} variant="light">
                        <Group justify="space-between" w="100%" wrap="nowrap">
                          <div>
                            <Text fw={600}>{entry.name}</Text>
                            <Text c="dimmed" size="xs">
                              {entry.createdAt ?? "No creation timestamp returned"}
                            </Text>
                          </div>
                          <Badge color={getClusterStatusColor(entry.statusLabel)} variant="light">
                            {entry.statusLabel}
                          </Badge>
                        </Group>
                      </Button>
                    ))}
                  </Stack>
                )}
              </Stack>
            </Card>

            <Card padding="lg" radius="lg" withBorder>
              <Stack gap="md">
                <div>
                  <Text fw={600}>Local overlays</Text>
                  <Text c="dimmed" size="sm">
                    Overlay directories that exist locally but are not listed as provisioned namespaces.
                  </Text>
                </div>

                {localEntries.length === 0 ? (
                  <Paper p="lg" radius="md" withBorder>
                    <Text c="dimmed" ta="center">
                      No local overlays were parsed.
                    </Text>
                  </Paper>
                ) : (
                  <Stack gap="sm">
                    {localEntries.map((entry) => (
                      <Button fullWidth key={entry.name} onClick={() => selectNamespace(entry)} variant="light">
                        <Group justify="space-between" w="100%" wrap="nowrap">
                          <Text fw={600}>{entry.name}</Text>
                          <Badge color="grape" variant="light">
                            {entry.statusLabel}
                          </Badge>
                        </Group>
                      </Button>
                    ))}
                  </Stack>
                )}
              </Stack>
            </Card>

            <Card padding="lg" radius="lg" withBorder>
              <Stack gap="md">
                <Group justify="space-between">
                  <div>
                    <Text fw={600}>CLI output</Text>
                    <Text c="dimmed" size="sm">
                      Plain-text output returned verbatim from `staging list`.
                    </Text>
                  </div>
                  <Badge color={listExitCode === 0 ? "teal" : "yellow"} variant="light">
                    Exit code: {listExitCode ?? "n/a"}
                  </Badge>
                </Group>
                <Box
                  bg="rgba(2, 6, 12, 0.95)"
                  c="gray.1"
                  h={280}
                  p="sm"
                  style={{
                    borderRadius: "12px",
                    fontFamily: "monospace",
                    overflowY: "auto",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {listRaw || "No output returned."}
                </Box>
              </Stack>
            </Card>
          </SimpleGrid>
        )}
      </Stack>

      <Drawer
        onClose={closeNamespaceDrawer}
        opened={Boolean(selectedNamespace)}
        padding="lg"
        position="right"
        size="xl"
        title={selectedNamespace ? `Namespace ${selectedNamespace}` : "Namespace"}
      >
        <Stack gap="lg">
          <Group justify="space-between">
            <div>
              <Title order={4}>{selectedNamespace}</Title>
              <Text c="dimmed" size="sm">
                Origin and actions are shown explicitly so local overlays are never confused with live cluster namespaces.
              </Text>
            </div>
            {selectedOrigin ? (
              <Badge color={selectedOrigin === NamespaceOrigin.CLUSTER ? "teal" : "grape"} variant="light">
                {NamespaceOriginLabel[selectedOrigin]}
              </Badge>
            ) : null}
          </Group>

          <Card padding="lg" radius="lg" withBorder>
            <Stack gap="md">
              <div>
                <Text fw={600}>Actions</Text>
                <Text c="dimmed" size="sm">
                  `adopt` and `destroy` run as agent jobs, stream live output over SSE, and are recorded in History. Deploy actions open the Deploy tab with a prefilled draft.
                </Text>
              </div>

              {selectedOrigin === NamespaceOrigin.CLUSTER ? (
                <Text c="dimmed" size="sm">
                  Prepare a bump redeploy from the latest recorded deploy for this live namespace. The draft keeps the previous services and tags but clears `clean`, `full`, and `stage`, so you can change image tags before redeploying.
                </Text>
              ) : selectedOrigin === NamespaceOrigin.LOCAL ? (
                <Text c="dimmed" size="sm">
                  Repeat the latest recorded deploy for this local overlay with the exact same recipe.
                </Text>
              ) : null}

              <Group align="flex-end">
                {selectedOrigin ? (
                  <Button
                    disabled={!selectedNamespace || prepareRedeployMutation.isPending}
                    loading={prepareRedeployMutation.isPending}
                    onClick={() => void prepareRedeployMutation.mutateAsync(selectedOrigin)}
                    variant="light"
                  >
                    {selectedOrigin === NamespaceOrigin.CLUSTER ? "Prepare bump redeploy" : "Repeat previous deploy"}
                  </Button>
                ) : null}
                <Button
                  disabled={!selectedNamespace || transientJob.isJobRunning}
                  loading={adoptMutation.isPending}
                  onClick={() => void adoptMutation.mutateAsync()}
                  variant="light"
                >
                  Adopt namespace
                </Button>
                <TextInput
                  description="Required before destroy"
                  label="Type namespace to confirm destroy"
                  onChange={(event) => setDestroyConfirmation(event.currentTarget.value)}
                  placeholder={selectedNamespace ?? "namespace"}
                  value={destroyConfirmation}
                />
                <Button
                  color="red"
                  disabled={
                    !selectedNamespace ||
                    transientJob.isJobRunning ||
                    destroyConfirmation.trim() !== selectedNamespace
                  }
                  loading={destroyMutation.isPending}
                  onClick={() => void destroyMutation.mutateAsync()}
                >
                  Destroy namespace
                </Button>
              </Group>

              {adoptMutation.isError ? (
                <Alert color="red" icon={<IconAlertCircle size={18} />} title="Adopt request failed">
                  <Text>
                    {adoptMutation.error instanceof Error
                      ? adoptMutation.error.message
                      : "Unable to start the adopt job."}
                  </Text>
                </Alert>
              ) : null}

              {destroyMutation.isError ? (
                <Alert color="red" icon={<IconAlertCircle size={18} />} title="Destroy request failed">
                  <Text>
                    {destroyMutation.error instanceof Error
                      ? destroyMutation.error.message
                      : "Unable to start the destroy job."}
                  </Text>
                </Alert>
              ) : null}

              {prepareRedeployMutation.isError ? (
                <Alert color="red" icon={<IconAlertCircle size={18} />} title="Prepare deploy draft failed">
                  <Text>
                    {prepareRedeployMutation.error instanceof Error
                      ? prepareRedeployMutation.error.message
                      : "Unable to load the latest deploy recipe for this namespace."}
                  </Text>
                </Alert>
              ) : null}
            </Stack>
          </Card>

          <Card padding="lg" radius="lg" withBorder>
            <LiveJobPanel
              cancelPending={transientJob.cancelMutation.isPending}
              emptyMessage="Run adopt or destroy to reveal the live log stream and cancellation controls."
              liveJob={transientJob.liveJob}
              logViewportRef={transientJob.logViewportRef}
              onCancel={() => void transientJob.cancelMutation.mutateAsync()}
              onViewHistory={transientJob.liveJob ? openHistoryForLiveJob : undefined}
            />
          </Card>

          <Card padding="lg" radius="lg" withBorder>
            <Stack gap="md">
              <Group justify="space-between">
                <div>
                  <Text fw={600}>Status</Text>
                  <Text c="dimmed" size="sm">
                    Captured text from `staging status`.
                  </Text>
                </div>
                {statusQuery.data ? (
                  <Badge color={statusQuery.data.exitCode === 0 ? "teal" : "yellow"} variant="light">
                    Exit code: {statusQuery.data.exitCode}
                  </Badge>
                ) : null}
              </Group>

              {statusQuery.isLoading ? (
                <Group gap="sm">
                  <Loader size="sm" />
                  <Text c="dimmed" size="sm">
                    Loading status.
                  </Text>
                </Group>
              ) : statusQuery.isError ? (
                <Alert color="red" icon={<IconAlertCircle size={18} />} title="Status request failed">
                  <Text>
                    {statusQuery.error instanceof Error
                      ? statusQuery.error.message
                      : "Unable to load namespace status."}
                  </Text>
                </Alert>
              ) : (
                <Box
                  aria-label="Status output"
                  bg="rgba(2, 6, 12, 0.95)"
                  c="gray.1"
                  h={220}
                  p="sm"
                  style={{
                    borderRadius: "12px",
                    fontFamily: "monospace",
                    overflowY: "auto",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {statusQuery.data?.raw || "No output returned."}
                </Box>
              )}
            </Stack>
          </Card>

          <Card padding="lg" radius="lg" withBorder>
            <Stack gap="md">
              <div>
                <Text fw={600}>Credentials</Text>
                <Text c="dimmed" size="sm">
                  Sensitive output stays local in this browser session, is never recorded, and is never sent to the backend.
                </Text>
              </div>

              <Group>
                <Button
                  leftSection={<IconKey size={16} />}
                  loading={credsQuery.isFetching}
                  onClick={() => void credsQuery.refetch()}
                  variant="light"
                >
                  {credsQuery.data ? "Refresh credentials" : "Load credentials"}
                </Button>
                <Button
                  disabled={!credsQuery.data}
                  leftSection={credsVisible ? <IconEyeOff size={16} /> : <IconEye size={16} />}
                  onClick={() => setCredsVisible((current) => !current)}
                  variant="light"
                >
                  {credsVisible ? "Hide" : "Reveal"}
                </Button>
                <Button disabled={!credsQuery.data} onClick={() => void copyCreds(credsQuery.data?.raw ?? "")} variant="light">
                  Copy
                </Button>
              </Group>

              {copyFeedback ? (
                <Text c="dimmed" size="sm">
                  {copyFeedback}
                </Text>
              ) : null}

              {credsQuery.isError ? (
                <Alert color="red" icon={<IconAlertCircle size={18} />} title="Credentials request failed">
                  <Text>
                    {credsQuery.error instanceof Error
                      ? credsQuery.error.message
                      : "Unable to load credentials."}
                  </Text>
                </Alert>
              ) : (
                <Box
                  aria-label="Credentials output"
                  bg="rgba(2, 6, 12, 0.95)"
                  c="gray.1"
                  h={220}
                  p="sm"
                  style={{
                    borderRadius: "12px",
                    fontFamily: "monospace",
                    overflowY: "auto",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {credsQuery.data ? (credsVisible ? credsQuery.data.raw : maskedCreds) : "Credentials are not loaded."}
                </Box>
              )}
            </Stack>
          </Card>

          <Card padding="lg" radius="lg" withBorder>
            <Stack gap="md">
              <Group justify="space-between">
                <div>
                  <Text fw={600}>Live logs</Text>
                  <Text c="dimmed" size="sm">
                    Tail deployment logs from `staging logs` with the same SSE frame format used by job streams.
                  </Text>
                </div>
                <Badge color={getNamespaceLogStatusColor(logsState.status)} variant="light">
                  {NamespaceLogStatusLabel[logsState.status]}
                  {logsState.exitCode !== null ? ` • exit ${logsState.exitCode}` : ""}
                </Badge>
              </Group>

              <Group align="flex-end">
                <TextInput
                  label="Deployment"
                  onChange={(event) =>
                    dispatchLogs({
                      deploy: event.currentTarget.value,
                      type: "set-deploy",
                    })
                  }
                  placeholder="iam-api"
                  style={{ flex: 1 }}
                  value={logsState.deploy}
                />
                <Button
                  disabled={!logsState.deploy.trim() || logsRunning}
                  leftSection={<IconPlayerPlay size={16} />}
                  onClick={() => void startLogs()}
                >
                  Start
                </Button>
                <Button disabled={!logsRunning} leftSection={<IconPlayerStop size={16} />} onClick={() => stopLogs(true)} variant="light">
                  Stop
                </Button>
              </Group>

              {logsState.streamError ? (
                <Alert color="red" icon={<IconAlertCircle size={18} />} title="Live logs failed">
                  <Text>{logsState.streamError}</Text>
                </Alert>
              ) : null}

              <Box
                aria-label="Live log output"
                bg="rgba(2, 6, 12, 0.95)"
                c="gray.1"
                h={280}
                p="sm"
                style={{
                  borderRadius: "12px",
                  fontFamily: "monospace",
                  overflowY: "auto",
                  whiteSpace: "pre-wrap",
                }}
              >
                {logsState.lines.length > 0
                  ? logsState.lines.join("\n")
                  : logsState.status === NamespaceLogStatus.RUNNING
                    ? "Waiting for log output..."
                    : "No log output yet."}
              </Box>
            </Stack>
          </Card>
        </Stack>
      </Drawer>
    </>
  );
}
