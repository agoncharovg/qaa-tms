import { PluginId, TabId, TabTitle, ViewKey } from "@/constants";
import { PluginKind, type PluginManifest } from "@/core/plugins/types";
import { IconRocket } from "@tabler/icons-react";

import { StagingsSection } from "@/plugins/stagings/StagingsSection";

const STAGINGS_PLUGIN_ROUTE = "/stagings" as const;

const stagingsPlugin: PluginManifest = {
  id: PluginId.STAGINGS,
  icon: IconRocket,
  kind: PluginKind.OPTIONAL,
  label: "Stagings",
  order: 10,
  requiresAgent: true,
  route: STAGINGS_PLUGIN_ROUTE,
  tabs: [
    {
      id: TabId.STAGINGS_PREFLIGHT,
      title: TabTitle[TabId.STAGINGS_PREFLIGHT],
      viewKey: ViewKey.STAGINGS_PREFLIGHT,
      element: <StagingsSection mode={ViewKey.STAGINGS_PREFLIGHT} />,
    },
    {
      id: TabId.STAGINGS_DEPLOY,
      title: TabTitle[TabId.STAGINGS_DEPLOY],
      viewKey: ViewKey.STAGINGS_DEPLOY,
      element: <StagingsSection mode={ViewKey.STAGINGS_DEPLOY} />,
    },
    {
      id: TabId.STAGINGS_HISTORY,
      title: TabTitle[TabId.STAGINGS_HISTORY],
      viewKey: ViewKey.STAGINGS_HISTORY,
      element: <StagingsSection mode={ViewKey.STAGINGS_HISTORY} />,
    },
    {
      id: TabId.STAGINGS_NAMESPACES,
      title: TabTitle[TabId.STAGINGS_NAMESPACES],
      viewKey: ViewKey.STAGINGS_NAMESPACES,
      element: <StagingsSection mode={ViewKey.STAGINGS_NAMESPACES} />,
    },
    {
      id: TabId.STAGINGS_SYNC,
      title: TabTitle[TabId.STAGINGS_SYNC],
      viewKey: ViewKey.STAGINGS_SYNC,
      element: <StagingsSection mode={ViewKey.STAGINGS_SYNC} />,
    },
    {
      id: TabId.STAGINGS_E2E,
      title: TabTitle[TabId.STAGINGS_E2E],
      viewKey: ViewKey.STAGINGS_E2E,
      element: <StagingsSection mode={ViewKey.STAGINGS_E2E} />,
    },
  ],
};

export default stagingsPlugin;
