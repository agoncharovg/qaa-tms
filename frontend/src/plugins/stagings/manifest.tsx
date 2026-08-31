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

import { StagingsSection } from "@/plugins/stagings/StagingsSection";

const STAGINGS_PLUGIN_ROUTE = "/stagings" as const;

const stagingsPlugin = definePlugin({
  contractVersion: CONTRACT_VERSION,
  id: PluginId.STAGINGS,
  icon: IconName.ROCKET,
  kind: PluginKind.OPTIONAL,
  label: "Stagings",
  origin: PluginOrigin.BUILTIN,
  order: 10,
  requiresAgent: true,
  route: STAGINGS_PLUGIN_ROUTE,
  tabs: [
    // Preflight tab intentionally unregistered (kept in code for possible future revival).
    {
      id: TabId.STAGINGS_DEPLOY,
      title: TabTitle[TabId.STAGINGS_DEPLOY],
      viewKey: ViewKey.STAGINGS_DEPLOY,
      element: <StagingsSection mode={ViewKey.STAGINGS_DEPLOY} />,
    },
    // History tab intentionally unregistered (kept in code for possible future revival).
    {
      id: TabId.STAGINGS_NAMESPACES,
      title: TabTitle[TabId.STAGINGS_NAMESPACES],
      viewKey: ViewKey.STAGINGS_NAMESPACES,
      element: <StagingsSection mode={ViewKey.STAGINGS_NAMESPACES} />,
    },
    // Sync tab intentionally unregistered (kept in code for possible future revival).
    {
      id: TabId.STAGINGS_E2E,
      title: TabTitle[TabId.STAGINGS_E2E],
      viewKey: ViewKey.STAGINGS_E2E,
      element: <StagingsSection mode={ViewKey.STAGINGS_E2E} />,
    },
  ],
});

export default stagingsPlugin;
