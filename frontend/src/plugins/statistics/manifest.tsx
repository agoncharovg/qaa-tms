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

import { StatisticsSmokeSection } from "@/plugins/statistics/StatisticsSmokeSection";

// Sits between Jenkins (25) and Admin (30). "Statistics" is the shared home for
// statistics views — global ones (Smoke, below) and, later, local per-user submenus.
const STATISTICS_PLUGIN_ORDER = 27 as const;
const STATISTICS_PLUGIN_ROUTE = "/statistics" as const;

const statisticsPlugin = definePlugin({
  contractVersion: CONTRACT_VERSION,
  id: PluginId.STATISTICS,
  icon: IconName.STATISTICS,
  kind: PluginKind.OPTIONAL,
  label: "Statistics",
  origin: PluginOrigin.BUILTIN,
  order: STATISTICS_PLUGIN_ORDER,
  requiresAgent: false,
  route: STATISTICS_PLUGIN_ROUTE,
  tabs: [
    {
      id: TabId.STATISTICS_SMOKE,
      title: TabTitle[TabId.STATISTICS_SMOKE],
      viewKey: ViewKey.STATISTICS_SMOKE,
      element: <StatisticsSmokeSection />,
    },
  ],
});

export default statisticsPlugin;
