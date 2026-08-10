export {
  ADMIN_PLUGIN_ROUTE,
  enabledOptionalPluginIdSet,
  OPTIONAL_PLUGIN_IDS,
  pluginById,
  pluginByRoute,
  PLUGIN_IDS,
  pluginVisible,
  PLUGIN_SPECS,
  resolveEnabledOptionalPluginIds,
  stagingsPluginSpec,
  SYSTEM_PLUGIN_IDS,
  tabById,
  tabCatalog,
  tabDefinitions,
  tabVisible,
  visiblePlugins,
  visibleTabs,
  defaultTabIdByPlugin,
  adminPluginSpec,
} from "@/plugins/catalog";

import type { PluginTab } from "@/core/plugins/types";
import type { ViewKey } from "@/constants";
import { adminPlugin } from "@/plugins/admin/manifest";
import { stagingsPlugin } from "@/plugins/stagings/manifest";

export const PLUGINS = [stagingsPlugin, adminPlugin];

export const viewRegistry = Object.fromEntries(
  PLUGINS.flatMap((plugin) => plugin.tabs.map((tab) => [tab.viewKey, tab.element] as const))
) as Record<ViewKey, PluginTab["element"]>;
