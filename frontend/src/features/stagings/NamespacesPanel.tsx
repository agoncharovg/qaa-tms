import { useEffect, useMemo, useReducer, useRef, useState } from "react";
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
  IconLayoutKanban,
  IconPlayerPlay,
  IconPlayerStop,
  IconPlugConnectedX,
  IconRotateClockwise,
} from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { agentClient, getPreflight } from "@/api/agentClient";
import type { JobTerminalEvent, NamespaceLogsState } from "@/api/types";
import {
  NamespaceLogStatus,
  NamespaceLogStatusLabel,
  QueryKey,
  type NamespaceLogStatus as NamespaceLogStatusType,
} from "@/constants";
import { useAuthStore } from "@/store/authStore";

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

function getStatusColor(status: NamespaceLogStatusType): string {
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

function maskSensitiveText(raw: string): string {
  return raw.replace(/[^\s]/g, "*");
}

export function NamespacesPanel() {
  const queryClient = useQueryClient();
  const token = useAuthStore((state) => state.token);
  const [selectedNamespace, setSelectedNamespace] = useState<string | null>(null);
  const [credsVisible, setCredsVisible] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [logsState, dispatchLogs] = useReducer(
    reduceNamespaceLogsState,
    undefined,
    createNamespaceLogsState
  );
  const streamAbortControllerRef = useRef<AbortController | null>(null);
  const logViewportRef = useRef<HTMLDivElement | null>(null);

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

  const parsedNamespaces = namespacesQuery.data?.namespaces ?? [];
  const listRaw = namespacesQuery.data?.raw ?? "";
  const listExitCode = namespacesQuery.data?.exitCode ?? null;
  const maskedCreds = useMemo(
    () => (credsQuery.data ? maskSensitiveText(credsQuery.data.raw) : ""),
    [credsQuery.data]
  );

  useEffect(() => {
    if (logViewportRef.current) {
      logViewportRef.current.scrollTop = logViewportRef.current.scrollHeight;
    }
  }, [logsState.lines.length]);

  useEffect(() => {
    return () => {
      streamAbortControllerRef.current?.abort();
    };
  }, []);

  function clearSensitiveState(namespaceToClear: string | null): void {
    if (!namespaceToClear) {
      return;
    }

    queryClient.removeQueries({
      queryKey: [QueryKey.AGENT_NAMESPACE_CREDS, token, agentPort, namespaceToClear],
    });
  }

  function stopLogs(markAborted: boolean): void {
    const controller = streamAbortControllerRef.current;
    streamAbortControllerRef.current = null;
    controller?.abort();
    if (markAborted && logsRunning) {
      dispatchLogs({ type: "set-aborted" });
    }
  }

  function selectNamespace(namespace: string): void {
    stopLogs(true);
    clearSensitiveState(selectedNamespace);
    setSelectedNamespace(namespace);
    setCredsVisible(false);
    setCopyFeedback(null);
    dispatchLogs({ type: "reset" });
  }

  function closeNamespaceDrawer(): void {
    stopLogs(true);
    clearSensitiveState(selectedNamespace);
    setSelectedNamespace(null);
    setCredsVisible(false);
    setCopyFeedback(null);
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
    streamAbortControllerRef.current = controller;

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
        if (streamAbortControllerRef.current === controller) {
          streamAbortControllerRef.current = null;
        }
      });
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
              Read-only namespace details from the local `staging` CLI. The parsed list is best effort;
              the raw CLI output below stays the source of truth.
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
          <Alert
            color="yellow"
            icon={<IconPlugConnectedX size={18} />}
            title="Companion app is not running"
          >
            <Stack gap="sm">
              <Text>
                Start the local companion app, then retry discovery before opening namespace details.
              </Text>
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
                <Button
                  leftSection={<IconRotateClockwise size={16} />}
                  onClick={() => void namespacesQuery.refetch()}
                >
                  Retry
                </Button>
              </Group>
            </Stack>
          </Alert>
        ) : (
          <>
            <SimpleGrid cols={{ base: 1, md: 2 }}>
              <Card padding="lg" radius="lg" withBorder>
                <Stack gap="md">
                  <Group justify="space-between">
                    <div>
                      <Text fw={600}>Parsed namespaces</Text>
                      <Text c="dimmed" size="sm">
                        Click a namespace to inspect status, credentials, and live logs.
                      </Text>
                    </div>
                    <Badge color={listExitCode === 0 ? "teal" : "yellow"} variant="light">
                      Exit code: {listExitCode ?? "n/a"}
                    </Badge>
                  </Group>

                  {parsedNamespaces.length === 0 ? (
                    <Paper p="lg" radius="md" withBorder>
                      <Stack align="center" gap="sm">
                        <IconLayoutKanban size={20} />
                        <Text fw={600}>No namespaces were parsed.</Text>
                        <Text c="dimmed" size="sm" ta="center">
                          The raw `staging list` output is still available below, even when the parser
                          cannot identify namespace names.
                        </Text>
                      </Stack>
                    </Paper>
                  ) : (
                    <Stack gap="sm">
                      {parsedNamespaces.map((namespace) => (
                        <Button
                          fullWidth
                          justify="space-between"
                          key={namespace}
                          onClick={() => selectNamespace(namespace)}
                          rightSection={<IconLayoutKanban size={16} />}
                          variant="light"
                        >
                          {namespace}
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
          </>
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
                  <Badge
                    color={statusQuery.data.exitCode === 0 ? "teal" : "yellow"}
                    variant="light"
                  >
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
                  Sensitive output stays local in this browser session, is never recorded, and is
                  never sent to the backend.
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
                <Button
                  disabled={!credsQuery.data}
                  onClick={() => void copyCreds(credsQuery.data?.raw ?? "")}
                  variant="light"
                >
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
                    Tail deployment logs from `staging logs` with the same SSE frame format used by
                    job streams.
                  </Text>
                </div>
                <Badge color={getStatusColor(logsState.status)} variant="light">
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
                <Button
                  disabled={!logsRunning}
                  leftSection={<IconPlayerStop size={16} />}
                  onClick={() => stopLogs(true)}
                  variant="light"
                >
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
                ref={logViewportRef}
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
