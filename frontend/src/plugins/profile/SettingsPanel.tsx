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
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { agentClient } from "@/api/agentClient";
import type { AgentSettings, AgentSettingsUpdate } from "@/api/types";
import { usePalette } from "@/app/theme/usePalette";
import { PluginId, QueryKey, type PluginId as PluginIdType } from "@/constants";
import { CompanionGate } from "@/plugins/companion/CompanionGate";
import { usePluginsContext } from "@/plugins/context";
import { useAuthStore } from "@/store/authStore";

const SettingsPanelCopy = {
  AGENT_ERROR: "Companion settings failed to load",
  AGENT_LOADING: "Checking the local companion app.",
  AGENT_SETTINGS_LOADING: "Loading companion settings.",
  CLEAR_SECRET: "Clear stored value",
  EMPTY_STATE: "No plugin-specific settings are enabled for this user.",
  JENKINS_DESCRIPTION:
    "Your personal Jenkins credentials are written to the local companion `.env` on this machine.",
  JENKINS_SAVE: "Save Jenkins settings",
  JENKINS_TITLE: "Jenkins",
  JENKINS_TOKEN_LABEL: "Personal token",
  JENKINS_URL_LABEL: "URL",
  JENKINS_USERNAME_LABEL: "Username",
  LEONID_DESCRIPTION:
    "The shared Leonid service token is written to the local companion `.env` on this machine.",
  LEONID_SAVE: "Save Leonid settings",
  LEONID_TITLE: "Leonid",
  LEONID_TOKEN_LABEL: "Service token",
  LEONID_URL_LABEL: "Service URL",
  KUBER_DESCRIPTION:
    "Your personal kubeconfig is written to the local companion `.env` on this machine.",
  KUBER_KUBECONFIG_DESCRIPTION:
    "Leave empty to inherit ambient kubeconfig resolution (the KUBECONFIG env and/or ~/.kube/config), merged with the active-path symlink. Set a file to use it explicitly, or a directory to merge every *.yaml/*.yml inside it.",
  KUBER_KUBECONFIG_LABEL: "Kubeconfig path",
  KUBER_SAVE: "Save Kuber settings",
  KUBER_TITLE: "Kuber",
  LOADING: "Loading settings.",
  NOTIFICATOR_DESCRIPTION:
    "The shared Notificator service token is written to the local companion `.env` on this machine.",
  NOTIFICATOR_SAVE: "Save Notificator settings",
  NOTIFICATOR_TITLE: "Notificator",
  NOTIFICATOR_TOKEN_LABEL: "Service token",
  NOTIFICATOR_URL_LABEL: "Service URL",
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

const EMPTY_VALUE = "" as const;
const ALERT_ICON_SIZE_PX = 18 as const;
const CARD_TITLE_ORDER = 3 as const;
const FORM_COLUMNS = { base: 1, md: 2 } as const;
const PAGE_TITLE_ORDER = 2 as const;

const SECRET_INPUT_AUTOCOMPLETE = "new-password" as const;
const SECRET_INPUT_NAME = {
  JENKINS_TOKEN: "jenkins-personal-token",
  LEONID_TOKEN: "leonid-service-token",
  NOTIFICATOR_TOKEN: "notificator-service-token",
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
  leonidToken: string;
  leonidTokenDirty: boolean;
  leonidTokenSet: boolean;
  leonidUrl: string;
  kubeconfig: string;
  notificatorToken: string;
  notificatorTokenDirty: boolean;
  notificatorTokenSet: boolean;
  notificatorUrl: string;
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
    leonidToken: EMPTY_VALUE,
    leonidTokenDirty: false,
    leonidTokenSet: settings.leonid_token_set,
    leonidUrl: settings.leonid_url,
    kubeconfig: settings.kubeconfig,
    notificatorToken: EMPTY_VALUE,
    notificatorTokenDirty: false,
    notificatorTokenSet: settings.notificator_token_set,
    notificatorUrl: settings.notificator_url,
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

function SettingsPanelAgentSettings({
  agentPort,
  showJenkins,
  showKuber,
  showLeonid,
  showNotificator,
  showQaaGenerator,
  showStagings,
  token,
}: {
  agentPort: number;
  showJenkins: boolean;
  showKuber: boolean;
  showLeonid: boolean;
  showNotificator: boolean;
  showQaaGenerator: boolean;
  showStagings: boolean;
  token: string;
}) {
  const queryClient = useQueryClient();
  const [agentForm, setAgentForm] = useState<AgentFormState | null>(null);
  const [jenkinsNotice, setJenkinsNotice] = useState<Notice | null>(null);
  const [notificatorNotice, setNotificatorNotice] = useState<Notice | null>(null);
  const [leonidNotice, setLeonidNotice] = useState<Notice | null>(null);
  const [stagingsNotice, setStagingsNotice] = useState<Notice | null>(null);
  const [kuberNotice, setKuberNotice] = useState<Notice | null>(null);
  const [qaaGeneratorForm, setQaaGeneratorForm] = useState<QaaGeneratorFormState | null>(null);
  const [qaaGeneratorNotice, setQaaGeneratorNotice] = useState<Notice | null>(null);

  const agentSettingsQuery = useQuery({
    queryFn: ({ signal }) => agentClient.getSettings(agentPort, token, signal),
    queryKey: [QueryKey.AGENT_SETTINGS, agentPort, token],
  });

  useEffect(() => {
    if (agentSettingsQuery.data) {
      setAgentForm(buildAgentFormState(agentSettingsQuery.data));
      setQaaGeneratorForm(buildQaaGeneratorFormState(agentSettingsQuery.data));
    }
  }, [agentSettingsQuery.data]);

  const jenkinsUpdateMutation = useMutation({
    mutationFn: async (payload: AgentSettingsUpdate) => {
      return agentClient.updateSettings(agentPort, token, payload);
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

  const notificatorUpdateMutation = useMutation({
    mutationFn: async (payload: AgentSettingsUpdate) => {
      return agentClient.updateSettings(agentPort, token, payload);
    },
    onSuccess: async (updatedSettings) => {
      setAgentForm(buildAgentFormState(updatedSettings));
      setNotificatorNotice({
        message: SettingsPanelCopy.UPDATE_SUCCESS,
        status: NoticeStatus.SUCCESS,
      });
      await queryClient.invalidateQueries({ queryKey: [QueryKey.AGENT_SETTINGS] });
    },
    onError: (error) => {
      setNotificatorNotice({
        message: error instanceof Error ? error.message : SettingsPanelCopy.UPDATE_FAILED,
        status: NoticeStatus.ERROR,
      });
    },
  });

  const leonidUpdateMutation = useMutation({
    mutationFn: async (payload: AgentSettingsUpdate) => {
      return agentClient.updateSettings(agentPort, token, payload);
    },
    onSuccess: async (updatedSettings) => {
      setAgentForm(buildAgentFormState(updatedSettings));
      setLeonidNotice({
        message: SettingsPanelCopy.UPDATE_SUCCESS,
        status: NoticeStatus.SUCCESS,
      });
      await queryClient.invalidateQueries({ queryKey: [QueryKey.AGENT_SETTINGS] });
    },
    onError: (error) => {
      setLeonidNotice({
        message: error instanceof Error ? error.message : SettingsPanelCopy.UPDATE_FAILED,
        status: NoticeStatus.ERROR,
      });
    },
  });

  const stagingsUpdateMutation = useMutation({
    mutationFn: async (payload: AgentSettingsUpdate) => {
      return agentClient.updateSettings(agentPort, token, payload);
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
      return agentClient.updateSettings(agentPort, token, payload);
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
      return agentClient.updateSettings(agentPort, token, {
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

  function saveNotificatorSettings(): void {
    if (!agentForm) {
      return;
    }

    setNotificatorNotice(null);
    const payload: AgentSettingsUpdate = {
      notificator_url: agentForm.notificatorUrl,
    };
    if (agentForm.notificatorTokenDirty) {
      payload.notificator_token = agentForm.notificatorToken;
    }
    notificatorUpdateMutation.mutate(payload);
  }

  function saveLeonidSettings(): void {
    if (!agentForm) {
      return;
    }

    setLeonidNotice(null);
    const payload: AgentSettingsUpdate = {
      leonid_url: agentForm.leonidUrl,
    };
    if (agentForm.leonidTokenDirty) {
      payload.leonid_token = agentForm.leonidToken;
    }
    leonidUpdateMutation.mutate(payload);
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

  return (
    <>
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

      {showNotificator ? (
        <CardShell
          description={SettingsPanelCopy.NOTIFICATOR_DESCRIPTION}
          title={SettingsPanelCopy.NOTIFICATOR_TITLE}
        >
          <NoticeAlert notice={notificatorNotice} successTitle={SettingsPanelCopy.UPDATE_SUCCESS} />
          {agentForm ? (
            <Stack gap="md">
              <SimpleGrid cols={FORM_COLUMNS}>
                <TextInput
                  label={SettingsPanelCopy.NOTIFICATOR_URL_LABEL}
                  onChange={(event) => setAgentField("notificatorUrl", event.currentTarget.value)}
                  value={agentForm.notificatorUrl}
                />
                <PasswordInput
                  autoComplete={SECRET_INPUT_AUTOCOMPLETE}
                  description={
                    agentForm.notificatorTokenSet ? SettingsPanelCopy.SECRET_SET : SettingsPanelCopy.NOT_SET
                  }
                  label={SettingsPanelCopy.NOTIFICATOR_TOKEN_LABEL}
                  name={SECRET_INPUT_NAME.NOTIFICATOR_TOKEN}
                  onChange={(event) => {
                    setAgentField("notificatorToken", event.currentTarget.value);
                    setAgentField("notificatorTokenDirty", true);
                  }}
                  value={agentForm.notificatorToken}
                />
              </SimpleGrid>
              <Group justify="space-between">
                <Button
                  onClick={() => {
                    setAgentField("notificatorToken", EMPTY_VALUE);
                    setAgentField("notificatorTokenDirty", true);
                    setAgentField("notificatorTokenSet", false);
                  }}
                  variant="default"
                >
                  {SettingsPanelCopy.CLEAR_SECRET}
                </Button>
                <Button loading={notificatorUpdateMutation.isPending} onClick={saveNotificatorSettings}>
                  {SettingsPanelCopy.NOTIFICATOR_SAVE}
                </Button>
              </Group>
            </Stack>
          ) : null}
        </CardShell>
      ) : null}

      {showLeonid ? (
        <CardShell
          description={SettingsPanelCopy.LEONID_DESCRIPTION}
          title={SettingsPanelCopy.LEONID_TITLE}
        >
          <NoticeAlert notice={leonidNotice} successTitle={SettingsPanelCopy.UPDATE_SUCCESS} />
          {agentForm ? (
            <Stack gap="md">
              <SimpleGrid cols={FORM_COLUMNS}>
                <TextInput
                  label={SettingsPanelCopy.LEONID_URL_LABEL}
                  onChange={(event) => setAgentField("leonidUrl", event.currentTarget.value)}
                  value={agentForm.leonidUrl}
                />
                <PasswordInput
                  autoComplete={SECRET_INPUT_AUTOCOMPLETE}
                  description={agentForm.leonidTokenSet ? SettingsPanelCopy.SECRET_SET : SettingsPanelCopy.NOT_SET}
                  label={SettingsPanelCopy.LEONID_TOKEN_LABEL}
                  name={SECRET_INPUT_NAME.LEONID_TOKEN}
                  onChange={(event) => {
                    setAgentField("leonidToken", event.currentTarget.value);
                    setAgentField("leonidTokenDirty", true);
                  }}
                  value={agentForm.leonidToken}
                />
              </SimpleGrid>
              <Group justify="space-between">
                <Button
                  onClick={() => {
                    setAgentField("leonidToken", EMPTY_VALUE);
                    setAgentField("leonidTokenDirty", true);
                    setAgentField("leonidTokenSet", false);
                  }}
                  variant="default"
                >
                  {SettingsPanelCopy.CLEAR_SECRET}
                </Button>
                <Button loading={leonidUpdateMutation.isPending} onClick={saveLeonidSettings}>
                  {SettingsPanelCopy.LEONID_SAVE}
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
                description={SettingsPanelCopy.KUBER_KUBECONFIG_DESCRIPTION}
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
    </>
  );
}

export function SettingsPanel() {
  const { enabledOptionalPluginIdSet } = usePluginsContext();
  const currentUser = useAuthStore((state) => state.currentUser);
  const token = useAuthStore((state) => state.token);
  const enabledPluginIds = currentUser
    ? enabledOptionalPluginIdSet(currentUser.enabled_plugins)
    : new Set<PluginIdType>();
  const showJenkins = enabledPluginIds.has(PluginId.JENKINS);
  const showStagings = enabledPluginIds.has(PluginId.STAGINGS);
  const showKuber = enabledPluginIds.has(PluginId.KUBER);
  const showNotificator = enabledPluginIds.has(PluginId.NOTIFICATOR);
  const showLeonid = enabledPluginIds.has(PluginId.LEONID);
  const showQaaGenerator = enabledPluginIds.has(PluginId.QAA_GENERATOR);
  const hasEnabledAgentPlugins =
    showJenkins || showStagings || showKuber || showNotificator || showLeonid || showQaaGenerator;
  const hasVisiblePluginSettings = hasEnabledAgentPlugins || showQaaGenerator;

  if (!currentUser) {
    return (
      <Stack align="center" gap="sm" py="xl">
        <Loader size="lg" />
        <Text c="dimmed">{SettingsPanelCopy.LOADING}</Text>
      </Stack>
    );
  }

  return (
    <Stack gap="lg">
      <div>
        <Title order={PAGE_TITLE_ORDER}>{SettingsPanelCopy.TITLE}</Title>
        <Text c="dimmed">{SettingsPanelCopy.SECTION_DESCRIPTION}</Text>
      </div>

      {!hasVisiblePluginSettings ? (
        <Alert title={SettingsPanelCopy.TITLE}>{SettingsPanelCopy.EMPTY_STATE}</Alert>
      ) : null}

      {hasEnabledAgentPlugins ? (
        <CompanionGate
          enabled={Boolean(token)}
          errorTitle={SettingsPanelCopy.AGENT_ERROR}
          loadingMessage={SettingsPanelCopy.AGENT_LOADING}
        >
          {({ agentPort }) => (
            <SettingsPanelAgentSettings
              agentPort={agentPort}
              showJenkins={showJenkins}
              showKuber={showKuber}
              showLeonid={showLeonid}
              showNotificator={showNotificator}
              showQaaGenerator={showQaaGenerator}
              showStagings={showStagings}
              token={token ?? EMPTY_VALUE}
            />
          )}
        </CompanionGate>
      ) : null}
    </Stack>
  );
}
