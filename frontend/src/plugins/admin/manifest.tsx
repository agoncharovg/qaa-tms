import { PluginId, TabId, TabTitle, ViewKey } from "@/constants";
import { PluginKind, type PluginManifest } from "@/core/plugins/types";
import { IconSettings } from "@tabler/icons-react";

import { PluginsPage } from "@/plugins/admin/PluginsPage";
import { UsersPage } from "@/plugins/admin/UsersPage";

const ADMIN_PLUGIN_ROUTE = "/admin" as const;

const adminPlugin: PluginManifest = {
  adminOnly: false,
  id: PluginId.ADMIN,
  icon: IconSettings,
  kind: PluginKind.SYSTEM,
  label: "Administration",
  order: 20,
  route: ADMIN_PLUGIN_ROUTE,
  tabs: [
    {
      id: TabId.ADMIN_PLUGINS,
      title: TabTitle[TabId.ADMIN_PLUGINS],
      viewKey: ViewKey.ADMIN_PLUGINS,
      element: <PluginsPage />,
    },
    {
      adminOnly: true,
      id: TabId.ADMIN_USERS,
      title: TabTitle[TabId.ADMIN_USERS],
      viewKey: ViewKey.ADMIN_USERS,
      element: <UsersPage />,
    },
  ],
};

export default adminPlugin;
