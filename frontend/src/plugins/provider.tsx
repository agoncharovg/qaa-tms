import type { ReactNode } from "react";

import { enabledOptionalPluginIdSet, resolveEnabledOptionalPluginIds } from "@/plugins/catalog";
import { PluginsContext } from "@/plugins/context";
import { usePlugins } from "@/plugins/pluginRegistryStore";

interface PluginsProviderProps {
  children: ReactNode;
}

export function PluginsProvider({ children }: PluginsProviderProps) {
  const plugins = usePlugins();

  return (
    <PluginsContext.Provider
      value={{
        enabledOptionalPluginIdSet,
        plugins,
        resolveEnabledOptionalPluginIds,
      }}
    >
      {children}
    </PluginsContext.Provider>
  );
}
