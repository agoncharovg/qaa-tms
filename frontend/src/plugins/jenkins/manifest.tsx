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

import { JenkinsSection } from "@/plugins/jenkins/JenkinsSection";

const JENKINS_PLUGIN_ORDER = 25 as const;
const JENKINS_PLUGIN_ROUTE = "/jenkins" as const;

const jenkinsPlugin = definePlugin({
  contractVersion: CONTRACT_VERSION,
  id: PluginId.JENKINS,
  icon: IconName.JENKINS,
  kind: PluginKind.OPTIONAL,
  label: "Jenkins",
  origin: PluginOrigin.BUILTIN,
  order: JENKINS_PLUGIN_ORDER,
  requiresAgent: true,
  route: JENKINS_PLUGIN_ROUTE,
  tabs: [
    {
      id: TabId.JENKINS_TREE,
      title: TabTitle[TabId.JENKINS_TREE],
      viewKey: ViewKey.JENKINS_TREE,
      element: <JenkinsSection mode={ViewKey.JENKINS_TREE} />,
    },
    {
      id: TabId.JENKINS_BOARD,
      title: TabTitle[TabId.JENKINS_BOARD],
      viewKey: ViewKey.JENKINS_BOARD,
      element: <JenkinsSection mode={ViewKey.JENKINS_BOARD} />,
    },
  ],
});

export default jenkinsPlugin;
