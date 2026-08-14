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

import { QaaGeneratorSection } from "@/plugins/qaa-generator/QaaGeneratorSection";

const QAA_GENERATOR_PLUGIN_ORDER = 20 as const;
const QAA_GENERATOR_PLUGIN_ROUTE = "/qaa-generator" as const;

const qaaGeneratorPlugin = definePlugin({
  contractVersion: CONTRACT_VERSION,
  id: PluginId.QAA_GENERATOR,
  icon: IconName.SPARKLES,
  kind: PluginKind.OPTIONAL,
  label: "QAA generator",
  origin: PluginOrigin.BUILTIN,
  order: QAA_GENERATOR_PLUGIN_ORDER,
  requiresAgent: false,
  route: QAA_GENERATOR_PLUGIN_ROUTE,
  tabs: [
    {
      id: TabId.QAA_GENERATE,
      title: TabTitle[TabId.QAA_GENERATE],
      viewKey: ViewKey.QAA_GENERATE,
      element: <QaaGeneratorSection mode={ViewKey.QAA_GENERATE} />,
    },
    {
      id: TabId.QAA_LIVE,
      title: TabTitle[TabId.QAA_LIVE],
      viewKey: ViewKey.QAA_LIVE,
      element: <QaaGeneratorSection mode={ViewKey.QAA_LIVE} />,
    },
    {
      id: TabId.QAA_RUNS,
      title: TabTitle[TabId.QAA_RUNS],
      viewKey: ViewKey.QAA_RUNS,
      element: <QaaGeneratorSection mode={ViewKey.QAA_RUNS} />,
    },
    {
      adminOnly: true,
      id: TabId.QAA_ADMIN,
      title: TabTitle[TabId.QAA_ADMIN],
      viewKey: ViewKey.QAA_ADMIN,
      element: <QaaGeneratorSection mode={ViewKey.QAA_ADMIN} />,
    },
  ],
});

export default qaaGeneratorPlugin;
