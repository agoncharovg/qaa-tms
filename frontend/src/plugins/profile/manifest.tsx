import {
  CONTRACT_VERSION,
  IconName,
  NavSection,
  PluginId,
  PluginOrigin,
  TabId,
  TabTitle,
  ViewKey,
} from "@/constants";
import { definePlugin } from "@/core/plugins/definePlugin";
import { PluginKind } from "@/core/plugins/types";

import { ProfilePage } from "@/plugins/profile/ProfilePage";

const PROFILE_PLUGIN_ORDER = 40 as const;
const PROFILE_PLUGIN_ROUTE = "/profile" as const;

const profilePlugin = definePlugin({
  contractVersion: CONTRACT_VERSION,
  id: PluginId.PROFILE,
  icon: IconName.USER,
  kind: PluginKind.SYSTEM,
  label: "Profile",
  navSection: NavSection.ACCOUNT,
  origin: PluginOrigin.BUILTIN,
  order: PROFILE_PLUGIN_ORDER,
  route: PROFILE_PLUGIN_ROUTE,
  tabs: [
    {
      id: TabId.PROFILE,
      title: TabTitle[TabId.PROFILE],
      viewKey: ViewKey.PROFILE,
      element: <ProfilePage />,
    },
  ],
});

export default profilePlugin;
