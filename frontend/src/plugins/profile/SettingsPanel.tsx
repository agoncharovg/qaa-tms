import { useEffect, useState, type ReactNode } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  NumberInput,
  Select,
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
import {
  LlmProvider,
  PluginId,
  QueryKey,
  type PluginId as PluginIdType,
} from "@/constants";
import { CompanionGate } from "@/plugins/companion/CompanionGate";
import { usePluginsContext } from "@/plugins/context";
import { useAuthStore } from "@/store/authStore";

const SettingsPanelCopy = {
  AGENT_ERROR: "Companion settings failed to load",
  AGENT_LOADING: "Checking the local companion app.",
  AGENT_SETTINGS_LOADING: "Loading companion settings.",
  ASSISTANT_ADD_MODEL: "Add model",
  ASSISTANT_ANTHROPIC_BADGE: "Anthropic key configured",
  ASSISTANT_ANTHROPIC_CLEAR: "Clear Anthropic key",
  ASSISTANT_ANTHROPIC_KEY_LABEL: "Anthropic API key",
  ASSISTANT_DESCRIPTION:
    "Your personal LLM provider keys and model catalog are written to the local companion `.env` on this machine.",
  ASSISTANT_MAX_TOKENS_LABEL: "Max tokens",
  ASSISTANT_MODELS_LABEL: "Models",
  ASSISTANT_MODEL_ID_LABEL: "Model ID",
  ASSISTANT_MODEL_LABEL: "Label",
  ASSISTANT_NO_MODELS: "No Assistant models configured yet.",
  ASSISTANT_OPENAI_BADGE: "OpenAI key configured",
  ASSISTANT_OPENAI_CLEAR: "Clear OpenAI key",
  ASSISTANT_OPENAI_KEY_LABEL: "OpenAI API key",
  ASSISTANT_PRIVACY_NOTE:
    "Pod data and chat messages sent through Assistant go directly from this machine to the selected provider.",
  ASSISTANT_PROVIDER_ANTHROPIC: "Anthropic",
  ASSISTANT_PROVIDER_LABEL: "Provider",
  ASSISTANT_PROVIDER_OPENAI: "OpenAI",
  ASSISTANT_REASONING_EFFORT_HIGH: "High",
  ASSISTANT_REASONING_EFFORT_LABEL: "Reasoning effort",
  ASSISTANT_REASONING_EFFORT_LOW: "Low",
  ASSISTANT_REASONING_EFFORT_MEDIUM: "Medium",
  ASSISTANT_REMOVE_MODEL: "Remove model",
  ASSISTANT_SAVE: "Save Assistant settings",
  ASSISTANT_TITLE: "Assistant",
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
  KUBER_KUBECONFIG_DESCRIPTION:
    "Leave empty to inherit ambient kubeconfig resolution (the KUBECONFIG env and/or ~/.kube/config), merged with the active-path symlink. Set a file to use it explicitly, or a directory to merge every *.yaml/*.yml inside it.",
  KUBER_KUBECONFIG_LABEL: "Kubeconfig path",
  KUBER_SAVE: "Save Kuber settings",
  KUBER_TITLE: "Kuber",
  LOADING: "Loading settings.",
  QAA_GENERATOR_DESCRIPTION:
    "Your personal qaa-generator token is written to the local companion `.env` on this machine.",
  QAA_GENERATOR_SAVE: "Save qaa-generator token",
  QAA_GENERATOR_TITLE: "QAA generator",
  QAA_GENERATOR_TOKEN_LABEL: "Personal token",
  NOTEBOOK_DESCRIPTION:
    "Your personal notebook stays in local files under this folder. The companion reads and writes them on this machine only, and they never leave this machine.",
  NOTEBOOK_ROOT_LABEL: "Notebook folder path",
  NOTEBOOK_SAVE: "Save Notebook settings",
  NOTEBOOK_TITLE: "Notebook",
  SECTION_DESCRIPTION:
    "Edit only the personal credentials required by the plugins enabled for your account.",
  TITLE: "Settings",
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
  ASSISTANT_ANTHROPIC_KEY: "assistant-anthropic-key",
  ASSISTANT_OPENAI_KEY: "assistant-openai-key",
  JENKINS_TOKEN: "jenkins-personal-token",
  QAA_GENERATOR_TOKEN: "qaa-generator-personal-token",
} as const;

