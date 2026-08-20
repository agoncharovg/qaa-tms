import { Alert, Button, Group, Loader, Stack, Text } from "@mantine/core";
import { IconAlertCircle, IconPlugConnectedX, IconRotateClockwise } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";

import { discoverAgent, getConfiguredAgentPorts } from "@/api/agentClient";
import { PluginId, QueryKey } from "@/constants";
import { SmokePanel } from "@/plugins/statistics/SmokePanel";
import { useAuthStore } from "@/store/authStore";

const StatisticsSmokeSectionCopy = {
  AGENT_ERROR: "Statistics agent discovery failed",
  AGENT_LOADING: "Checking the local companion app before loading SMOKE statistics.",
  AGENT_RETRY: "Retry",
  AGENT_UNAVAILABLE_BODY:
    "Start the local companion app, then retry discovery before opening the SMOKE dashboard.",
  AGENT_UNAVAILABLE_PORTS: "Probed ports:",
  AGENT_UNAVAILABLE_TITLE: "Companion app is not running",
} as const;

export function StatisticsSmokeSection() {
  const token = useAuthStore((state) => state.token);
  const discoveryQuery = useQuery({
    enabled: Boolean(token),
    queryFn: ({ signal }) => discoverAgent(signal),
    queryKey: [QueryKey.JENKINS_FOLDER, PluginId.STATISTICS, "discovery"],
    refetchOnWindowFocus: false,
    retry: false,
  });

  if (discoveryQuery.isLoading) {
    return (
      <Stack align="center" gap="md" py="xl">
        <Loader size="lg" />
        <Text c="dimmed">{StatisticsSmokeSectionCopy.AGENT_LOADING}</Text>
      </Stack>
    );
  }

  if (discoveryQuery.isError) {
    return (
      <Alert
        color="red"
        icon={<IconAlertCircle size={18} />}
        title={StatisticsSmokeSectionCopy.AGENT_ERROR}
      >
        <Stack gap="sm">
          <Text>
            {discoveryQuery.error instanceof Error
              ? discoveryQuery.error.message
              : StatisticsSmokeSectionCopy.AGENT_ERROR}
          </Text>
          <Group>
            <Button
              leftSection={<IconRotateClockwise size={16} />}
              onClick={() => void discoveryQuery.refetch()}
            >
              {StatisticsSmokeSectionCopy.AGENT_RETRY}
            </Button>
          </Group>
        </Stack>
      </Alert>
    );
  }

  if (!discoveryQuery.data) {
    return (
      <Alert
        color="yellow"
        icon={<IconPlugConnectedX size={18} />}
        title={StatisticsSmokeSectionCopy.AGENT_UNAVAILABLE_TITLE}
      >
        <Stack gap="sm">
          <Text>{StatisticsSmokeSectionCopy.AGENT_UNAVAILABLE_BODY}</Text>
          <Text c="dimmed" size="sm">
            {StatisticsSmokeSectionCopy.AGENT_UNAVAILABLE_PORTS}{" "}
            {getConfiguredAgentPorts().join(", ")}
          </Text>
          <Group>
            <Button
              leftSection={<IconRotateClockwise size={16} />}
              onClick={() => void discoveryQuery.refetch()}
              variant="light"
            >
              {StatisticsSmokeSectionCopy.AGENT_RETRY}
            </Button>
          </Group>
        </Stack>
      </Alert>
    );
  }

  return <SmokePanel agentPort={discoveryQuery.data.port} />;
}
