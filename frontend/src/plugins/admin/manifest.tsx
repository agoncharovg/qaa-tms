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

import { SecurityPage } from "@/plugins/admin/SecurityPage";
import { ServerSettingsPage } from "@/plugins/admin/ServerSettingsPage";

const ADMIN_PLUGIN_ROUTE = "/admin" as const;
const ADMIN_PLUGIN_ORDER = 30 as const;

const adminPlugin = definePlugin({
  adminOnly: true,
  contractVersion: CONTRACT_VERSION,
  id: PluginId.ADMIN,
  icon: IconName.SETTINGS,
  kind: PluginKind.SYSTEM,
  label: "Administration",
  origin: PluginOrigin.BUILTIN,
  order: ADMIN_PLUGIN_ORDER,
  route: ADMIN_PLUGIN_ROUTE,
  tabs: [
    {
      adminOnly: true,
      id: TabId.ADMIN_SECURITY,
      title: TabTitle[TabId.ADMIN_SECURITY],
      viewKey: ViewKey.ADMIN_SECURITY,
      element: <SecurityPage />,
    },
    {
      adminOnly: true,
      id: TabId.ADMIN_INTEGRATIONS,
      title: TabTitle[TabId.ADMIN_INTEGRATIONS],
      viewKey: ViewKey.ADMIN_INTEGRATIONS,
      element: <ServerSettingsPage />,
    },
  ],
});

export default adminPlugin;
