import { Alert, Loader, Stack, Text } from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";

import { agentClient } from "@/api/agentClient";
import { QueryKey, ViewKey, type ViewKey as ViewKeyType } from "@/constants";
import { CompanionGate } from "@/plugins/companion/CompanionGate";
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
  AGENT_SETTINGS_LOADING: "Loading companion settings.",
} as const;

function QaaGeneratorAgentSection({
  mode,
  port,
}: {
  mode: Exclude<QaaGeneratorSectionProps["mode"], typeof ViewKey.QAA_ADMIN>;
  port: number;
}) {
  const token = useAuthStore((state) => state.token);
  const settingsQuery = useQuery({
    enabled: Boolean(token),
    queryFn: ({ signal }) => agentClient.getSettings(port, token ?? "", signal),
    queryKey: [QueryKey.AGENT_SETTINGS, "qaa-generator", port, token],
  });

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
  if (mode === ViewKey.QAA_LIVE) {
    return <LivePanel agentPort={port} hasPersonalToken={hasPersonalToken} />;
  }
  if (mode === ViewKey.QAA_RUNS) {
    return <RunsPanel agentPort={port} hasPersonalToken={hasPersonalToken} />;
  }
  return <GeneratePanel agentPort={port} hasPersonalToken={hasPersonalToken} />;
}

export function QaaGeneratorSection({ mode }: QaaGeneratorSectionProps) {
  const token = useAuthStore((state) => state.token);

  if (mode === ViewKey.QAA_ADMIN) {
    return <AdminPanel />;
  }

  return (
    <CompanionGate
      enabled={Boolean(token)}
      errorTitle={QAA_SECTION_COPY.AGENT_ERROR}
      loadingMessage={QAA_SECTION_COPY.AGENT_LOADING}
    >
      {({ agentPort }) => <QaaGeneratorAgentSection mode={mode} port={agentPort} />}
    </CompanionGate>
  );
}
