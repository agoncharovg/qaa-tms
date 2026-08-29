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
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconDownload,
  IconPlayerPlay,
  IconPlayerStop,
  IconRefresh,
  IconTrash,
} from "@tabler/icons-react";
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
import { hasPermission } from "@/plugins/permissions";
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

interface PodExecBlock {
  command: string;
  exitCode: number | null;
  lines: string[];
  status: NamespaceLogStatusType;
}

interface PodExecState {
  blocks: PodExecBlock[];
  discardedEarlierOutput: boolean;
  streamError: string | null;
}

type PodLogsAction =
  | { type: "append-line"; line: string }
  | { type: "reset" }
  | { type: "set-stream-error"; message: string }
  | { type: "start" }
  | { type: "terminal"; terminal: JobTerminalEvent };

type PodExecAction =
  | { type: "append-line"; line: string }
  | { type: "mark-aborted" }
  | { type: "reset" }
  | { type: "set-stream-error"; message: string }
  | { type: "start"; command: string }
  | { type: "terminal"; terminal: JobTerminalEvent };

type PodExecRenderEntry =
  | { key: string; kind: "command"; text: string }
  | { key: string; kind: "line"; text: string }
  | { exitCode: number | null; key: string; kind: "status"; status: NamespaceLogStatusType };

const KUBER_EXEC_PERMISSION = "kuber.exec";
const ABORTED_EXIT_CODE = 130;

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
  EXEC_CLEAR: "Clear",
  EXEC_COMMAND_LABEL: "Command",
  EXEC_DISCARDED: "Earlier output was discarded to keep the retained session within the in-browser memory limit.",
  EXEC_DOWNLOAD: "Download",
  EXEC_EMPTY: "Run a command to stream container output.",
  EXEC_ERROR: "Exec stream failed",
  EXEC_HELPER: "Runs one-shot `kubectl exec` calls in the selected container via `sh -c` and appends each result below.",
  EXEC_PLACEHOLDER: "curl -X GET http://127.0.0.1:8080/health",
  EXEC_RUN: "Run",
  EXEC_SHOW_ALL: "Show all",
  EXEC_STOP: "Stop",
  EXEC_TITLE: "Exec",
  EXEC_TRUNCATED: "Output truncated to the last {count} lines.",
  EXEC_VIEWER_LABEL: "Pod exec console",
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
    "Choose a context and namespace, inspect pod health, stream logs, fetch raw describe output, run one-shot commands inside a selected container, and delete a pod behind a confirmation gate.",
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
  EXEC_MAX_RENDER_LINES: 5000,
  EXEC_MAX_RETAINED_LINES: 200000,
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

function createPodExecBlock(command: string): PodExecBlock {
  return {
    command,
    exitCode: null,
    lines: [],
    status: NamespaceLogStatus.RUNNING,
  };
}

function createPodExecState(): PodExecState {
  return {
    blocks: [],
    discardedEarlierOutput: false,
    streamError: null,
  };
}

function cloneExecBlocks(blocks: PodExecBlock[]): PodExecBlock[] {
  return blocks.map((block) => ({
    ...block,
    lines: [...block.lines],
  }));
}

