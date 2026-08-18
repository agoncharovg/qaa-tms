import { Badge, Button, Group, Modal, Progress, ScrollArea, Stack, Text } from "@mantine/core";

import type { JenkinsResumeRunRead } from "@/api/types";
import {
  JenkinsResumeItemState,
  JenkinsResumeItemStateColor,
  JenkinsResumeItemStateLabel,
  JenkinsResumeRunCopy,
  JenkinsResumeRunStatus,
} from "@/constants";
import { formatRelativeAgeFromIso } from "@/plugins/jenkins/relativeTime";

const JenkinsResumeProgressModalCopy = {
  ERROR_SUMMARY: "Resume failed.",
} as const;

interface JenkinsResumeProgressModalProps {
  onCancel: () => void;
  onClose: () => void;
  run: JenkinsResumeRunRead | null;
}

export function JenkinsResumeProgressModal({
  onCancel,
  onClose,
  run,
}: JenkinsResumeProgressModalProps) {
  if (!run) {
    return null;
  }

  const running = run.status === JenkinsResumeRunStatus.RUNNING;
  // Count both started and errored items as processed so the bar reaches 100% even
  // when some pipelines failed (total counts restorable items only).
  const progressValue =
    run.total > 0 ? Math.round(((run.startedCount + run.errorCount) / run.total) * 100) : 100;
  const startedBy = JenkinsResumeRunCopy.STARTED_BY.replace("{user}", run.createdBy).replace(
    "{when}",
    formatRelativeAgeFromIso(run.createdAt)
  );
  const terminalSummary =
    run.status === JenkinsResumeRunStatus.CANCELLED
      ? JenkinsResumeRunCopy.CANCELLED_SUMMARY
      : run.status === JenkinsResumeRunStatus.DONE
        ? JenkinsResumeRunCopy.DONE_SUMMARY
        : JenkinsResumeProgressModalCopy.ERROR_SUMMARY;

  return (
    <Modal
      centered
      closeOnClickOutside={false}
      closeOnEscape={false}
      onClose={running ? () => undefined : onClose}
      opened
      title={JenkinsResumeRunCopy.TITLE}
      withCloseButton={false}
    >
      <Stack gap="md">
        <Text c="dimmed" size="sm">
          {startedBy}
        </Text>

        <Stack gap="xs">
          <Text fw={600} size="sm">
            {JenkinsResumeRunCopy.NOW_STARTING}
          </Text>
          <Text>{run.currentName ?? JenkinsResumeRunCopy.FINISHING}</Text>
        </Stack>

        <Stack gap="xs">
          <Group justify="space-between">
            <Text fw={600} size="sm">
              {JenkinsResumeRunCopy.PROGRESS}
            </Text>
            <Text c="dimmed" size="sm">
              {JenkinsResumeRunCopy.STARTED_COUNT.replace("{started}", String(run.startedCount)).replace(
                "{total}",
                String(run.total)
              )}
            </Text>
          </Group>
          <Progress value={progressValue} />
          <Group gap="xs">
            <Badge color="green" variant="light">
              {JenkinsResumeItemStateLabel[JenkinsResumeItemState.STARTED]}
            </Badge>
            <Text c="dimmed" size="sm">
              {run.startedCount}
            </Text>
            <Badge color="gray" variant="light">
              {JenkinsResumeRunCopy.SKIPPED}
            </Badge>
            <Text c="dimmed" size="sm">
              {run.skippedCount}
            </Text>
            <Badge color="red" variant="light">
              {JenkinsResumeItemStateLabel[JenkinsResumeItemState.ERROR]}
            </Badge>
            <Text c="dimmed" size="sm">
              {run.errorCount}
            </Text>
          </Group>
        </Stack>

        <ScrollArea.Autosize mah={280}>
          <Stack gap="xs">
            {run.items.map((item) => (
              <Group justify="space-between" key={item.path} wrap="nowrap">
                <div style={{ minWidth: 0 }}>
                  <Text fw={500} size="sm" truncate="end">
                    {item.name}
                  </Text>
                  {item.reason ? (
                    <Text c="dimmed" size="xs">
                      {item.reason}
                    </Text>
                  ) : null}
                </div>
                <Badge color={JenkinsResumeItemStateColor[item.state]} variant="light">
                  {JenkinsResumeItemStateLabel[item.state]}
                </Badge>
              </Group>
            ))}
          </Stack>
        </ScrollArea.Autosize>

        {!running ? (
          <Stack gap="xs">
            <Text fw={600}>{terminalSummary}</Text>
            {run.cancelledBy ? (
              <Text c="dimmed" size="sm">
                {JenkinsResumeRunCopy.WHO_CANCELLED.replace("{user}", run.cancelledBy)}
              </Text>
            ) : null}
          </Stack>
        ) : null}

        <Group justify="flex-end">
          {running ? (
            <Button color="red" onClick={onCancel}>
              {JenkinsResumeRunCopy.CANCEL}
            </Button>
          ) : (
            <Button onClick={onClose}>{JenkinsResumeRunCopy.CLOSE}</Button>
          )}
        </Group>
      </Stack>
    </Modal>
  );
}
