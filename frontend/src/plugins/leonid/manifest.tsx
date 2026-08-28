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
      id: TabId.LEONID_SHARED_RESOURCES,
      title: TabTitle[TabId.LEONID_SHARED_RESOURCES],
      viewKey: ViewKey.LEONID_SHARED_RESOURCES,
      element: <LeonidSection mode={ViewKey.LEONID_SHARED_RESOURCES} />,
    },
    {
      id: TabId.LEONID_SKIPPED_TESTS,
      title: TabTitle[TabId.LEONID_SKIPPED_TESTS],
      viewKey: ViewKey.LEONID_SKIPPED_TESTS,
      element: <LeonidSection mode={ViewKey.LEONID_SKIPPED_TESTS} />,
    },
    {
      id: TabId.LEONID_OBJECTS,
      title: TabTitle[TabId.LEONID_OBJECTS],
      viewKey: ViewKey.LEONID_OBJECTS,
      element: <LeonidSection mode={ViewKey.LEONID_OBJECTS} />,
    },
    {
      id: TabId.LEONID_PIPELINE_CONFIGS,
      title: TabTitle[TabId.LEONID_PIPELINE_CONFIGS],
      viewKey: ViewKey.LEONID_PIPELINE_CONFIGS,
      element: <LeonidSection mode={ViewKey.LEONID_PIPELINE_CONFIGS} />,
    },
  ],
});

export default leonidPlugin;
