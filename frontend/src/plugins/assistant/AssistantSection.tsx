import { CompanionGate } from "@/plugins/companion/CompanionGate";
import { useAuthStore } from "@/store/authStore";
import { ChatPanel } from "@/core/llm/ChatPanel";

const AssistantSectionCopy = {
  AGENT_ERROR: "Assistant companion discovery failed",
  AGENT_LOADING: "Checking the local companion app before loading Assistant.",
} as const;

export function AssistantSection() {
  const token = useAuthStore((state) => state.token);

  return (
    <CompanionGate
      enabled={Boolean(token)}
      errorTitle={AssistantSectionCopy.AGENT_ERROR}
      loadingMessage={AssistantSectionCopy.AGENT_LOADING}
    >
      {({ agentPort }) => <ChatPanel agentPort={agentPort} />}
    </CompanionGate>
  );
}
