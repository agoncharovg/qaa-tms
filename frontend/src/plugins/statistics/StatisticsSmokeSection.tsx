import { CompanionGate } from "@/plugins/companion/CompanionGate";
import { SmokePanel } from "@/plugins/statistics/SmokePanel";
import { useAuthStore } from "@/store/authStore";

const StatisticsSmokeSectionCopy = {
  AGENT_ERROR: "Statistics agent discovery failed",
  AGENT_LOADING: "Checking the local companion app before loading SMOKE statistics.",
} as const;

export function StatisticsSmokeSection() {
  const token = useAuthStore((state) => state.token);
  return (
    <CompanionGate
      enabled={Boolean(token)}
      errorTitle={StatisticsSmokeSectionCopy.AGENT_ERROR}
      loadingMessage={StatisticsSmokeSectionCopy.AGENT_LOADING}
    >
      {({ agentPort }) => <SmokePanel agentPort={agentPort} />}
    </CompanionGate>
  );
}
