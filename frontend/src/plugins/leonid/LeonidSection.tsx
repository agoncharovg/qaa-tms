import { CompanionGate } from "@/plugins/companion/CompanionGate";
import { ViewKey, type ViewKey as ViewKeyType } from "@/constants";
import { DeployGatePanel } from "@/plugins/leonid/DeployGatePanel";
import { ReportPanel } from "@/plugins/leonid/ReportPanel";
import { useAuthStore } from "@/store/authStore";

interface LeonidSectionProps {
  mode: Extract<
    ViewKeyType,
    typeof ViewKey.LEONID_DEPLOY | typeof ViewKey.LEONID_REPORT
  >;
}

const LEONID_SECTION_COPY = {
  AGENT_ERROR: "Leonid companion discovery failed",
  AGENT_LOADING: "Checking the local companion app before loading Leonid.",
} as const;

function LeonidAgentSection({
  mode,
  port,
}: {
  mode: LeonidSectionProps["mode"];
  port: number;
}) {
  if (mode === ViewKey.LEONID_REPORT) {
    return <ReportPanel agentPort={port} />;
  }

  return <DeployGatePanel agentPort={port} />;
}

export function LeonidSection({ mode }: LeonidSectionProps) {
  const token = useAuthStore((state) => state.token);

  return (
    <CompanionGate
      enabled={Boolean(token)}
      errorTitle={LEONID_SECTION_COPY.AGENT_ERROR}
      loadingMessage={LEONID_SECTION_COPY.AGENT_LOADING}
    >
      {({ agentPort }) => <LeonidAgentSection mode={mode} port={agentPort} />}
    </CompanionGate>
  );
}
