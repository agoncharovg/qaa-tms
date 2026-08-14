import { useEffect, useState, type ReactNode } from "react";
import {
  Alert,
  Button,
  Card,
  Group,
  Loader,
  PasswordInput,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconCheck,
  IconPlugConnectedX,
  IconRotateClockwise,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { agentClient, discoverAgent, getConfiguredAgentPorts } from "@/api/agentClient";
import type { AgentSettings, AgentSettingsUpdate } from "@/api/types";
import { usePalette } from "@/app/theme/usePalette";
import { PluginId, QueryKey, type PluginId as PluginIdType } from "@/constants";
import { usePluginsContext } from "@/plugins/context";
import { useAuthStore } from "@/store/authStore";

const SettingsPanelCopy = {
  AGENT_ERROR: "Companion settings failed to load",
  AGENT_LOADING: "Checking the local companion app.",
  AGENT_RETRY: "Retry",
  AGENT_SETTINGS_LOADING: "Loading companion settings.",
  AGENT_UNAVAILABLE_BODY:
    "Start the local companion app, then retry discovery before editing this machine's settings.",
  AGENT_UNAVAILABLE_PORTS: "Probed ports:",
  AGENT_UNAVAILABLE_TITLE: "Companion app is not running",
  CLEAR_SECRET: "Clear stored value",
  EMPTY_STATE: "No plugin-specific settings are enabled for this user.",
  JENKINS_DESCRIPTION:
    "Your personal Jenkins credentials are written to the local companion `.env` on this machine.",
  JENKINS_SAVE: "Save Jenkins settings",
  JENKINS_TITLE: "Jenkins",
  JENKINS_TOKEN_LABEL: "Personal token",
  JENKINS_URL_LABEL: "URL",
  JENKINS_USERNAME_LABEL: "Username",
  KUBER_DESCRIPTION:
    "Your personal kubeconfig is written to the local companion `.env` on this machine.",
  KUBER_KUBECONFIG_LABEL: "Kubeconfig path",
  KUBER_SAVE: "Save Kuber settings",
  KUBER_TITLE: "Kuber",
  LOADING: "Loading settings.",
  NOT_SET: "Not set",
  QAA_GENERATOR_DESCRIPTION:
    "Your personal qaa-generator token is written to the local companion `.env` on this machine.",
  QAA_GENERATOR_SAVE: "Save qaa-generator token",
  QAA_GENERATOR_TITLE: "QAA generator",
  QAA_GENERATOR_TOKEN_LABEL: "Personal token",
  SECTION_DESCRIPTION:
    "Edit only the personal credentials required by the plugins enabled for your account.",
  SECRET_SET: "•••• set",
  TITLE: "Settings",
  TOKEN_STATUS_NOT_SET: "not set",
  TOKEN_STATUS_SET: "set",
  UPDATE_FAILED: "Save failed",
  UPDATE_REQUIRED: "Authentication is required.",
  UPDATE_SUCCESS: "Settings saved.",
  STAGINGS_DESCRIPTION:
    "Your staging-cluster access stays on the local companion because the companion uses it from this machine.",
  STAGINGS_KUBECONFIG_LABEL: "Staging kubeconfig path",
  STAGINGS_KUBECONFIG_URL_LABEL: "Staging kubeconfig update URL",
  STAGINGS_SAVE: "Save Stagings settings",
  STAGINGS_TITLE: "Stagings",
} as const;

const NoticeStatus = {
  ERROR: "error",
  SUCCESS: "success",
} as const;

const AgentQueryKey = {
  DISCOVERY: "discovery",
} as const;

const EMPTY_VALUE = "" as const;
const ALERT_ICON_SIZE_PX = 18 as const;
const CARD_TITLE_ORDER = 3 as const;
const FORM_COLUMNS = { base: 1, md: 2 } as const;
const PAGE_TITLE_ORDER = 2 as const;
const RETRY_ICON_SIZE_PX = 16 as const;

const SECRET_INPUT_AUTOCOMPLETE = "new-password" as const;
const SECRET_INPUT_NAME = {
  JENKINS_TOKEN: "jenkins-personal-token",
  QAA_GENERATOR_TOKEN: "qaa-generator-personal-token",
} as const;

type Notice = {
  message: string;
  status: (typeof NoticeStatus)[keyof typeof NoticeStatus];
};

type AgentFormState = {
  jenkinsToken: string;
  jenkinsTokenDirty: boolean;
  jenkinsTokenSet: boolean;
  jenkinsUrl: string;
  jenkinsUsername: string;
  kubeconfig: string;
  stagingKubeconfig: string;
  stagingKubeconfigUrl: string;
};

type QaaGeneratorFormState = {
  token: string;
  tokenSet: boolean;
};

function buildAgentFormState(settings: AgentSettings): AgentFormState {
  return {
    jenkinsToken: EMPTY_VALUE,
    jenkinsTokenDirty: false,
    jenkinsTokenSet: settings.jenkins_token_set,
    jenkinsUrl: settings.jenkins_url,
    jenkinsUsername: settings.jenkins_username,
    kubeconfig: settings.kubeconfig,
    stagingKubeconfig: settings.staging_kubeconfig,
    stagingKubeconfigUrl: settings.staging_kubeconfig_url,
  };
}

function buildQaaGeneratorFormState(settings: AgentSettings): QaaGeneratorFormState {
  return {
    token: EMPTY_VALUE,
    tokenSet: settings.qaa_generator_token_set,
  };
}

function NoticeAlert({
  notice,
  successTitle,
}: {
  notice: Notice | null;
  successTitle: string;
}) {
  if (!notice) {
    return null;
  }

  const isSuccess = notice.status === NoticeStatus.SUCCESS;

  return (
    <Alert
      color={isSuccess ? "teal" : "red"}
      icon={isSuccess ? <IconCheck size={ALERT_ICON_SIZE_PX} /> : <IconAlertCircle size={ALERT_ICON_SIZE_PX} />}
      title={isSuccess ? successTitle : SettingsPanelCopy.UPDATE_FAILED}
    >
      {notice.message}
    </Alert>
  );
}

function CardShell({
  children,
  description,
  title,
}: {
  children?: ReactNode;
  description: string;
  title: string;
}) {
  const palette = usePalette();

  return (
    <Card
      padding="lg"
      radius="lg"
      shadow="sm"
      style={{
        backgroundColor: palette.surface,
        border: `1px solid ${palette.line}`,
      }}
      withBorder
    >
      <Stack gap="md">
        <div>
          <Title order={CARD_TITLE_ORDER}>{title}</Title>
          <Text c="dimmed" size="sm">
            {description}
          </Text>
        </div>
        {children}
      </Stack>
    </Card>
  );
}

export function SettingsPanel() {
  const queryClient = useQueryClient();
  const { enabledOptionalPluginIdSet } = usePluginsContext();
  const currentUser = useAuthStore((state) => state.currentUser);
  const token = useAuthStore((state) => state.token);
  const enabledPluginIds = currentUser
    ? enabledOptionalPluginIdSet(currentUser.enabled_plugins)
    : new Set<PluginIdType>();
  const showJenkins = enabledPluginIds.has(PluginId.JENKINS);
  const showStagings = enabledPluginIds.has(PluginId.STAGINGS);
  const showKuber = enabledPluginIds.has(PluginId.KUBER);
  const showQaaGenerator = enabledPluginIds.has(PluginId.QAA_GENERATOR);
  const hasEnabledAgentPlugins = showJenkins || showStagings || showKuber || showQaaGenerator;
  const hasVisiblePluginSettings = hasEnabledAgentPlugins || showQaaGenerator;

  const [agentForm, setAgentForm] = useState<AgentFormState | null>(null);
  const [jenkinsNotice, setJenkinsNotice] = useState<Notice | null>(null);
  const [stagingsNotice, setStagingsNotice] = useState<Notice | null>(null);
  const [kuberNotice, setKuberNotice] = useState<Notice | null>(null);
  const [qaaGeneratorForm, setQaaGeneratorForm] = useState<QaaGeneratorFormState | null>(null);
  const [qaaGeneratorNotice, setQaaGeneratorNotice] = useState<Notice | null>(null);

  const discoveryQuery = useQuery({
    enabled: Boolean(token) && hasEnabledAgentPlugins,
    queryFn: ({ signal }) => discoverAgent(signal),
    queryKey: [QueryKey.AGENT_SETTINGS, AgentQueryKey.DISCOVERY, token],
    refetchOnWindowFocus: false,
    retry: false,
  });

  const agentSettingsQuery = useQuery({
    enabled: Boolean(token) && Boolean(discoveryQuery.data?.port) && hasEnabledAgentPlugins,
    queryFn: ({ signal }) =>
      agentClient.getSettings(discoveryQuery.data!.port, token ?? EMPTY_VALUE, signal),
    queryKey: [QueryKey.AGENT_SETTINGS, discoveryQuery.data?.port, token],
  });

  useEffect(() => {
    if (agentSettingsQuery.data) {
      setAgentForm(buildAgentFormState(agentSettingsQuery.data));
      setQaaGeneratorForm(buildQaaGeneratorFormState(agentSettingsQuery.data));
    }
  }, [agentSettingsQuery.data]);

  const jenkinsUpdateMutation = useMutation({
    mutationFn: async (payload: AgentSettingsUpdate) => {
      if (!token || !discoveryQuery.data) {
        throw new Error(SettingsPanelCopy.UPDATE_REQUIRED);
      }

      return agentClient.updateSettings(discoveryQuery.data.port, token, payload);
    },
    onSuccess: async (updatedSettings) => {
      setAgentForm(buildAgentFormState(updatedSettings));
      setJenkinsNotice({
        message: SettingsPanelCopy.UPDATE_SUCCESS,
        status: NoticeStatus.SUCCESS,
      });
      await queryClient.invalidateQueries({ queryKey: [QueryKey.AGENT_SETTINGS] });
    },
    onError: (error) => {
      setJenkinsNotice({
        message: error instanceof Error ? error.message : SettingsPanelCopy.UPDATE_FAILED,
        status: NoticeStatus.ERROR,
      });
    },
  });

  const stagingsUpdateMutation = useMutation({
    mutationFn: async (payload: AgentSettingsUpdate) => {
      if (!token || !discoveryQuery.data) {
        throw new Error(SettingsPanelCopy.UPDATE_REQUIRED);
      }

      return agentClient.updateSettings(discoveryQuery.data.port, token, payload);
    },
    onSuccess: async (updatedSettings) => {
      setAgentForm(buildAgentFormState(updatedSettings));
      setStagingsNotice({
        message: SettingsPanelCopy.UPDATE_SUCCESS,
        status: NoticeStatus.SUCCESS,
      });
      await queryClient.invalidateQueries({ queryKey: [QueryKey.AGENT_SETTINGS] });
    },
    onError: (error) => {
      setStagingsNotice({
        message: error instanceof Error ? error.message : SettingsPanelCopy.UPDATE_FAILED,
        status: NoticeStatus.ERROR,
      });
    },
  });

  const kuberUpdateMutation = useMutation({
    mutationFn: async (payload: AgentSettingsUpdate) => {
      if (!token || !discoveryQuery.data) {
        throw new Error(SettingsPanelCopy.UPDATE_REQUIRED);
      }

      return agentClient.updateSettings(discoveryQuery.data.port, token, payload);
    },
    onSuccess: async (updatedSettings) => {
      setAgentForm(buildAgentFormState(updatedSettings));
      setKuberNotice({
        message: SettingsPanelCopy.UPDATE_SUCCESS,
        status: NoticeStatus.SUCCESS,
      });
      await queryClient.invalidateQueries({ queryKey: [QueryKey.AGENT_SETTINGS] });
    },
    onError: (error) => {
      setKuberNotice({
        message: error instanceof Error ? error.message : SettingsPanelCopy.UPDATE_FAILED,
        status: NoticeStatus.ERROR,
      });
    },
  });

  const qaaGeneratorUpdateMutation = useMutation({
    mutationFn: async (qaaGeneratorToken: string) => {
      if (!token || !discoveryQuery.data) {
        throw new Error(SettingsPanelCopy.UPDATE_REQUIRED);
      }

      return agentClient.updateSettings(discoveryQuery.data.port, token, {
        qaa_generator_token: qaaGeneratorToken,
      });
    },
    onSuccess: async (updatedSettings) => {
      setQaaGeneratorForm(buildQaaGeneratorFormState(updatedSettings));
      setQaaGeneratorNotice({
        message: SettingsPanelCopy.UPDATE_SUCCESS,
        status: NoticeStatus.SUCCESS,
      });
      await queryClient.invalidateQueries({ queryKey: [QueryKey.AGENT_SETTINGS] });
    },
    onError: (error) => {
      setQaaGeneratorNotice({
        message: error instanceof Error ? error.message : SettingsPanelCopy.UPDATE_FAILED,
        status: NoticeStatus.ERROR,
      });
    },
  });

  if (!currentUser) {
    return (
      <Stack align="center" gap="sm" py="xl">
        <Loader size="lg" />
        <Text c="dimmed">{SettingsPanelCopy.LOADING}</Text>
      </Stack>
    );
  }

  function setAgentField<Key extends keyof AgentFormState>(key: Key, value: AgentFormState[Key]): void {
    setAgentForm((currentForm) => {
      if (!currentForm) {
        return currentForm;
      }

      return {
        ...currentForm,
        [key]: value,
      };
    });
  }

  function setQaaGeneratorField<Key extends keyof QaaGeneratorFormState>(
    key: Key,
    value: QaaGeneratorFormState[Key]
  ): void {
    setQaaGeneratorForm((currentForm) => {
      if (!currentForm) {
        return currentForm;
      }

      return {
        ...currentForm,
        [key]: value,
      };
    });
  }

  function saveJenkinsSettings(): void {
    if (!agentForm) {
      return;
    }

    setJenkinsNotice(null);
    const payload: AgentSettingsUpdate = {
      jenkins_url: agentForm.jenkinsUrl,
      jenkins_username: agentForm.jenkinsUsername,
    };
    if (agentForm.jenkinsTokenDirty) {
      payload.jenkins_token = agentForm.jenkinsToken;
    }
    jenkinsUpdateMutation.mutate(payload);
  }

  function saveStagingsSettings(): void {
    if (!agentForm) {
      return;
    }

    setStagingsNotice(null);
    stagingsUpdateMutation.mutate({
      staging_kubeconfig: agentForm.stagingKubeconfig,
      staging_kubeconfig_url: agentForm.stagingKubeconfigUrl,
    });
  }

  function saveKuberSettings(): void {
    if (!agentForm) {
      return;
    }

    setKuberNotice(null);
    kuberUpdateMutation.mutate({
      kubeconfig: agentForm.kubeconfig,
    });
  }

  function saveQaaGeneratorToken(): void {
    if (!qaaGeneratorForm) {
      return;
    }

    setQaaGeneratorNotice(null);
    qaaGeneratorUpdateMutation.mutate(qaaGeneratorForm.token);
  }

  function clearQaaGeneratorToken(): void {
    setQaaGeneratorNotice(null);
    setQaaGeneratorField("token", EMPTY_VALUE);
    qaaGeneratorUpdateMutation.mutate(EMPTY_VALUE);
  }

  function renderAgentStatus(): ReactNode {
    if (!hasEnabledAgentPlugins) {
      return null;
    }

    if (discoveryQuery.isLoading) {
      return (
        <Stack align="center" gap="sm" py="md">
          <Loader size="lg" />
          <Text c="dimmed">{SettingsPanelCopy.AGENT_LOADING}</Text>
        </Stack>
      );
    }

    if (discoveryQuery.isError) {
      return (
        <Alert color="red" icon={<IconAlertCircle size={ALERT_ICON_SIZE_PX} />} title={SettingsPanelCopy.AGENT_ERROR}>
          <Stack gap="sm">
            <Text>
              {discoveryQuery.error instanceof Error
                ? discoveryQuery.error.message
                : SettingsPanelCopy.AGENT_ERROR}
            </Text>
            <Group>
              <Button
                leftSection={<IconRotateClockwise size={RETRY_ICON_SIZE_PX} />}
                onClick={() => void discoveryQuery.refetch()}
              >
                {SettingsPanelCopy.AGENT_RETRY}
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
          icon={<IconPlugConnectedX size={ALERT_ICON_SIZE_PX} />}
          title={SettingsPanelCopy.AGENT_UNAVAILABLE_TITLE}
        >
          <Stack gap="sm">
            <Text>{SettingsPanelCopy.AGENT_UNAVAILABLE_BODY}</Text>
            <Text c="dimmed" size="sm">
              {SettingsPanelCopy.AGENT_UNAVAILABLE_PORTS} {getConfiguredAgentPorts().join(", ")}
            </Text>
            <Group>
              <Button
                leftSection={<IconRotateClockwise size={RETRY_ICON_SIZE_PX} />}
                onClick={() => void discoveryQuery.refetch()}
                variant="light"
              >
                {SettingsPanelCopy.AGENT_RETRY}
              </Button>
            </Group>
          </Stack>
        </Alert>
      );
    }

    if (agentSettingsQuery.isLoading) {
      return (
        <Stack align="center" gap="sm" py="md">
          <Loader size="lg" />
          <Text c="dimmed">{SettingsPanelCopy.AGENT_SETTINGS_LOADING}</Text>
        </Stack>
      );
    }

    if (agentSettingsQuery.isError) {
      return (
        <Alert color="red" icon={<IconAlertCircle size={ALERT_ICON_SIZE_PX} />} title={SettingsPanelCopy.AGENT_ERROR}>
          {agentSettingsQuery.error instanceof Error
            ? agentSettingsQuery.error.message
            : SettingsPanelCopy.AGENT_ERROR}
        </Alert>
      );
    }

    return null;
  }

  return (
    <Stack gap="lg">
      <div>
        <Title order={PAGE_TITLE_ORDER}>{SettingsPanelCopy.TITLE}</Title>
        <Text c="dimmed">{SettingsPanelCopy.SECTION_DESCRIPTION}</Text>
      </div>

      {renderAgentStatus()}

      {!hasVisiblePluginSettings ? (
        <Alert title={SettingsPanelCopy.TITLE}>{SettingsPanelCopy.EMPTY_STATE}</Alert>
      ) : null}

      {showJenkins ? (
        <CardShell
          description={SettingsPanelCopy.JENKINS_DESCRIPTION}
          title={SettingsPanelCopy.JENKINS_TITLE}
        >
          <NoticeAlert notice={jenkinsNotice} successTitle={SettingsPanelCopy.UPDATE_SUCCESS} />
          {agentForm ? (
            <Stack gap="md">
              <SimpleGrid cols={FORM_COLUMNS}>
                <TextInput
                  label={SettingsPanelCopy.JENKINS_URL_LABEL}
                  onChange={(event) => setAgentField("jenkinsUrl", event.currentTarget.value)}
                  value={agentForm.jenkinsUrl}
                />
                <TextInput
                  label={SettingsPanelCopy.JENKINS_USERNAME_LABEL}
                  onChange={(event) => setAgentField("jenkinsUsername", event.currentTarget.value)}
                  value={agentForm.jenkinsUsername}
                />
                <PasswordInput
                  autoComplete={SECRET_INPUT_AUTOCOMPLETE}
                  description={agentForm.jenkinsTokenSet ? SettingsPanelCopy.SECRET_SET : SettingsPanelCopy.NOT_SET}
                  label={SettingsPanelCopy.JENKINS_TOKEN_LABEL}
                  name={SECRET_INPUT_NAME.JENKINS_TOKEN}
                  onChange={(event) => {
                    setAgentField("jenkinsToken", event.currentTarget.value);
                    setAgentField("jenkinsTokenDirty", true);
                  }}
                  value={agentForm.jenkinsToken}
                />
              </SimpleGrid>
              <Group justify="space-between">
                <Button
                  onClick={() => {
                    setAgentField("jenkinsToken", EMPTY_VALUE);
                    setAgentField("jenkinsTokenDirty", true);
                    setAgentField("jenkinsTokenSet", false);
                  }}
                  variant="default"
                >
                  {SettingsPanelCopy.CLEAR_SECRET}
                </Button>
                <Button loading={jenkinsUpdateMutation.isPending} onClick={saveJenkinsSettings}>
                  {SettingsPanelCopy.JENKINS_SAVE}
                </Button>
              </Group>
            </Stack>
          ) : null}
        </CardShell>
      ) : null}

      {showStagings ? (
        <CardShell
          description={SettingsPanelCopy.STAGINGS_DESCRIPTION}
          title={SettingsPanelCopy.STAGINGS_TITLE}
        >
          <NoticeAlert notice={stagingsNotice} successTitle={SettingsPanelCopy.UPDATE_SUCCESS} />
          {agentForm ? (
            <Stack gap="md">
              <SimpleGrid cols={FORM_COLUMNS}>
                <TextInput
                  label={SettingsPanelCopy.STAGINGS_KUBECONFIG_LABEL}
                  onChange={(event) => setAgentField("stagingKubeconfig", event.currentTarget.value)}
                  value={agentForm.stagingKubeconfig}
                />
                <TextInput
                  label={SettingsPanelCopy.STAGINGS_KUBECONFIG_URL_LABEL}
                  onChange={(event) => setAgentField("stagingKubeconfigUrl", event.currentTarget.value)}
                  value={agentForm.stagingKubeconfigUrl}
                />
              </SimpleGrid>
              <Group justify="flex-end">
                <Button loading={stagingsUpdateMutation.isPending} onClick={saveStagingsSettings}>
                  {SettingsPanelCopy.STAGINGS_SAVE}
                </Button>
              </Group>
            </Stack>
          ) : null}
        </CardShell>
      ) : null}

      {showKuber ? (
        <CardShell
          description={SettingsPanelCopy.KUBER_DESCRIPTION}
          title={SettingsPanelCopy.KUBER_TITLE}
        >
          <NoticeAlert notice={kuberNotice} successTitle={SettingsPanelCopy.UPDATE_SUCCESS} />
          {agentForm ? (
            <Stack gap="md">
              <TextInput
                label={SettingsPanelCopy.KUBER_KUBECONFIG_LABEL}
                onChange={(event) => setAgentField("kubeconfig", event.currentTarget.value)}
                value={agentForm.kubeconfig}
              />
              <Group justify="flex-end">
                <Button loading={kuberUpdateMutation.isPending} onClick={saveKuberSettings}>
                  {SettingsPanelCopy.KUBER_SAVE}
                </Button>
              </Group>
            </Stack>
          ) : null}
        </CardShell>
      ) : null}

      {showQaaGenerator && qaaGeneratorForm ? (
        <CardShell
          description={SettingsPanelCopy.QAA_GENERATOR_DESCRIPTION}
          title={SettingsPanelCopy.QAA_GENERATOR_TITLE}
        >
          <NoticeAlert notice={qaaGeneratorNotice} successTitle={SettingsPanelCopy.UPDATE_SUCCESS} />
          <Stack gap="md">
            <PasswordInput
              autoComplete={SECRET_INPUT_AUTOCOMPLETE}
              description={
                qaaGeneratorForm.tokenSet
                  ? SettingsPanelCopy.TOKEN_STATUS_SET
                  : SettingsPanelCopy.TOKEN_STATUS_NOT_SET
              }
              label={SettingsPanelCopy.QAA_GENERATOR_TOKEN_LABEL}
              name={SECRET_INPUT_NAME.QAA_GENERATOR_TOKEN}
              onChange={(event) => setQaaGeneratorField("token", event.currentTarget.value)}
              value={qaaGeneratorForm.token}
            />
            <Group justify="space-between">
              <Button
                loading={qaaGeneratorUpdateMutation.isPending}
                onClick={clearQaaGeneratorToken}
                variant="default"
              >
                {SettingsPanelCopy.CLEAR_SECRET}
              </Button>
              <Button loading={qaaGeneratorUpdateMutation.isPending} onClick={saveQaaGeneratorToken}>
                {SettingsPanelCopy.QAA_GENERATOR_SAVE}
              </Button>
            </Group>
          </Stack>
        </CardShell>
      ) : null}
    </Stack>
  );
}
