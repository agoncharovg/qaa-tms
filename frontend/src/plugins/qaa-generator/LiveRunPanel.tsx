import type { MutableRefObject } from "react";
import {
  Alert,
  Badge,
  Box,
  Button,
  Group,
  Loader,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlayerStop,
} from "@tabler/icons-react";

import { QaaRunStatus, QaaRunStatusColor, QaaRunStatusLabel } from "@/constants";
import {
  isTerminalQaaRunStatus,
  type QaaLiveRunState,
} from "@/plugins/qaa-generator/runState";

const LIVE_RUN_PANEL_COPY = {
  EMPTY_MESSAGE: "Start a run from Generate or open one from Runs to stream it here.",
  LOADING_RUN: "Loading run details from the backend proxy.",
  STREAM_TITLE: "Live run stream interrupted",
  TITLE: "Live QAA run",
  WAITING_EVENTS: "Waiting for qaa-generator events...",
} as const;

function formatEventLine(event: QaaLiveRunState["events"][number]): string {
  // Lifecycle events have no message — show just the type instead of "...: null".
  const message = event.message?.trim();
  return message
    ? `${event.sequence} ${event.event_type}: ${message}`
    : `${event.sequence} ${event.event_type}`;
}

interface LiveRunPanelProps {
  liveRun: QaaLiveRunState | null;
  logViewportRef: MutableRefObject<HTMLDivElement | null>;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  pausePending: boolean;
  resumePending: boolean;
  stopPending: boolean;
}

export function LiveRunPanel({
  liveRun,
  logViewportRef,
  onPause,
  onResume,
  onStop,
  pausePending,
  resumePending,
  stopPending,
}: LiveRunPanelProps) {
  const run = liveRun?.run;
  const runStatus = run?.status;
  const isTerminal = runStatus ? isTerminalQaaRunStatus(runStatus) : false;
  const formattedEvents = liveRun?.events.map(formatEventLine).join("\n") ?? "";

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <div>
          <Title order={3}>{LIVE_RUN_PANEL_COPY.TITLE}</Title>
          <Text c="dimmed" size="sm">
            Follow one centrally executed qaa-generator run over authenticated fetch-SSE.
          </Text>
        </div>
        {runStatus ? (
          <Badge color={QaaRunStatusColor[runStatus]} size="lg" variant="light">
            {QaaRunStatusLabel[runStatus]}
          </Badge>
        ) : null}
      </Group>

      {!liveRun ? (
        <Paper p="xl" radius="lg" withBorder>
          <Stack align="center" gap="sm">
            <Text c="dimmed">{LIVE_RUN_PANEL_COPY.EMPTY_MESSAGE}</Text>
          </Stack>
        </Paper>
      ) : (
        <>
          <SimpleGrid cols={{ base: 1, md: 2 }}>
            <Paper p="md" radius="md" withBorder>
              <Text c="dimmed" size="sm">
                Run ID
              </Text>
              <Text ff="monospace" size="sm">
                {liveRun.runId}
              </Text>
            </Paper>
            <Paper p="md" radius="md" withBorder>
              <Text c="dimmed" size="sm">
                Jira key
              </Text>
              <Text size="sm">{run?.jira_key ?? "Loading..."}</Text>
            </Paper>
            <Paper p="md" radius="md" withBorder>
              <Text c="dimmed" size="sm">
                Effective actor
              </Text>
              <Text size="sm">{run?.effective_actor ?? "—"}</Text>
            </Paper>
            <Paper p="md" radius="md" withBorder>
              <Text c="dimmed" size="sm">
                Profile
              </Text>
              <Text size="sm">{run?.profile ?? "—"}</Text>
            </Paper>
          </SimpleGrid>

          {!run ? (
            <Group gap="sm">
              <Loader size="sm" />
              <Text c="dimmed" size="sm">
                {LIVE_RUN_PANEL_COPY.LOADING_RUN}
              </Text>
            </Group>
          ) : null}

          {!isTerminal && runStatus === QaaRunStatus.PAUSED ? (
            <Group justify="flex-end">
              <Button
                leftSection={<IconPlayerPlay size={16} />}
                loading={resumePending}
                onClick={onResume}
                variant="light"
              >
                Resume
              </Button>
              <Button
                color="red"
                leftSection={<IconPlayerStop size={16} />}
                loading={stopPending}
                onClick={onStop}
                variant="light"
              >
                Stop
              </Button>
            </Group>
          ) : !isTerminal ? (
            <Group justify="flex-end">
              <Button
                color="yellow"
                leftSection={<IconPlayerPause size={16} />}
                loading={pausePending}
                onClick={onPause}
                variant="light"
              >
                Pause
              </Button>
              <Button
                color="red"
                leftSection={<IconPlayerStop size={16} />}
                loading={stopPending}
                onClick={onStop}
                variant="light"
              >
                Stop
              </Button>
            </Group>
          ) : null}

          {liveRun.streamError ? (
            <Alert
              color="yellow"
              icon={<IconAlertCircle size={18} />}
              title={LIVE_RUN_PANEL_COPY.STREAM_TITLE}
            >
              <Text>{liveRun.streamError}</Text>
              <Text c="dimmed" size="sm">
                The detail poller keeps running until a terminal status arrives.
              </Text>
            </Alert>
          ) : null}

          <Box
            aria-label="Live QAA run output"
            bg="rgba(2, 6, 12, 0.95)"
            c="gray.1"
            h={360}
            p="md"
            ref={(node) => {
              logViewportRef.current = node;
            }}
            style={{
              border: "1px solid rgba(255, 255, 255, 0.08)",
              borderRadius: "12px",
              fontFamily: "monospace",
              overflowY: "auto",
              whiteSpace: "pre-wrap",
            }}
          >
            {formattedEvents.length > 0 ? formattedEvents : LIVE_RUN_PANEL_COPY.WAITING_EVENTS}
          </Box>
        </>
      )}
    </Stack>
  );
}
