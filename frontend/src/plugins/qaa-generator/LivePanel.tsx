import { Alert, Button, Group, Stack, Text } from "@mantine/core";
import { IconAlertCircle, IconTrash } from "@tabler/icons-react";

import { LiveRunPanel } from "@/plugins/qaa-generator/LiveRunPanel";
import { useQaaRunLive } from "@/plugins/qaa-generator/useQaaRunLive";

const LIVE_PANEL_COPY = {
  CLEAR: "Clear current run",
  CONTROL_ERROR_TITLE: "Run control failed",
  MISSING_TOKEN: "Set your personal qaa-generator token in Profile / Settings to stream or control runs.",
} as const;

interface LivePanelProps {
  agentPort: number;
  hasPersonalToken: boolean;
}

function getMutationErrorMessage(error: unknown): string | null {
  return error instanceof Error ? error.message : null;
}

export function LivePanel({ agentPort, hasPersonalToken }: LivePanelProps) {
  const {
    clearLiveRun,
    liveRun,
    logViewportRef,
    pauseMutation,
    resumeMutation,
    stopMutation,
  } = useQaaRunLive(agentPort, hasPersonalToken);
  const mutationError =
    getMutationErrorMessage(pauseMutation.error) ??
    getMutationErrorMessage(resumeMutation.error) ??
    getMutationErrorMessage(stopMutation.error);

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        {!hasPersonalToken ? (
          <Alert color="yellow" icon={<IconAlertCircle size={18} />} title="Personal qaa-generator token required">
            <Text>{LIVE_PANEL_COPY.MISSING_TOKEN}</Text>
          </Alert>
        ) : <div />}
        <Button
          disabled={!liveRun}
          leftSection={<IconTrash size={16} />}
          onClick={() => clearLiveRun()}
          variant="subtle"
        >
          {LIVE_PANEL_COPY.CLEAR}
        </Button>
      </Group>

      {mutationError ? (
        <Alert
          color="red"
          icon={<IconAlertCircle size={18} />}
          title={LIVE_PANEL_COPY.CONTROL_ERROR_TITLE}
        >
          <Text>{mutationError}</Text>
        </Alert>
      ) : null}

      <LiveRunPanel
        liveRun={liveRun}
        logViewportRef={logViewportRef}
        onPause={() => {
          void pauseMutation.mutateAsync();
        }}
        onResume={() => {
          void resumeMutation.mutateAsync();
        }}
        onStop={() => {
          void stopMutation.mutateAsync();
        }}
        pausePending={pauseMutation.isPending}
        resumePending={resumeMutation.isPending}
        stopPending={stopMutation.isPending}
      />
    </Stack>
  );
}
