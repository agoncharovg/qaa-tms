import { createContext, useContext } from "react";

import type { PluginId as PluginIdType } from "@/constants";
import type { PluginManifest } from "@/core/plugins/types";

export interface PluginsContextValue {
  enabledOptionalPluginIdSet: (enabledPluginIds?: readonly string[]) => Set<PluginIdType>;
  plugins: PluginManifest[];
  resolveEnabledOptionalPluginIds: (enabledPluginIds?: readonly string[]) => PluginIdType[];
}

export const PluginsContext = createContext<PluginsContextValue | null>(null);

export function usePluginsContext(): PluginsContextValue {
  const context = useContext(PluginsContext);
  if (!context) {
    throw new Error("PluginsContext is not available.");
  }

  return context;
}
