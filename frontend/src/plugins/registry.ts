export {
  enabledOptionalPluginIdSet,
  OPTIONAL_PLUGIN_IDS,
  pluginById,
  pluginByRoute,
  PLUGIN_IDS,
  pluginVisible,
  resolveEnabledOptionalPluginIds,
  SYSTEM_PLUGIN_IDS,
  tabById,
  tabCatalog,
  tabDefinitions,
  tabVisible,
  visiblePlugins,
  visibleTabs,
  defaultTabIdByPlugin,
} from "@/plugins/catalog";

import type { PluginTab } from "@/core/plugins/types";
import { pluginTabHasElement } from "@/core/plugins/types";
import type { ViewKey } from "@/constants";
import { PLUGINS } from "@/plugins/discovery";

export { PLUGINS } from "@/plugins/discovery";

export const viewRegistry = Object.fromEntries(
  PLUGINS.flatMap((plugin) =>
    plugin.tabs
      .filter(pluginTabHasElement)
      .map((tab) => [tab.viewKey, tab.element] as const)
  )
) as Record<ViewKey, PluginTab["element"]>;
