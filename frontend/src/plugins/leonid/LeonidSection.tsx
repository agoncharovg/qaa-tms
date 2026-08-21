import { CompanionGate } from "@/plugins/companion/CompanionGate";
import { ViewKey, type ViewKey as ViewKeyType } from "@/constants";
import { ObjectsPanel } from "@/plugins/leonid/ObjectsPanel";
import { PipelineConfigsPanel } from "@/plugins/leonid/PipelineConfigsPanel";
import { SharedResourcesPanel } from "@/plugins/leonid/SharedResourcesPanel";
import { useAuthStore } from "@/store/authStore";

interface LeonidSectionProps {
  mode: Extract<
    ViewKeyType,
    typeof ViewKey.LEONID_SHARED_RESOURCES
      | typeof ViewKey.LEONID_OBJECTS
      | typeof ViewKey.LEONID_PIPELINE_CONFIGS
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
  if (mode === ViewKey.LEONID_OBJECTS) {
    return <ObjectsPanel agentPort={port} />;
  }

  if (mode === ViewKey.LEONID_PIPELINE_CONFIGS) {
    return <PipelineConfigsPanel agentPort={port} />;
  }

  return <SharedResourcesPanel agentPort={port} />;
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
