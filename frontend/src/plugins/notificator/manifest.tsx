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

import { NotificatorSection } from "@/plugins/notificator/NotificatorSection";

const NOTIFICATOR_PLUGIN_ORDER = 27 as const;
const NOTIFICATOR_PLUGIN_ROUTE = "/notificator" as const;

const notificatorPlugin = definePlugin({
  contractVersion: CONTRACT_VERSION,
  id: PluginId.NOTIFICATOR,
  icon: IconName.NOTIFICATOR,
  kind: PluginKind.OPTIONAL,
  label: "Notificator",
  origin: PluginOrigin.BUILTIN,
  order: NOTIFICATOR_PLUGIN_ORDER,
  requiresAgent: true,
  route: NOTIFICATOR_PLUGIN_ROUTE,
  tabs: [
    {
      id: TabId.NOTIFICATOR_NOTIFICATIONS,
      title: TabTitle[TabId.NOTIFICATOR_NOTIFICATIONS],
      viewKey: ViewKey.NOTIFICATOR_NOTIFICATIONS,
      element: <NotificatorSection />,
    },
  ],
});

export default notificatorPlugin;
