import { useState } from "react";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Group,
  Loader,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconAlertCircle, IconPlugConnectedX, IconRotateClockwise } from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";

import { agentClient, getPreflight } from "@/api/agentClient";
import type { SyncRequest } from "@/api/types";
import { QueryKey, PluginId, TabId } from "@/constants";
import { LiveJobPanel } from "@/plugins/stagings/LiveJobPanel";
import { useTransientLiveJob } from "@/plugins/stagings/useTransientLiveJob";
import { useAuthStore } from "@/store/authStore";
import { useStagingsStore } from "@/store/stagingsStore";
import { useUiStore } from "@/store/uiStore";

function buildSyncRequest(formState: {
  apply: boolean;
  pull: boolean;
  service: string;
  verbose: boolean;
}): SyncRequest {
  const service = formState.service.trim();
  return {
    flags: {
      ...(service ? { service } : {}),
      apply: formState.apply,
      pull: formState.pull,
      verbose: formState.verbose,
    },
  };
}

export function SyncPanel() {
  const token = useAuthStore((state) => state.token);
  const setSelectedOperationId = useStagingsStore((state) => state.setSelectedOperationId);
  const openTab = useUiStore((state) => state.openTab);
  const switchTab = useUiStore((state) => state.switchTab);
  const historyOpen = useUiStore((state) =>
    state.tabsByPlugin[PluginId.STAGINGS].tabIds.includes(TabId.STAGINGS_HISTORY)
  );
  const [formState, setFormState] = useState({
    apply: false,
    pull: false,
    service: "",
    verbose: false,
  });

  const preflightQuery = useQuery({
    enabled: Boolean(token),
    queryFn: ({ signal }) => getPreflight(token ?? "", signal),
    queryKey: [QueryKey.AGENT_PREFLIGHT, token],
  });

  const agentPort = preflightQuery.data?.detected ? preflightQuery.data.port : null;
  const probedPorts =
    preflightQuery.data && !preflightQuery.data.detected ? preflightQuery.data.ports.join(", ") : "";
  const companionUnavailable = !preflightQuery.data?.detected;
  const { cancelMutation, isJobRunning, liveJob, logViewportRef, startLiveJob } = useTransientLiveJob(
    agentPort,
    token
  );

  const syncMutation = useMutation({
    mutationFn: async () => {
      if (!token || agentPort === null) {
        throw new Error("Companion app is not running.");
      }

      return agentClient.sync(agentPort, token, buildSyncRequest(formState));
    },
    onSuccess: (response) => {
      startLiveJob(response.jobId, response.opId);
      setSelectedOperationId(null);
    },
  });

  if (preflightQuery.isLoading) {
    return (
      <Stack align="center" gap="md" py="xl">
        <Loader size="lg" />
        <Text c="dimmed">Checking the local companion app before sync.</Text>
      </Stack>
    );
  }

  if (preflightQuery.isError) {
    return (
      <Alert color="red" icon={<IconAlertCircle size={18} />} title="Sync preparation failed">
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
    <Stack gap="lg">
      <SimpleGrid cols={{ base: 1, lg: 2 }}>
        <Card padding="lg" radius="lg" withBorder>
          <Stack gap="lg">
            <div>
              <Title order={3}>Sync drift</Title>
              <Text c="dimmed" size="sm">
                Run the global `staging sync` drift check with the exact CLI flags exposed by the agent.
              </Text>
            </div>

            {companionUnavailable ? (
              <Alert color="yellow" icon={<IconPlugConnectedX size={18} />} title="Companion app is not running">
                <Stack gap="sm">
                  <Text>Start the local companion app, then retry discovery before running sync.</Text>
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
            ) : null}

            <form
              onSubmit={(event) => {
                event.preventDefault();
                void syncMutation.mutateAsync();
              }}
            >
              <Stack gap="md">
                <TextInput
                  disabled={companionUnavailable || isJobRunning}
                  label="Service"
                  onChange={(event) => {
                    const { value } = event.currentTarget;
                    setFormState((current) => ({
                      ...current,
                      service: value,
                    }));
                  }}
                  placeholder="iam-api"
                  value={formState.service}
                />

                <Checkbox
                  checked={formState.verbose}
                  disabled={companionUnavailable || isJobRunning}
                  label="Verbose"
                  onChange={(event) => {
                    const { checked } = event.currentTarget;
                    setFormState((current) => ({
                      ...current,
                      verbose: checked,
                    }));
                  }}
                />
                <Checkbox
                  checked={formState.pull}
                  disabled={companionUnavailable || isJobRunning}
                  label="Pull"
                  onChange={(event) => {
                    const { checked } = event.currentTarget;
                    setFormState((current) => ({
                      ...current,
                      pull: checked,
                    }));
                  }}
                />
                <Checkbox
                  checked={formState.apply}
                  disabled={companionUnavailable || isJobRunning}
                  label="Apply"
                  onChange={(event) => {
                    const { checked } = event.currentTarget;
                    setFormState((current) => ({
                      ...current,
                      apply: checked,
                    }));
                  }}
                />

                {syncMutation.isError ? (
                  <Alert color="red" icon={<IconAlertCircle size={18} />} title="Sync request failed">
                    <Text>
                      {syncMutation.error instanceof Error
                        ? syncMutation.error.message
                        : "Unable to start the sync job."}
                    </Text>
                  </Alert>
                ) : null}

                <Group justify="space-between">
                  <Text c="dimmed" size="sm">
                    The form sends <code>{`{ flags: { service?, verbose, pull, apply } }`}</code> to the agent.
                  </Text>
                  <Button disabled={companionUnavailable || isJobRunning} loading={syncMutation.isPending} type="submit">
                    Run sync
                  </Button>
                </Group>
              </Stack>
            </form>
          </Stack>
        </Card>

        <Card padding="lg" radius="lg" withBorder>
          <LiveJobPanel
            cancelPending={cancelMutation.isPending}
            emptyMessage="Run sync to reveal the live log stream and cancellation controls."
            liveJob={liveJob}
            logViewportRef={logViewportRef}
            onCancel={() => void cancelMutation.mutateAsync()}
            onViewHistory={
              liveJob
                ? () => {
                    setSelectedOperationId(liveJob.opId);
                    if (historyOpen) {
                      switchTab(PluginId.STAGINGS, TabId.STAGINGS_HISTORY);
                      return;
                    }

                    openTab(PluginId.STAGINGS, TabId.STAGINGS_HISTORY);
                  }
                : undefined
            }
          />
        </Card>
      </SimpleGrid>
    </Stack>
  );
}

