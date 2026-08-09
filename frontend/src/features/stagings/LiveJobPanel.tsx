import type { MutableRefObject } from "react";
import { Alert, Badge, Box, Button, Divider, Group, Paper, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { IconAlertCircle, IconHistory, IconPlayerStop } from "@tabler/icons-react";

import { OperationStatus, OperationStatusLabel, type OperationStatus as OperationStatusType } from "@/constants";
import { isTerminalJobStatus, type LiveJobState } from "@/features/stagings/liveJobState";

interface LiveJobPanelProps {
  cancelPending?: boolean;
  emptyMessage: string;
  liveJob: LiveJobState | null;
  logViewportRef?: MutableRefObject<HTMLDivElement | null>;
  onCancel?: () => void;
  onViewHistory?: () => void;
  title?: string;
}

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

export function LiveJobPanel({
  cancelPending = false,
  emptyMessage,
  liveJob,
  logViewportRef,
  onCancel,
  onViewHistory,
  title = "Live job log",
}: LiveJobPanelProps) {
  const isJobRunning = liveJob ? !isTerminalJobStatus(liveJob.status) : false;

  return (
    <Stack gap="md" h="100%">
      <Group justify="space-between">
        <div>
          <Title order={3}>{title}</Title>
          <Text c="dimmed" size="sm">
            Live output stays in memory for this browser session only.
          </Text>
        </div>

        {liveJob ? (
          <Badge color={getStatusColor(liveJob.status)} size="lg" variant="light">
            {OperationStatusLabel[liveJob.status]}
          </Badge>
        ) : null}
      </Group>

      {!liveJob ? (
        <Stack align="center" gap="sm" justify="center" py="xl">
          <Text c="dimmed">{emptyMessage}</Text>
        </Stack>
      ) : (
        <>
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <Paper p="md" radius="md" withBorder>
              <Text c="dimmed" size="sm">
                Job ID
              </Text>
              <Text ff="monospace" size="sm">
                {liveJob.jobId}
              </Text>
            </Paper>
            <Paper p="md" radius="md" withBorder>
              <Text c="dimmed" size="sm">
                Operation ID
              </Text>
              <Text ff="monospace" size="sm">
                {liveJob.opId}
              </Text>
            </Paper>
          </SimpleGrid>

          <Group justify="space-between">
            <Text c="dimmed" size="sm">
              Exit code: {liveJob.exitCode ?? "pending"}
            </Text>
            <Group>
              {isJobRunning ? (
                <Button
                  color="yellow"
                  leftSection={<IconPlayerStop size={16} />}
                  loading={cancelPending}
                  onClick={onCancel}
                  variant="light"
                >
                  Cancel
                </Button>
              ) : onViewHistory ? (
                <Button leftSection={<IconHistory size={16} />} onClick={onViewHistory} variant="light">
                  View in history
                </Button>
              ) : null}
            </Group>
          </Group>

          {liveJob.streamError ? (
            <Alert color="yellow" icon={<IconAlertCircle size={18} />} title="Live stream interrupted">
              <Text>{liveJob.streamError}</Text>
              <Text c="dimmed" size="sm">
                Job polling continues in the background until the terminal status arrives.
              </Text>
            </Alert>
          ) : null}

          <Divider />

          <Box
            aria-label="Live job output"
            bg="rgba(2, 6, 12, 0.95)"
            c="gray.1"
            h={360}
            p="md"
            ref={logViewportRef ? (node) => {
              logViewportRef.current = node;
            } : undefined}
            style={{
              border: "1px solid rgba(255, 255, 255, 0.08)",
              borderRadius: "12px",
              fontFamily: "monospace",
              overflowY: "auto",
              whiteSpace: "pre-wrap",
            }}
          >
            {liveJob.lines.length > 0 ? liveJob.lines.join("\n") : "Waiting for agent output..."}
          </Box>
        </>
      )}
    </Stack>
  );
}
