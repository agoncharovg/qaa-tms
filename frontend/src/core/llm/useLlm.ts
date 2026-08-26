import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { agentClient } from "@/api/agentClient";
import type {
  LlmChatMessage,
  LlmSeedContext,
  LlmStreamMessage,
  LlmUsageEvent,
} from "@/api/types";
import {
  LlmMessageRole,
  LlmStreamEvent,
  QueryKey,
  type ToolsNamespace,
} from "@/constants";
import { useAuthStore } from "@/store/authStore";

const EMPTY_VALUE = "" as const;
const CHAT_ERROR_MESSAGE = "LLM chat failed." as const;

function appendAssistantDelta(
  messages: LlmChatMessage[],
  delta: string
): LlmChatMessage[] {
  const nextMessages = [...messages];
  const lastMessage = nextMessages.at(-1);
  if (!lastMessage || lastMessage.role !== LlmMessageRole.ASSISTANT) {
    nextMessages.push({
      content: delta,
      role: LlmMessageRole.ASSISTANT,
    });
    return nextMessages;
  }

  nextMessages[nextMessages.length - 1] = {
    ...lastMessage,
    content: `${lastMessage.content}${delta}`,
  };
  return nextMessages;
}

function dropTrailingEmptyAssistantMessage(messages: LlmChatMessage[]): LlmChatMessage[] {
  const lastMessage = messages.at(-1);
  if (!lastMessage) {
    return messages;
  }
  if (lastMessage.role !== LlmMessageRole.ASSISTANT || lastMessage.content.length > 0) {
    return messages;
  }
  return messages.slice(0, -1);
}

function extractErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : CHAT_ERROR_MESSAGE;
}

export function useLlm({
  agentPort,
  seedContext,
  toolsNamespace,
}: {
  agentPort: number;
  seedContext?: LlmSeedContext;
  toolsNamespace?: ToolsNamespace;
}) {
  const token = useAuthStore((state) => state.token);
  const abortRef = useRef<AbortController | null>(null);
  const [composerText, setComposerText] = useState<string>(EMPTY_VALUE);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [messages, setMessages] = useState<LlmChatMessage[]>([]);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [usage, setUsage] = useState<LlmUsageEvent | null>(null);

  const modelsQuery = useQuery({
    enabled: Boolean(token),
    queryFn: ({ signal }) => agentClient.getLlmModels(agentPort, token ?? EMPTY_VALUE, signal),
    queryKey: [QueryKey.LLM_MODELS, agentPort, token],
  });

  useEffect(() => {
    const nextModel = modelsQuery.data?.[0]?.label ?? null;
    if (!selectedModel) {
      setSelectedModel(nextModel);
      return;
    }
    const hasSelectedModel = modelsQuery.data?.some((model) => model.label === selectedModel);
    if (!hasSelectedModel) {
      setSelectedModel(nextModel);
    }
  }, [modelsQuery.data, selectedModel]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  async function sendMessage(): Promise<void> {
    const trimmedText = composerText.trim();
    if (!token || !selectedModel || !trimmedText || isStreaming) {
      return;
    }

    const userMessage: LlmChatMessage = {
      content: trimmedText,
      role: LlmMessageRole.USER,
    };
    const requestMessages = [...messages, userMessage];
    const nextMessages = [
      ...requestMessages,
      {
        content: EMPTY_VALUE,
        role: LlmMessageRole.ASSISTANT,
      },
    ];
    const abortController = new AbortController();
    abortRef.current?.abort();
    abortRef.current = abortController;

    setComposerText(EMPTY_VALUE);
    setErrorMessage(null);
    setIsStreaming(true);
    setMessages(nextMessages);
    setUsage(null);

    try {
      await agentClient.streamLlmChat(
        agentPort,
        token,
        {
          messages: requestMessages,
          model: selectedModel,
          seedContext,
          toolsNamespace,
        },
        (message) => handleStreamMessage(message),
        abortController.signal
      );
    } catch (error) {
      setMessages((currentMessages) =>
        dropTrailingEmptyAssistantMessage(currentMessages)
      );
      setErrorMessage(extractErrorMessage(error));
      setIsStreaming(false);
    }
  }

  function handleStreamMessage(message: LlmStreamMessage): void {
    if (message.event === LlmStreamEvent.TEXT_DELTA) {
      setMessages((currentMessages) =>
        appendAssistantDelta(currentMessages, message.data.delta)
      );
      return;
    }

    if (message.event === LlmStreamEvent.USAGE) {
      setUsage(message.data);
      return;
    }

    if (message.event === LlmStreamEvent.ERROR) {
      setErrorMessage(message.data.message);
      setIsStreaming(false);
      return;
    }

    if (message.event === LlmStreamEvent.DONE) {
      setIsStreaming(false);
    }
  }

  return {
    composerText,
    errorMessage,
    isStreaming,
    messages,
    models: modelsQuery.data ?? [],
    modelsQuery,
    selectedModel,
    sendMessage,
    setComposerText,
    setSelectedModel,
    usage,
  };
}
