import { CompanionGate } from "@/plugins/companion/CompanionGate";
import { NotificationsPanel } from "@/plugins/notificator/NotificationsPanel";
import { useAuthStore } from "@/store/authStore";

const NOTIFICATOR_SECTION_COPY = {
  AGENT_ERROR: "Notificator companion discovery failed",
  AGENT_LOADING: "Checking the local companion app before loading Notificator.",
} as const;

function NotificatorAgentSection({ port }: { port: number }) {
  return <NotificationsPanel agentPort={port} />;
}

export function NotificatorSection() {
  const token = useAuthStore((state) => state.token);

  return (
    <CompanionGate
      enabled={Boolean(token)}
      errorTitle={NOTIFICATOR_SECTION_COPY.AGENT_ERROR}
      loadingMessage={NOTIFICATOR_SECTION_COPY.AGENT_LOADING}
    >
      {({ agentPort }) => <NotificatorAgentSection port={agentPort} />}
    </CompanionGate>
  );
}