const EMPTY_LLM_REASONING_EFFORT = "" as const;
const LLM_MODEL_MIN_VALUE = 0 as const;

const LLM_REASONING_EFFORT = {
  HIGH: "high",
  LOW: "low",
  MEDIUM: "medium",
  NONE: EMPTY_LLM_REASONING_EFFORT,
} as const;

type LlmReasoningEffort =
  (typeof LLM_REASONING_EFFORT)[keyof typeof LLM_REASONING_EFFORT];

type LlmModelDraft = {
  label: string;
  maxTokens: number | "";
  modelId: string;
  provider: (typeof LlmProvider)[keyof typeof LlmProvider];
  reasoningEffort: LlmReasoningEffort;
};

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
  llmAnthropicKey: string;
  llmAnthropicKeyDirty: boolean;
  llmAnthropicKeySet: boolean;
  llmModels: LlmModelDraft[];
  llmOpenaiKey: string;
  llmOpenaiKeyDirty: boolean;
  llmOpenaiKeySet: boolean;
  notebookRoot: string;
  stagingKubeconfig: string;
  stagingKubeconfigUrl: string;
};

type QaaGeneratorFormState = {
  token: string;
  tokenSet: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isLlmProviderValue(
  value: unknown
): value is (typeof LlmProvider)[keyof typeof LlmProvider] {
  return value === LlmProvider.ANTHROPIC || value === LlmProvider.OPENAI;
}

function isLlmReasoningEffortValue(value: unknown): value is LlmReasoningEffort {
  return (
    value === LLM_REASONING_EFFORT.NONE ||
    value === LLM_REASONING_EFFORT.LOW ||
    value === LLM_REASONING_EFFORT.MEDIUM ||
    value === LLM_REASONING_EFFORT.HIGH
  );
}

function buildEmptyLlmModelDraft(): LlmModelDraft {
  return {
    label: EMPTY_VALUE,
    maxTokens: EMPTY_VALUE,
    modelId: EMPTY_VALUE,
    provider: LlmProvider.ANTHROPIC,
    reasoningEffort: LLM_REASONING_EFFORT.NONE,
  };
}

function parseAssistantModels(rawValue: string): LlmModelDraft[] {
  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap((item) => {
      if (!isRecord(item)) {
        return [];
      }

      const params = isRecord(item.params) ? item.params : null;
      const reasoningEffort = params?.reasoning_effort;
      const maxTokens = params?.max_tokens;
      const provider = isLlmProviderValue(item.provider)
        ? item.provider
        : LlmProvider.ANTHROPIC;

      return [
        {
          label: typeof item.label === "string" ? item.label : EMPTY_VALUE,
          maxTokens: typeof maxTokens === "number" ? maxTokens : EMPTY_VALUE,
          modelId: typeof item.model_id === "string" ? item.model_id : EMPTY_VALUE,
          provider,
          reasoningEffort: isLlmReasoningEffortValue(reasoningEffort)
            ? reasoningEffort
            : LLM_REASONING_EFFORT.NONE,
        },
      ];
    });
  } catch {
    return [];
  }
}

function serializeAssistantModels(models: LlmModelDraft[]): string {
  return JSON.stringify(
    models.flatMap((model) => {
      const label = model.label.trim();
      const modelId = model.modelId.trim();
      if (!label || !modelId) {
        return [];
      }

      const params: Record<string, number | string> = {};
      if (model.reasoningEffort) {
        params.reasoning_effort = model.reasoningEffort;
      }
      if (typeof model.maxTokens === "number") {
        params.max_tokens = model.maxTokens;
      }

      const payload: Record<string, unknown> = {
        label,
        model_id: modelId,
        provider: model.provider,
      };
      if (Object.keys(params).length > 0) {
        payload.params = params;
      }
      return [payload];
    })
  );
}

