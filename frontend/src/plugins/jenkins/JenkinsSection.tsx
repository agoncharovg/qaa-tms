import { Alert, Button, Group, Loader, Stack, Text } from "@mantine/core";
import { IconAlertCircle, IconPlugConnectedX, IconRotateClockwise } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";

import { discoverAgent, getConfiguredAgentPorts } from "@/api/agentClient";
import { PluginId, QueryKey, ViewKey, type ViewKey as ViewKeyType } from "@/constants";
import { BoardPanel } from "@/plugins/jenkins/BoardPanel";
import { TreePanel } from "@/plugins/jenkins/TreePanel";
import { useAuthStore } from "@/store/authStore";

interface JenkinsSectionProps {
  mode: Extract<ViewKeyType, typeof ViewKey.JENKINS_TREE | typeof ViewKey.JENKINS_BOARD>;
}

const JenkinsSectionCopy = {
  AGENT_ERROR: "Jenkins agent discovery failed",
  AGENT_LOADING: "Checking the local companion app before loading Jenkins data.",
  AGENT_RETRY: "Retry",
  AGENT_UNAVAILABLE_BODY:
    "Start the local companion app, then retry discovery before opening the Jenkins explorer.",
  AGENT_UNAVAILABLE_TITLE: "Companion app is not running",
  AGENT_UNAVAILABLE_PORTS: "Probed ports:",
} as const;

export function JenkinsSection({ mode }: JenkinsSectionProps) {
  const token = useAuthStore((state) => state.token);
  const discoveryQuery = useQuery({
    enabled: Boolean(token),
    queryFn: ({ signal }) => discoverAgent(signal),
    queryKey: [QueryKey.JENKINS_TREE, PluginId.JENKINS, "discovery"],
    refetchOnWindowFocus: false,
    retry: false,
  });

  if (discoveryQuery.isLoading) {
    return (
      <Stack align="center" gap="md" py="xl">
        <Loader size="lg" />
        <Text c="dimmed">{JenkinsSectionCopy.AGENT_LOADING}</Text>
      </Stack>
    );
  }

  if (discoveryQuery.isError) {
    return (
      <Alert color="red" icon={<IconAlertCircle size={18} />} title={JenkinsSectionCopy.AGENT_ERROR}>
        <Stack gap="sm">
          <Text>
            {discoveryQuery.error instanceof Error
              ? discoveryQuery.error.message
              : JenkinsSectionCopy.AGENT_ERROR}
          </Text>
          <Group>
            <Button leftSection={<IconRotateClockwise size={16} />} onClick={() => void discoveryQuery.refetch()}>
              {JenkinsSectionCopy.AGENT_RETRY}
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
        title={JenkinsSectionCopy.AGENT_UNAVAILABLE_TITLE}
      >
        <Stack gap="sm">
          <Text>{JenkinsSectionCopy.AGENT_UNAVAILABLE_BODY}</Text>
          <Text c="dimmed" size="sm">
            {JenkinsSectionCopy.AGENT_UNAVAILABLE_PORTS} {getConfiguredAgentPorts().join(", ")}
          </Text>
          <Group>
            <Button
              leftSection={<IconRotateClockwise size={16} />}
              onClick={() => void discoveryQuery.refetch()}
              variant="light"
            >
              {JenkinsSectionCopy.AGENT_RETRY}
            </Button>
          </Group>
        </Stack>
      </Alert>
    );
  }

  if (mode === ViewKey.JENKINS_BOARD) {
    return <BoardPanel agentPort={discoveryQuery.data.port} />;
  }

  return <TreePanel agentPort={discoveryQuery.data.port} />;
}