function trimExecBlocks(blocks: PodExecBlock[]): { blocks: PodExecBlock[]; discardedEarlierOutput: boolean } {
  const nextBlocks = cloneExecBlocks(blocks);
  let discardedEarlierOutput = false;
  let retainedLines = nextBlocks.reduce((total, block) => total + block.lines.length, 0);

  while (retainedLines > PodsPanelValue.EXEC_MAX_RETAINED_LINES) {
    const firstBlock = nextBlocks[0];
    if (!firstBlock) {
      break;
    }
    if (firstBlock.lines.length > 0) {
      firstBlock.lines = firstBlock.lines.slice(1);
      retainedLines -= 1;
      discardedEarlierOutput = true;
      continue;
    }
    if (nextBlocks.length === 1) {
      break;
    }
    nextBlocks.shift();
    discardedEarlierOutput = true;
  }

  while (nextBlocks.length > 1) {
    const firstBlock = nextBlocks[0];
    if (firstBlock.lines.length > 0 || firstBlock.status === NamespaceLogStatus.RUNNING) {
      break;
    }
    nextBlocks.shift();
    discardedEarlierOutput = true;
  }

  return { blocks: nextBlocks, discardedEarlierOutput };
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

function reducePodExecState(state: PodExecState, action: PodExecAction): PodExecState {
  switch (action.type) {
    case "append-line": {
      if (state.blocks.length === 0) {
        return state;
      }
      const blocks = cloneExecBlocks(state.blocks);
      const currentBlock = blocks[blocks.length - 1];
      currentBlock.lines.push(action.line);
      const limited = trimExecBlocks(blocks);
      return {
        blocks: limited.blocks,
        discardedEarlierOutput: state.discardedEarlierOutput || limited.discardedEarlierOutput,
        streamError: state.streamError,
      };
    }
    case "mark-aborted": {
      if (state.blocks.length === 0) {
        return { ...state, streamError: null };
      }
      const blocks = cloneExecBlocks(state.blocks);
      const currentBlock = blocks[blocks.length - 1];
      if (currentBlock.status === NamespaceLogStatus.RUNNING) {
        currentBlock.exitCode = ABORTED_EXIT_CODE;
        currentBlock.status = NamespaceLogStatus.ABORTED;
      }
      return { ...state, blocks, streamError: null };
    }
    case "reset":
      return createPodExecState();
    case "set-stream-error": {
      if (state.blocks.length === 0) {
        return { ...state, streamError: action.message };
      }
      const blocks = cloneExecBlocks(state.blocks);
      const currentBlock = blocks[blocks.length - 1];
      if (currentBlock.status === NamespaceLogStatus.RUNNING) {
        currentBlock.status = NamespaceLogStatus.FAILED;
      }
      return { ...state, blocks, streamError: action.message };
    }
    case "start": {
      const limited = trimExecBlocks([...state.blocks, createPodExecBlock(action.command)]);
      return {
        blocks: limited.blocks,
        discardedEarlierOutput: state.discardedEarlierOutput || limited.discardedEarlierOutput,
        streamError: null,
      };
    }
    case "terminal": {
      if (state.blocks.length === 0) {
        return state;
      }
      const blocks = cloneExecBlocks(state.blocks);
      const currentBlock = blocks[blocks.length - 1];
      currentBlock.exitCode = action.terminal.exitCode;
      currentBlock.status = action.terminal.status as NamespaceLogStatusType;
      return { ...state, blocks, streamError: null };
    }
  }
}

function getNamespaceLogStatusColor(status: NamespaceLogStatusType): string {
  if (status === NamespaceLogStatus.IDLE) {
    return PodsPanelValue.DEFAULT_COLOR;
  }

  return OperationStatusColor[status];
}

function getExecExitBadgeColor(status: NamespaceLogStatusType): string {
  if (status === NamespaceLogStatus.SUCCESS) {
    return "teal";
  }
  if (status === NamespaceLogStatus.ABORTED) {
    return "yellow";
  }
  return "red";
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

function buildExecRenderEntries(blocks: PodExecBlock[]): PodExecRenderEntry[] {
  const entries: PodExecRenderEntry[] = [];

  blocks.forEach((block, blockIndex) => {
    entries.push({
      key: `command-${blockIndex}`,
      kind: "command",
      text: `$ ${block.command}`,
    });

    block.lines.forEach((line, lineIndex) => {
      entries.push({
        key: `line-${blockIndex}-${lineIndex}`,
        kind: "line",
        text: line,
      });
    });

    if (block.status !== NamespaceLogStatus.RUNNING) {
      entries.push({
        exitCode: block.exitCode,
        key: `status-${blockIndex}`,
        kind: "status",
        status: block.status,
      });
    }
  });

  return entries;
}

function buildExecConsoleText(state: PodExecState): string {
  const lines: string[] = [];

  if (state.discardedEarlierOutput) {
    lines.push("[earlier output discarded]");
    lines.push("");
  }

  state.blocks.forEach((block) => {
    lines.push(`$ ${block.command}`);
    lines.push(...block.lines);
    if (block.status !== NamespaceLogStatus.RUNNING) {
      lines.push(
        `[${NamespaceLogStatusLabel[block.status]} exit code: ${block.exitCode ?? "n/a"}]`
      );
    }
    lines.push("");
  });

  return lines.join("\n").trimEnd();
}

function getLastExecBlock(blocks: PodExecBlock[]): PodExecBlock | null {
  return blocks.length > 0 ? blocks[blocks.length - 1] : null;
}

function buildExecDownloadName(podName: string, container: string | null): string {
  return `${podName}-${container ?? "container"}-exec.txt`;
}

function abortExecController(controllerRef: { current: AbortController | null }): void {
  if (!controllerRef.current) {
    return;
  }

  const controller = controllerRef.current;
  controllerRef.current = null;
  controller.abort();
}

export function PodsPanel({ agentPort }: PodsPanelProps) {
  const queryClient = useQueryClient();
  const token = useAuthStore((state) => state.token);
  const currentUser = useAuthStore((state) => state.currentUser);
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
  const [execCommand, setExecCommand] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showAllExecOutput, setShowAllExecOutput] = useState(false);
  const [logsState, dispatchLogs] = useReducer(reducePodLogsState, undefined, createPodLogsState);
  const [execState, dispatchExec] = useReducer(reducePodExecState, undefined, createPodExecState);
  const logViewportRef = useRef<HTMLDivElement | null>(null);
  const execViewportRef = useRef<HTMLDivElement | null>(null);
  const execAbortControllerRef = useRef<AbortController | null>(null);
  const execConsoleRef = useRef<PodExecState>(createPodExecState());
  const canExec = hasPermission(currentUser, KUBER_EXEC_PERMISSION);

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

  const execRenderEntries = buildExecRenderEntries(execState.blocks);
  const hasExecOverflow = execRenderEntries.length > PodsPanelValue.EXEC_MAX_RENDER_LINES;
  const execRenderTruncated = hasExecOverflow && !showAllExecOutput;
  const visibleExecEntries = execRenderTruncated
    ? execRenderEntries.slice(-PodsPanelValue.EXEC_MAX_RENDER_LINES)
    : execRenderEntries;
  const execStatus = getLastExecBlock(execState.blocks)?.status ?? NamespaceLogStatus.IDLE;
  const isExecRunning = execStatus === NamespaceLogStatus.RUNNING;

  function stopExecStream(): void {
    if (!execAbortControllerRef.current) {
      return;
    }

    abortExecController(execAbortControllerRef);
    dispatchExec({ type: "mark-aborted" });
  }

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

  async function handleExecRun(): Promise<void> {
    if (!token || !selectedPod || !activeNamespace || isExecRunning) {
      return;
    }

    if (!execCommand.trim()) {
      return;
    }

    const command = execCommand;
    const controller = new AbortController();
    execAbortControllerRef.current = controller;
    dispatchExec({ type: "start", command });
    setExecCommand("");
    setShowAllExecOutput(false);

    try {
      await agentClient.execKubePod(
        agentPort,
        token,
        selectedPod.name,
        {
          command,
          container: selectedContainer,
          context: activeContext,
          namespace: activeNamespace,
        },
        (message) => {
          if (message.event === JobStreamEvent.LOG) {
            dispatchExec({
              type: "append-line",
              line: message.data.line,
            });
            return;
          }

          dispatchExec({
            type: "terminal",
            terminal: message.data,
          });
        },
        controller.signal
      );
    } catch (error: unknown) {
      if (controller.signal.aborted) {
        return;
      }

      dispatchExec({
        type: "set-stream-error",
        message: error instanceof Error ? error.message : PodsPanelCopy.EXEC_ERROR,
      });
    } finally {
      if (execAbortControllerRef.current === controller) {
        execAbortControllerRef.current = null;
      }
    }
  }

  function handleExecClear(): void {
    abortExecController(execAbortControllerRef);
    dispatchExec({ type: "reset" });
    setExecCommand("");
    setShowAllExecOutput(false);
  }

  function handleExecDownload(): void {
    if (!selectedPod) {
      return;
    }

    const blob = new Blob([buildExecConsoleText(execConsoleRef.current)], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.download = buildExecDownloadName(selectedPod.name, selectedContainer);
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
  }

  useEffect(() => {
    execConsoleRef.current = execState;
  }, [execState]);

  useEffect(() => {
    return () => {
      abortExecController(execAbortControllerRef);
    };
  }, []);

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
      abortExecController(execAbortControllerRef);
      setSelectedContainer(null);
      setDeleteConfirmation("");
      setExecCommand("");
      setShowAllExecOutput(false);
      dispatchLogs({ type: "reset" });
      dispatchExec({ type: "reset" });
      return;
    }

    const defaultContainer = selectedPod.containers[0] ?? null;
    setSelectedContainer((currentContainer) =>
      currentContainer && selectedPod.containers.includes(currentContainer)
        ? currentContainer
        : defaultContainer
    );
    setDeleteConfirmation("");
    setExecCommand("");
    setShowAllExecOutput(false);
    dispatchLogs({ type: "reset" });
    dispatchExec({ type: "reset" });
  }, [selectedPod]);

  useEffect(() => {
    if (!selectedPod) {
      return;
    }

    abortExecController(execAbortControllerRef);
    setExecCommand("");
    setShowAllExecOutput(false);
    dispatchExec({ type: "reset" });
  }, [selectedContainer, selectedPod]);

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

  useEffect(() => {
    if (execViewportRef.current) {
      execViewportRef.current.scrollTop = execViewportRef.current.scrollHeight;
    }
  }, [execState.blocks, showAllExecOutput]);

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

            {canExec ? (
              <Card padding="lg" radius="lg" withBorder>
                <Stack gap="md">
                  <Group justify="space-between">
                    <div>
                      <Text fw={600}>{PodsPanelCopy.EXEC_TITLE}</Text>
                      <Text c="dimmed" size="sm">
                        {PodsPanelCopy.EXEC_HELPER}
                      </Text>
                    </div>
                    <Badge color={getNamespaceLogStatusColor(execStatus)} variant="light">
                      {execStatus === NamespaceLogStatus.IDLE
                        ? PodsPanelCopy.STATUS_IDLE
                        : NamespaceLogStatusLabel[execStatus]}
                    </Badge>
                  </Group>

                  <Textarea
                    autosize
                    label={PodsPanelCopy.EXEC_COMMAND_LABEL}
                    minRows={2}
                    onChange={(event) => setExecCommand(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void handleExecRun();
                      }
                    }}
                    placeholder={PodsPanelCopy.EXEC_PLACEHOLDER}
                    value={execCommand}
                  />

                  <Group justify="space-between">
                    <Text c="dimmed" size="sm">
                      {selectedContainer
                        ? `${PodsPanelCopy.CONTAINER_LABEL}: ${selectedContainer}`
                        : "kubectl will use the pod default container."}
                    </Text>
                    <Group>
                      <Button
                        disabled={!execCommand.trim() || isExecRunning}
                        leftSection={<IconPlayerPlay size={16} />}
                        onClick={() => void handleExecRun()}
                      >
                        {PodsPanelCopy.EXEC_RUN}
                      </Button>
                      <Button
                        color="yellow"
                        disabled={!isExecRunning}
                        leftSection={<IconPlayerStop size={16} />}
                        onClick={() => stopExecStream()}
                        variant="light"
                      >
                        {PodsPanelCopy.EXEC_STOP}
                      </Button>
                      <Button
                        disabled={execState.blocks.length === 0 && !execState.streamError}
                        onClick={() => handleExecClear()}
                        variant="light"
                      >
                        {PodsPanelCopy.EXEC_CLEAR}
                      </Button>
                    </Group>
                  </Group>

                  {execState.streamError ? (
                    <Alert color="red" icon={<IconAlertCircle size={18} />} title={PodsPanelCopy.EXEC_ERROR}>
                      <Text>{execState.streamError}</Text>
                    </Alert>
                  ) : null}

                  {execState.discardedEarlierOutput || hasExecOverflow ? (
                    <Alert color="yellow" icon={<IconAlertCircle size={18} />} title={PodsPanelCopy.EXEC_TITLE}>
                      <Stack gap="xs">
                        {execState.discardedEarlierOutput ? (
                          <Text size="sm">{PodsPanelCopy.EXEC_DISCARDED}</Text>
                        ) : null}
                        {execRenderTruncated ? (
                          <Text size="sm">
                            {PodsPanelCopy.EXEC_TRUNCATED.replace(
                              "{count}",
                              String(PodsPanelValue.EXEC_MAX_RENDER_LINES)
                            )}
                          </Text>
                        ) : null}
                        <Group>
                          {execRenderTruncated && !showAllExecOutput ? (
                            <Button onClick={() => setShowAllExecOutput(true)} size="xs" variant="light">
                              {PodsPanelCopy.EXEC_SHOW_ALL}
                            </Button>
                          ) : null}
                          {execRenderEntries.length > 0 ? (
                            <Button
                              leftSection={<IconDownload size={14} />}
                              onClick={() => handleExecDownload()}
                              size="xs"
                              variant="light"
                            >
                              {PodsPanelCopy.EXEC_DOWNLOAD}
                            </Button>
                          ) : null}
                        </Group>
                      </Stack>
                    </Alert>
                  ) : null}

                  <Box
                    aria-label={PodsPanelCopy.EXEC_VIEWER_LABEL}
                    bg="rgba(2, 6, 12, 0.95)"
                    c="gray.1"
                    h={PodsPanelValue.LOG_VIEW_HEIGHT}
                    p="sm"
                    ref={execViewportRef}
                    style={{
                      borderRadius: "12px",
                      fontFamily: "monospace",
                      overflowY: "auto",
                    }}
                  >
                    {visibleExecEntries.length > 0 ? (
                      <Stack gap={4}>
                        {visibleExecEntries.map((entry) => {
                          if (entry.kind === "command") {
                            return (
                              <Text c="cyan.3" component="div" key={entry.key} size="sm" style={{ whiteSpace: "pre-wrap" }}>
                                {entry.text}
                              </Text>
                            );
                          }

                          if (entry.kind === "status") {
                            return (
                              <Group gap="xs" key={entry.key}>
                                <Badge color={getExecExitBadgeColor(entry.status)} size="sm" variant="light">
                                  Exit code: {entry.exitCode ?? "n/a"}
                                </Badge>
                              </Group>
                            );
                          }

                          return (
                            <Text component="div" key={entry.key} size="sm" style={{ whiteSpace: "pre-wrap" }}>
                              {entry.text || " "}
                            </Text>
                          );
                        })}
                      </Stack>
                    ) : (
                      <Text c="gray.5" component="div" size="sm">
                        {PodsPanelCopy.EXEC_EMPTY}
                      </Text>
                    )}
                  </Box>
                </Stack>
              </Card>
            ) : null}

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
