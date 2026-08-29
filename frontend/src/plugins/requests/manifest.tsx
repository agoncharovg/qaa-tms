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

import { RequestsSection } from "@/plugins/requests/RequestsSection";

const REQUESTS_PLUGIN_ORDER = 29 as const;
const REQUESTS_PLUGIN_ROUTE = "/requests" as const;

const requestsPlugin = definePlugin({
  contractVersion: CONTRACT_VERSION,
  id: PluginId.REQUESTS,
  icon: IconName.REQUESTS,
  kind: PluginKind.OPTIONAL,
  label: "Requests",
  origin: PluginOrigin.BUILTIN,
  order: REQUESTS_PLUGIN_ORDER,
  requiresAgent: true,
  route: REQUESTS_PLUGIN_ROUTE,
  tabs: [
    {
      id: TabId.REQUESTS_BUILDER,
      title: TabTitle[TabId.REQUESTS_BUILDER],
      viewKey: ViewKey.REQUESTS_BUILDER,
      element: <RequestsSection mode={ViewKey.REQUESTS_BUILDER} />,
    },
    {
      id: TabId.REQUESTS_CREDENTIALS,
      title: TabTitle[TabId.REQUESTS_CREDENTIALS],
      viewKey: ViewKey.REQUESTS_CREDENTIALS,
      element: <RequestsSection mode={ViewKey.REQUESTS_CREDENTIALS} />,
    },
    {
      id: TabId.REQUESTS_HISTORY,
      title: TabTitle[TabId.REQUESTS_HISTORY],
      viewKey: ViewKey.REQUESTS_HISTORY,
      element: <RequestsSection mode={ViewKey.REQUESTS_HISTORY} />,
    },
  ],
});

export default requestsPlugin;

