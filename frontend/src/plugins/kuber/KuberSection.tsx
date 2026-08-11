import { Alert, Button, Group, Loader, Stack, Text } from "@mantine/core";
import { IconAlertCircle, IconPlugConnectedX, IconRotateClockwise } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";

import { discoverAgent } from "@/api/agentClient";
import { PluginId, QueryKey, ViewKey, type ViewKey as ViewKeyType } from "@/constants";
import { ClustersPanel } from "@/plugins/kuber/ClustersPanel";
import { PodsPanel } from "@/plugins/kuber/PodsPanel";
import { useAuthStore } from "@/store/authStore";

interface KuberSectionProps {
  mode: Extract<ViewKeyType, typeof ViewKey.KUBE_CLUSTERS | typeof ViewKey.KUBE_PODS>;
}

const KuberSectionCopy = {
  AGENT_ERROR: "Kuber agent discovery failed",
  AGENT_LOADING: "Checking the local companion app before loading Kubernetes data.",
  AGENT_RETRY: "Retry",
  AGENT_UNAVAILABLE_BODY:
    "Start the local companion app, then retry discovery before opening the Kubernetes explorer.",
  AGENT_UNAVAILABLE_TITLE: "Companion app is not running",
  AGENT_UNAVAILABLE_PORTS: "Probed ports:",
} as const;

export function KuberSection({ mode }: KuberSectionProps) {
  const token = useAuthStore((state) => state.token);
  const discoveryQuery = useQuery({
    enabled: Boolean(token),
    queryFn: ({ signal }) => discoverAgent(signal),
    queryKey: [QueryKey.KUBE_CONTEXTS, PluginId.KUBER],
    refetchOnWindowFocus: false,
    retry: false,
  });

  if (discoveryQuery.isLoading) {
    return (
      <Stack align="center" gap="md" py="xl">
        <Loader size="lg" />
        <Text c="dimmed">{KuberSectionCopy.AGENT_LOADING}</Text>
      </Stack>
    );
  }

  if (discoveryQuery.isError) {
    return (
      <Alert color="red" icon={<IconAlertCircle size={18} />} title={KuberSectionCopy.AGENT_ERROR}>
        <Stack gap="sm">
          <Text>
            {discoveryQuery.error instanceof Error
              ? discoveryQuery.error.message
              : KuberSectionCopy.AGENT_ERROR}
          </Text>
          <Group>
            <Button leftSection={<IconRotateClockwise size={16} />} onClick={() => void discoveryQuery.refetch()}>
              {KuberSectionCopy.AGENT_RETRY}
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
        title={KuberSectionCopy.AGENT_UNAVAILABLE_TITLE}
      >
        <Stack gap="sm">
          <Text>{KuberSectionCopy.AGENT_UNAVAILABLE_BODY}</Text>
          <Text c="dimmed" size="sm">
            {KuberSectionCopy.AGENT_UNAVAILABLE_PORTS} {import.meta.env.VITE_AGENT_PORTS ?? "47600-47605"}
          </Text>
          <Group>
            <Button
              leftSection={<IconRotateClockwise size={16} />}
              onClick={() => void discoveryQuery.refetch()}
              variant="light"
            >
              {KuberSectionCopy.AGENT_RETRY}
            </Button>
          </Group>
        </Stack>
      </Alert>
    );
  }

  if (mode === ViewKey.KUBE_PODS) {
    return <PodsPanel agentPort={discoveryQuery.data.port} />;
  }

  return <ClustersPanel agentPort={discoveryQuery.data.port} />;
}
