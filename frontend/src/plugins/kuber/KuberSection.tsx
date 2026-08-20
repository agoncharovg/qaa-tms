import { ViewKey, type ViewKey as ViewKeyType } from "@/constants";
import { CompanionGate } from "@/plugins/companion/CompanionGate";
import { ClustersPanel } from "@/plugins/kuber/ClustersPanel";
import { PodsPanel } from "@/plugins/kuber/PodsPanel";
import { useAuthStore } from "@/store/authStore";

interface KuberSectionProps {
  mode: Extract<ViewKeyType, typeof ViewKey.KUBE_CLUSTERS | typeof ViewKey.KUBE_PODS>;
}

const KuberSectionCopy = {
  AGENT_ERROR: "Kuber agent discovery failed",
  AGENT_LOADING: "Checking the local companion app before loading Kubernetes data.",
} as const;

export function KuberSection({ mode }: KuberSectionProps) {
  const token = useAuthStore((state) => state.token);
  return (
    <CompanionGate
      enabled={Boolean(token)}
      errorTitle={KuberSectionCopy.AGENT_ERROR}
      loadingMessage={KuberSectionCopy.AGENT_LOADING}
    >
      {({ agentPort }) =>
        mode === ViewKey.KUBE_PODS ? (
          <PodsPanel agentPort={agentPort} />
        ) : (
          <ClustersPanel agentPort={agentPort} />
        )
      }
    </CompanionGate>
  );
}
