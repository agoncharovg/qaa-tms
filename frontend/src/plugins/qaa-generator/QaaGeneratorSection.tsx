import { Alert, Button, Group, Loader, Stack, Text } from "@mantine/core";
import { IconAlertCircle, IconPlugConnectedX, IconRotateClockwise } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";

import { agentClient, discoverAgent, getConfiguredAgentPorts } from "@/api/agentClient";
import { PluginId, QueryKey, ViewKey, type ViewKey as ViewKeyType } from "@/constants";
import { useAuthStore } from "@/store/authStore";
import { AdminPanel } from "@/plugins/qaa-generator/AdminPanel";
import { GeneratePanel } from "@/plugins/qaa-generator/GeneratePanel";
import { LivePanel } from "@/plugins/qaa-generator/LivePanel";
import { RunsPanel } from "@/plugins/qaa-generator/RunsPanel";

interface QaaGeneratorSectionProps {
  mode: Extract<
    ViewKeyType,
    | typeof ViewKey.QAA_GENERATE
    | typeof ViewKey.QAA_LIVE
    | typeof ViewKey.QAA_RUNS
    | typeof ViewKey.QAA_ADMIN
  >;
}

const QAA_SECTION_COPY = {
  AGENT_ERROR: "QAA generator companion discovery failed",
  AGENT_LOADING: "Checking the local companion app before loading QAA generator.",
  AGENT_RETRY: "Retry",
  AGENT_SETTINGS_LOADING: "Loading companion settings.",
  AGENT_UNAVAILABLE_BODY:
    "Start the local companion app, then retry discovery before opening QAA generator.",
  AGENT_UNAVAILABLE_PORTS: "Probed ports:",
  AGENT_UNAVAILABLE_TITLE: "Companion app is not running",
} as const;

export function QaaGeneratorSection({ mode }: QaaGeneratorSectionProps) {
  const token = useAuthStore((state) => state.token);
  const usesAgent = mode !== ViewKey.QAA_ADMIN;

  const discoveryQuery = useQuery({
    enabled: Boolean(token) && usesAgent,
    queryFn: ({ signal }) => discoverAgent(signal),
    queryKey: [QueryKey.AGENT_SETTINGS, PluginId.QAA_GENERATOR, "discovery", token],
    refetchOnWindowFocus: false,
    retry: false,
  });

  const settingsQuery = useQuery({
    enabled: Boolean(token) && usesAgent && Boolean(discoveryQuery.data?.port),
    queryFn: ({ signal }) => agentClient.getSettings(discoveryQuery.data!.port, token ?? "", signal),
    queryKey: [QueryKey.AGENT_SETTINGS, PluginId.QAA_GENERATOR, discoveryQuery.data?.port, token],
  });

  if (mode === ViewKey.QAA_ADMIN) {
    return <AdminPanel />;
  }

  if (discoveryQuery.isLoading) {
    return (
      <Stack align="center" gap="md" py="xl">
        <Loader size="lg" />
        <Text c="dimmed">{QAA_SECTION_COPY.AGENT_LOADING}</Text>
      </Stack>
    );
  }

  if (discoveryQuery.isError) {
    return (
      <Alert color="red" icon={<IconAlertCircle size={18} />} title={QAA_SECTION_COPY.AGENT_ERROR}>
        <Stack gap="sm">
          <Text>
            {discoveryQuery.error instanceof Error
              ? discoveryQuery.error.message
              : QAA_SECTION_COPY.AGENT_ERROR}
          </Text>
          <Group>
            <Button leftSection={<IconRotateClockwise size={16} />} onClick={() => void discoveryQuery.refetch()}>
              {QAA_SECTION_COPY.AGENT_RETRY}
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
        title={QAA_SECTION_COPY.AGENT_UNAVAILABLE_TITLE}
      >
        <Stack gap="sm">
          <Text>{QAA_SECTION_COPY.AGENT_UNAVAILABLE_BODY}</Text>
          <Text c="dimmed" size="sm">
            {QAA_SECTION_COPY.AGENT_UNAVAILABLE_PORTS} {getConfiguredAgentPorts().join(", ")}
          </Text>
          <Group>
            <Button
              leftSection={<IconRotateClockwise size={16} />}
              onClick={() => void discoveryQuery.refetch()}
              variant="light"
            >
              {QAA_SECTION_COPY.AGENT_RETRY}
            </Button>
          </Group>
        </Stack>
      </Alert>
    );
  }

  if (settingsQuery.isLoading) {
    return (
      <Stack align="center" gap="md" py="xl">
        <Loader size="lg" />
        <Text c="dimmed">{QAA_SECTION_COPY.AGENT_SETTINGS_LOADING}</Text>
      </Stack>
    );
  }

  if (settingsQuery.isError || !settingsQuery.data) {
    return (
      <Alert color="red" icon={<IconAlertCircle size={18} />} title={QAA_SECTION_COPY.AGENT_ERROR}>
        <Text>
          {settingsQuery.error instanceof Error
            ? settingsQuery.error.message
            : QAA_SECTION_COPY.AGENT_ERROR}
        </Text>
      </Alert>
    );
  }

  const hasPersonalToken = settingsQuery.data.qaa_generator_token_set === true;
  const agentPort = discoveryQuery.data.port;

  if (mode === ViewKey.QAA_LIVE) {
    return <LivePanel agentPort={agentPort} hasPersonalToken={hasPersonalToken} />;
  }

  if (mode === ViewKey.QAA_RUNS) {
    return <RunsPanel agentPort={agentPort} hasPersonalToken={hasPersonalToken} />;
  }

  return <GeneratePanel agentPort={agentPort} hasPersonalToken={hasPersonalToken} />;
}
