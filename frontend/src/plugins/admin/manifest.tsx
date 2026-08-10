import { type PluginManifest } from "@/core/plugins/types";
import { PluginsPage } from "@/plugins/admin/PluginsPage";
import { UsersPage } from "@/plugins/admin/UsersPage";
import { adminPluginSpec } from "@/plugins/catalog";

export const adminPlugin: PluginManifest = {
  ...adminPluginSpec,
  tabs: [
    {
      ...adminPluginSpec.tabs[0],
      element: <PluginsPage />,
    },
    {
      ...adminPluginSpec.tabs[1],
      element: <UsersPage />,
    },
  ],
};
