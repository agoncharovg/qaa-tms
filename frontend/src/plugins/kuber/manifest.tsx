import {
  CONTRACT_VERSION,
  IconName,
  PluginId,
  PluginOrigin,
  TabId,
  TabTitle,
  ViewKey,
} from "@/constants";
import { definePlugin } from "@/core/plugins/definePlugin";
import { PluginKind } from "@/core/plugins/types";

import { KuberSection } from "@/plugins/kuber/KuberSection";

const KUBER_PLUGIN_ORDER = 15 as const;
const KUBER_PLUGIN_ROUTE = "/kuber" as const;

const kuberPlugin = definePlugin({
  contractVersion: CONTRACT_VERSION,
  id: PluginId.KUBER,
  icon: IconName.CLUSTER,
  kind: PluginKind.OPTIONAL,
  label: "Kuber",
  origin: PluginOrigin.BUILTIN,
  order: KUBER_PLUGIN_ORDER,
  requiresAgent: true,
  route: KUBER_PLUGIN_ROUTE,
  tabs: [
    {
      id: TabId.KUBE_CLUSTERS,
      title: TabTitle[TabId.KUBE_CLUSTERS],
      viewKey: ViewKey.KUBE_CLUSTERS,
      element: <KuberSection mode={ViewKey.KUBE_CLUSTERS} />,
    },
    {
      id: TabId.KUBE_PODS,
      title: TabTitle[TabId.KUBE_PODS],
      viewKey: ViewKey.KUBE_PODS,
      element: <KuberSection mode={ViewKey.KUBE_PODS} />,
    },
  ],
});

export default kuberPlugin;
