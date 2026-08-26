import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Paper,
  Select,
  Stack,
  Text,
  Textarea,
  Title,
} from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";

import type { LlmSeedContext } from "@/api/types";
import { LlmMessageRole, type ToolsNamespace } from "@/constants";
import { useLlm } from "@/core/llm/useLlm";

const ChatPanelCopy = {
  EMPTY_CHAT: "Ask a question to start the conversation.",
  INPUT_LABEL: "Message",
  INPUT_PLACEHOLDER: "Ask the Assistant",
  LOADING_MODELS: "Loading models.",
  MODELS_LABEL: "Model",
  NO_MODELS: "No Assistant models are configured on this machine yet.",
  PRIVACY_WARNING:
    "Messages are sent from this machine directly to the selected LLM provider using your personal API key.",
  SEED_CONTEXT_TITLE: "Seed context",
  SEND: "Send",
  UNKNOWN_USAGE_VALUE: "?",
  TOOL_ACTIVITY_PLACEHOLDER: "Tool activity is unavailable in Phase 1.",
  USER_LABEL: "You",
  USAGE_PREFIX: "Usage",
  ASSISTANT_ERROR_TITLE: "Assistant error",
  ASSISTANT_LABEL: "Assistant",
} as const;

const CHAT_CARD_RADIUS = "lg" as const;
const CHAT_CARD_SHADOW = "sm" as const;
const ERROR_ICON_SIZE_PX = 18 as const;
const PANEL_TITLE_ORDER = 3 as const;
const TEXTAREA_MIN_ROWS = 4 as const;

function buildSeedBadges(seedContext?: LlmSeedContext): Array<{ key: string; value: string }> {
  if (!seedContext) {
    return [];
  }

  const badges: Array<{ key: string; value: string }> = [];
  if (seedContext.context) {
    badges.push({ key: "context", value: seedContext.context });
  }
  if (seedContext.namespace) {
    badges.push({ key: "namespace", value: seedContext.namespace });
  }
  if (seedContext.pod) {
    badges.push({ key: "pod", value: seedContext.pod });
  }
  return badges;
}

export function ChatPanel({
  agentPort,
  seedContext,
  toolsNamespace,
}: {
  agentPort: number;
  seedContext?: LlmSeedContext;
  toolsNamespace?: ToolsNamespace;
}) {
  const {
    composerText,
    errorMessage,
    isStreaming,
    messages,
    models,
    modelsQuery,
    selectedModel,
    sendMessage,
    setComposerText,
    setSelectedModel,
    usage,
  } = useLlm({ agentPort, seedContext, toolsNamespace });

  const seedBadges = buildSeedBadges(seedContext);
  const modelOptions = models.map((model) => ({ label: model.label, value: model.label }));

  if (modelsQuery.isLoading) {
    return (
      <Stack align="center" gap="sm" py="md">
        <Loader size="lg" />
        <Text c="dimmed">{ChatPanelCopy.LOADING_MODELS}</Text>
      </Stack>
    );
  }

  return (
    <Card padding="lg" radius={CHAT_CARD_RADIUS} shadow={CHAT_CARD_SHADOW} withBorder>
      <Stack gap="md">
        <div>
          <Title order={PANEL_TITLE_ORDER}>Assistant</Title>
          <Text c="dimmed" size="sm">
            {ChatPanelCopy.PRIVACY_WARNING}
          </Text>
        </div>

        {modelsQuery.isError ? (
          <Alert
            color="red"
            icon={<IconAlertCircle size={ERROR_ICON_SIZE_PX} />}
            title={ChatPanelCopy.NO_MODELS}
          >
            {modelsQuery.error instanceof Error
              ? modelsQuery.error.message
              : ChatPanelCopy.NO_MODELS}
          </Alert>
        ) : null}

        {seedBadges.length > 0 ? (
          <Stack gap="xs">
            <Text fw={500} size="sm">
              {ChatPanelCopy.SEED_CONTEXT_TITLE}
            </Text>
            <Group gap="xs">
              {seedBadges.map((badge) => (
                <Badge key={`${badge.key}-${badge.value}`} variant="light">
                  {`${badge.key}: ${badge.value}`}
                </Badge>
              ))}
            </Group>
          </Stack>
        ) : null}

        <Select
          data={modelOptions}
          disabled={modelOptions.length === 0 || isStreaming}
          label={ChatPanelCopy.MODELS_LABEL}
          onChange={setSelectedModel}
          placeholder={ChatPanelCopy.NO_MODELS}
          value={selectedModel}
        />

        <Stack gap="sm">
          {messages.length === 0 ? (
            <Text c="dimmed" size="sm">
              {ChatPanelCopy.EMPTY_CHAT}
            </Text>
          ) : null}
          {messages.map((message, index) => (
            <Paper key={`${message.role}-${index}`} p="md" withBorder>
              <Stack gap="xs">
                <Text fw={600} size="sm">
                  {message.role === LlmMessageRole.USER
                    ? ChatPanelCopy.USER_LABEL
                    : ChatPanelCopy.ASSISTANT_LABEL}
                </Text>
                <Text style={{ whiteSpace: "pre-wrap" }}>
                  {message.content || (isStreaming ? "…" : "")}
                </Text>
              </Stack>
            </Paper>
          ))}
        </Stack>

        {toolsNamespace ? (
          <Text c="dimmed" size="xs">
            {ChatPanelCopy.TOOL_ACTIVITY_PLACEHOLDER}
          </Text>
        ) : null}

        {usage ? (
          <Text c="dimmed" size="xs">
            {`${ChatPanelCopy.USAGE_PREFIX}: input ${
              usage.inputTokens ?? ChatPanelCopy.UNKNOWN_USAGE_VALUE
            }, output ${usage.outputTokens ?? ChatPanelCopy.UNKNOWN_USAGE_VALUE}, total ${
              usage.totalTokens ?? ChatPanelCopy.UNKNOWN_USAGE_VALUE
            }`}
          </Text>
        ) : null}

        {errorMessage ? (
          <Alert
            color="red"
            icon={<IconAlertCircle size={ERROR_ICON_SIZE_PX} />}
            title={ChatPanelCopy.ASSISTANT_ERROR_TITLE}
          >
            {errorMessage}
          </Alert>
        ) : null}

        <Textarea
          autosize
          disabled={!selectedModel || isStreaming}
          label={ChatPanelCopy.INPUT_LABEL}
          minRows={TEXTAREA_MIN_ROWS}
          onChange={(event) => setComposerText(event.currentTarget.value)}
          placeholder={ChatPanelCopy.INPUT_PLACEHOLDER}
          value={composerText}
        />

        <Group justify="flex-end">
          <Button
            disabled={!selectedModel || composerText.trim().length === 0}
            loading={isStreaming}
            onClick={() => {
              void sendMessage();
            }}
          >
            {ChatPanelCopy.SEND}
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}
