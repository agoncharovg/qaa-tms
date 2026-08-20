import { ViewKey, type ViewKey as ViewKeyType } from "@/constants";
import { CompanionGate } from "@/plugins/companion/CompanionGate";
import { BoardPanel } from "@/plugins/jenkins/BoardPanel";
import { TreePanel } from "@/plugins/jenkins/TreePanel";
import { useAuthStore } from "@/store/authStore";

interface JenkinsSectionProps {
  mode: Extract<ViewKeyType, typeof ViewKey.JENKINS_TREE | typeof ViewKey.JENKINS_BOARD>;
}

const JenkinsSectionCopy = {
  AGENT_ERROR: "Jenkins companion status failed",
  AGENT_LOADING: "Checking the local companion app before loading Jenkins data.",
} as const;

export function JenkinsSection({ mode }: JenkinsSectionProps) {
  const token = useAuthStore((state) => state.token);
  return (
    <CompanionGate
      enabled={Boolean(token)}
      errorTitle={JenkinsSectionCopy.AGENT_ERROR}
      loadingMessage={JenkinsSectionCopy.AGENT_LOADING}
    >
      {({ agentPort }) =>
        mode === ViewKey.JENKINS_BOARD ? (
          <BoardPanel agentPort={agentPort} />
        ) : (
          <TreePanel agentPort={agentPort} />
        )
      }
    </CompanionGate>
  );
}
