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
import { AssistantSection } from "@/plugins/assistant/AssistantSection";

const ASSISTANT_PLUGIN_ORDER = 29 as const;
const ASSISTANT_PLUGIN_ROUTE = "/assistant" as const;

const assistantPlugin = definePlugin({
  contractVersion: CONTRACT_VERSION,
  id: PluginId.ASSISTANT,
  icon: IconName.ASSISTANT,
  kind: PluginKind.OPTIONAL,
  label: "Assistant",
  origin: PluginOrigin.BUILTIN,
  order: ASSISTANT_PLUGIN_ORDER,
  requiresAgent: true,
  route: ASSISTANT_PLUGIN_ROUTE,
  tabs: [
    {
      element: <AssistantSection />,
      id: TabId.ASSISTANT_CHAT,
      title: TabTitle[TabId.ASSISTANT_CHAT],
      viewKey: ViewKey.ASSISTANT_CHAT,
    },
  ],
});

export default assistantPlugin;
