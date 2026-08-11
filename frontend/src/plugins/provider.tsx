import type { ReactNode } from "react";

import { enabledOptionalPluginIdSet, resolveEnabledOptionalPluginIds } from "@/plugins/catalog";
import { PluginsContext } from "@/plugins/context";
import { PLUGINS } from "@/plugins/discovery";

interface PluginsProviderProps {
  children: ReactNode;
}

export function PluginsProvider({ children }: PluginsProviderProps) {
  return (
    <PluginsContext.Provider
      value={{
        enabledOptionalPluginIdSet,
        plugins: PLUGINS,
        resolveEnabledOptionalPluginIds,
      }}
    >
      {children}
    </PluginsContext.Provider>
  );
}