function buildAgentFormState(settings: AgentSettings): AgentFormState {
  return {
    jenkinsToken: EMPTY_VALUE,
    jenkinsTokenDirty: false,
    jenkinsTokenSet: settings.jenkins_token_set,
    jenkinsUrl: settings.jenkins_url,
    jenkinsUsername: settings.jenkins_username,
    kubeconfig: settings.kubeconfig,
    llmAnthropicKey: EMPTY_VALUE,
    llmAnthropicKeyDirty: false,
    llmAnthropicKeySet: settings.llm_anthropic_key_set,
    llmModels: parseAssistantModels(settings.llm_models),
    llmOpenaiKey: EMPTY_VALUE,
    llmOpenaiKeyDirty: false,
    llmOpenaiKeySet: settings.llm_openai_key_set,
    notebookRoot: settings.notebook_root,
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
  showAssistant,
  showJenkins,
  showKuber,
  showNotebook,
  showQaaGenerator,
  showStagings,
  token,
}: {
  agentPort: number;
  showAssistant: boolean;
  showJenkins: boolean;
  showKuber: boolean;
  showNotebook: boolean;
  showQaaGenerator: boolean;
  showStagings: boolean;
  token: string;
}) {
  const queryClient = useQueryClient();
  const [agentForm, setAgentForm] = useState<AgentFormState | null>(null);
  const [assistantNotice, setAssistantNotice] = useState<Notice | null>(null);
  const [jenkinsNotice, setJenkinsNotice] = useState<Notice | null>(null);
  const [notebookNotice, setNotebookNotice] = useState<Notice | null>(null);
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
  const assistantUpdateMutation = useMutation({
    mutationFn: async (payload: AgentSettingsUpdate) => {
      return agentClient.updateSettings(agentPort, token, payload);
    },
    onSuccess: async (updatedSettings) => {
      setAgentForm(buildAgentFormState(updatedSettings));
      setAssistantNotice({
        message: SettingsPanelCopy.UPDATE_SUCCESS,
        status: NoticeStatus.SUCCESS,
      });
      await queryClient.invalidateQueries({ queryKey: [QueryKey.AGENT_SETTINGS] });
    },
    onError: (error) => {
      setAssistantNotice({
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

  const notebookUpdateMutation = useMutation({
    mutationFn: async (payload: AgentSettingsUpdate) => {
      return agentClient.updateSettings(agentPort, token, payload);
    },
    onSuccess: async (updatedSettings) => {
      setAgentForm(buildAgentFormState(updatedSettings));
      setNotebookNotice({
        message: SettingsPanelCopy.UPDATE_SUCCESS,
        status: NoticeStatus.SUCCESS,
      });
      await queryClient.invalidateQueries({ queryKey: [QueryKey.AGENT_SETTINGS] });
    },
    onError: (error) => {
      setNotebookNotice({
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

  function setAssistantModelField<Key extends keyof LlmModelDraft>(
    index: number,
    key: Key,
    value: LlmModelDraft[Key]
  ): void {
    setAgentForm((currentForm) => {
      if (!currentForm) {
        return currentForm;
      }

      const nextModels = [...currentForm.llmModels];
      const currentModel = nextModels[index];
      if (!currentModel) {
        return currentForm;
      }
      nextModels[index] = {
        ...currentModel,
        [key]: value,
      };
      return {
        ...currentForm,
        llmModels: nextModels,
      };
    });
  }

  function addAssistantModel(): void {
    setAgentForm((currentForm) => {
      if (!currentForm) {
        return currentForm;
      }

      return {
        ...currentForm,
        llmModels: [...currentForm.llmModels, buildEmptyLlmModelDraft()],
      };
    });
  }

  function removeAssistantModel(index: number): void {
    setAgentForm((currentForm) => {
      if (!currentForm) {
        return currentForm;
      }

      return {
        ...currentForm,
        llmModels: currentForm.llmModels.filter((_, currentIndex) => currentIndex !== index),
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

  function saveAssistantSettings(): void {
    if (!agentForm) {
      return;
    }

    setAssistantNotice(null);
    const payload: AgentSettingsUpdate = {
      llm_models: serializeAssistantModels(agentForm.llmModels),
    };
    if (agentForm.llmAnthropicKeyDirty) {
      payload.llm_anthropic_key = agentForm.llmAnthropicKey;
    }
    if (agentForm.llmOpenaiKeyDirty) {
      payload.llm_openai_key = agentForm.llmOpenaiKey;
    }
    assistantUpdateMutation.mutate(payload);
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

  function saveNotebookSettings(): void {
    if (!agentForm) {
      return;
    }

    setNotebookNotice(null);
    notebookUpdateMutation.mutate({
      notebook_root: agentForm.notebookRoot,
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
                  label={SettingsPanelCopy.JENKINS_TOKEN_LABEL}
                  placeholder={agentForm.jenkinsTokenSet ? "••••••••" : undefined}
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

      {showAssistant ? (
        <CardShell
          description={SettingsPanelCopy.ASSISTANT_DESCRIPTION}
          title={SettingsPanelCopy.ASSISTANT_TITLE}
        >
          <NoticeAlert notice={assistantNotice} successTitle={SettingsPanelCopy.UPDATE_SUCCESS} />
          {agentForm ? (
            <Stack gap="md">
              <Text c="dimmed" size="sm">
                {SettingsPanelCopy.ASSISTANT_PRIVACY_NOTE}
              </Text>
              <Group gap="xs">
                {agentForm.llmAnthropicKeySet ? (
                  <Badge variant="light">{SettingsPanelCopy.ASSISTANT_ANTHROPIC_BADGE}</Badge>
                ) : null}
                {agentForm.llmOpenaiKeySet ? (
                  <Badge variant="light">{SettingsPanelCopy.ASSISTANT_OPENAI_BADGE}</Badge>
                ) : null}
              </Group>
              <PasswordInput
                autoComplete={SECRET_INPUT_AUTOCOMPLETE}
                label={SettingsPanelCopy.ASSISTANT_ANTHROPIC_KEY_LABEL}
                name={SECRET_INPUT_NAME.ASSISTANT_ANTHROPIC_KEY}
                onChange={(event) => {
                  setAgentField("llmAnthropicKey", event.currentTarget.value);
                  setAgentField("llmAnthropicKeyDirty", true);
                }}
                placeholder={agentForm.llmAnthropicKeySet ? "••••••••" : undefined}
                value={agentForm.llmAnthropicKey}
              />
              <Group justify="flex-start">
                <Button
                  onClick={() => {
                    setAgentField("llmAnthropicKey", EMPTY_VALUE);
                    setAgentField("llmAnthropicKeyDirty", true);
                    setAgentField("llmAnthropicKeySet", false);
                  }}
                  variant="default"
                >
                  {SettingsPanelCopy.ASSISTANT_ANTHROPIC_CLEAR}
                </Button>
              </Group>
              <PasswordInput
                autoComplete={SECRET_INPUT_AUTOCOMPLETE}
                label={SettingsPanelCopy.ASSISTANT_OPENAI_KEY_LABEL}
                name={SECRET_INPUT_NAME.ASSISTANT_OPENAI_KEY}
                onChange={(event) => {
                  setAgentField("llmOpenaiKey", event.currentTarget.value);
                  setAgentField("llmOpenaiKeyDirty", true);
                }}
                placeholder={agentForm.llmOpenaiKeySet ? "••••••••" : undefined}
                value={agentForm.llmOpenaiKey}
              />
              <Group justify="flex-start">
                <Button
                  onClick={() => {
                    setAgentField("llmOpenaiKey", EMPTY_VALUE);
                    setAgentField("llmOpenaiKeyDirty", true);
                    setAgentField("llmOpenaiKeySet", false);
                  }}
                  variant="default"
                >
                  {SettingsPanelCopy.ASSISTANT_OPENAI_CLEAR}
                </Button>
              </Group>
              <Stack gap="sm">
                <Text fw={500} size="sm">
                  {SettingsPanelCopy.ASSISTANT_MODELS_LABEL}
                </Text>
                {agentForm.llmModels.length === 0 ? (
                  <Text c="dimmed" size="sm">
                    {SettingsPanelCopy.ASSISTANT_NO_MODELS}
                  </Text>
                ) : null}
                {agentForm.llmModels.map((model, index) => (
                  <Card key={`assistant-model-${index}`} padding="sm" radius="md" withBorder>
                    <Stack gap="sm">
                      <SimpleGrid cols={FORM_COLUMNS}>
                        <TextInput
                          label={SettingsPanelCopy.ASSISTANT_MODEL_LABEL}
                          onChange={(event) =>
                            setAssistantModelField(index, "label", event.currentTarget.value)
                          }
                          value={model.label}
                        />
                        <Select
                          data={[
                            {
                              label: SettingsPanelCopy.ASSISTANT_PROVIDER_ANTHROPIC,
                              value: LlmProvider.ANTHROPIC,
                            },
                            {
                              label: SettingsPanelCopy.ASSISTANT_PROVIDER_OPENAI,
                              value: LlmProvider.OPENAI,
                            },
                          ]}
                          label={SettingsPanelCopy.ASSISTANT_PROVIDER_LABEL}
                          onChange={(value) => {
                            if (value === LlmProvider.ANTHROPIC || value === LlmProvider.OPENAI) {
                              setAssistantModelField(index, "provider", value);
                            }
                          }}
                          value={model.provider}
                        />
                        <TextInput
                          label={SettingsPanelCopy.ASSISTANT_MODEL_ID_LABEL}
                          onChange={(event) =>
                            setAssistantModelField(index, "modelId", event.currentTarget.value)
                          }
                          value={model.modelId}
                        />
                        <NumberInput
                          allowNegative={false}
                          label={SettingsPanelCopy.ASSISTANT_MAX_TOKENS_LABEL}
                          min={LLM_MODEL_MIN_VALUE}
                          onChange={(value) => {
                            setAssistantModelField(
                              index,
                              "maxTokens",
                              typeof value === "number" ? value : EMPTY_VALUE
                            );
                          }}
                          value={model.maxTokens}
                        />
                        <Select
                          clearable
                          data={[
                            {
                              label: SettingsPanelCopy.ASSISTANT_REASONING_EFFORT_LOW,
                              value: LLM_REASONING_EFFORT.LOW,
                            },
                            {
                              label: SettingsPanelCopy.ASSISTANT_REASONING_EFFORT_MEDIUM,
                              value: LLM_REASONING_EFFORT.MEDIUM,
                            },
                            {
                              label: SettingsPanelCopy.ASSISTANT_REASONING_EFFORT_HIGH,
                              value: LLM_REASONING_EFFORT.HIGH,
                            },
                          ]}
                          label={SettingsPanelCopy.ASSISTANT_REASONING_EFFORT_LABEL}
                          onChange={(value) =>
                            setAssistantModelField(
                              index,
                              "reasoningEffort",
                              isLlmReasoningEffortValue(value)
                                ? value
                                : LLM_REASONING_EFFORT.NONE
                            )
                          }
                          value={model.reasoningEffort || null}
                        />
                      </SimpleGrid>
                      <Group justify="flex-end">
                        <Button
                          onClick={() => removeAssistantModel(index)}
                          variant="default"
                        >
                          {SettingsPanelCopy.ASSISTANT_REMOVE_MODEL}
                        </Button>
                      </Group>
                    </Stack>
                  </Card>
                ))}
                <Group justify="space-between">
                  <Button onClick={addAssistantModel} variant="default">
                    {SettingsPanelCopy.ASSISTANT_ADD_MODEL}
                  </Button>
                  <Button
                    loading={assistantUpdateMutation.isPending}
                    onClick={saveAssistantSettings}
                  >
                    {SettingsPanelCopy.ASSISTANT_SAVE}
                  </Button>
                </Group>
              </Stack>
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

      {showNotebook ? (
        <CardShell
          description={SettingsPanelCopy.NOTEBOOK_DESCRIPTION}
          title={SettingsPanelCopy.NOTEBOOK_TITLE}
        >
          <NoticeAlert notice={notebookNotice} successTitle={SettingsPanelCopy.UPDATE_SUCCESS} />
          {agentForm ? (
            <Stack gap="md">
              <TextInput
                label={SettingsPanelCopy.NOTEBOOK_ROOT_LABEL}
                onChange={(event) => setAgentField("notebookRoot", event.currentTarget.value)}
                value={agentForm.notebookRoot}
              />
              <Group justify="flex-end">
                <Button loading={notebookUpdateMutation.isPending} onClick={saveNotebookSettings}>
                  {SettingsPanelCopy.NOTEBOOK_SAVE}
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
              label={SettingsPanelCopy.QAA_GENERATOR_TOKEN_LABEL}
              placeholder={qaaGeneratorForm.tokenSet ? "••••••••" : undefined}
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
  const showNotebook = enabledPluginIds.has(PluginId.NOTEBOOK);
  const showStagings = enabledPluginIds.has(PluginId.STAGINGS);
  const showKuber = enabledPluginIds.has(PluginId.KUBER);
  const showAssistant = enabledPluginIds.has(PluginId.ASSISTANT);
  const showQaaGenerator = enabledPluginIds.has(PluginId.QAA_GENERATOR);
  const hasEnabledAgentPlugins =
    showAssistant ||
    showJenkins ||
    showNotebook ||
    showStagings ||
    showKuber ||
    showQaaGenerator;
  const hasVisiblePluginSettings = hasEnabledAgentPlugins;

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
              showAssistant={showAssistant}
              showJenkins={showJenkins}
              showKuber={showKuber}
              showNotebook={showNotebook}
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
