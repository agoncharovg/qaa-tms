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

import { LeonidSection } from "@/plugins/leonid/LeonidSection";

const LEONID_PLUGIN_ORDER = 26 as const;
const LEONID_PLUGIN_ROUTE = "/leonid" as const;

const leonidPlugin = definePlugin({
  contractVersion: CONTRACT_VERSION,
  id: PluginId.LEONID,
  icon: IconName.LEONID,
  kind: PluginKind.OPTIONAL,
  label: "Leonid",
  origin: PluginOrigin.BUILTIN,
  order: LEONID_PLUGIN_ORDER,
  requiresAgent: true,
  route: LEONID_PLUGIN_ROUTE,
  tabs: [
    {
      id: TabId.LEONID_DEPLOY,
      title: TabTitle[TabId.LEONID_DEPLOY],
      viewKey: ViewKey.LEONID_DEPLOY,
      element: <LeonidSection mode={ViewKey.LEONID_DEPLOY} />,
    },
    {
      id: TabId.LEONID_REPORT,
      title: TabTitle[TabId.LEONID_REPORT],
      viewKey: ViewKey.LEONID_REPORT,
      element: <LeonidSection mode={ViewKey.LEONID_REPORT} />,
    },
  ],
});

export default leonidPlugin;
