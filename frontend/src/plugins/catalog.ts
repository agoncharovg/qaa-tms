import type { User } from "@/api/types";
import { PluginKind, type PluginManifest, type PluginSpec, type PluginTab, type PluginTabSpec } from "@/core/plugins/types";
import {
  NavSection,
  type PluginId as PluginIdType,
} from "@/constants";
import { pluginPermitted } from "@/plugins/permissions";
import {
  getDefaultTabIdByPlugin,
  getOptionalPluginIds,
  getPluginIds,
  getPlugins,
  getSystemPluginIds,
  getTabById,
  getTabCatalog,
  getTabDefinitions,
  useDefaultTabIdByPlugin,
  useOptionalPluginIds,
  usePluginIds,
  usePlugins,
  useSystemPluginIds,
  useTabById,
  useTabCatalog,
  useTabDefinitions,
} from "@/plugins/pluginRegistryStore";

export { PLUGIN_REQUIRED_READ_PERMISSION, pluginPermitted } from "@/plugins/permissions";

function matchesPluginRoute(route: string, pathname: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}

export function pluginById(
  id: PluginIdType | null | undefined,
  plugins: readonly PluginManifest[] = getPlugins()
): PluginManifest | undefined {
  return plugins.find((plugin) => plugin.id === id);
}

export function usePluginById(id: PluginIdType | null | undefined): PluginManifest | undefined {
  return usePlugins().find((plugin) => plugin.id === id);
}

export function pluginByRoute(
  pathname: string,
  plugins: readonly PluginManifest[] = getPlugins()
): PluginManifest | undefined {
  return plugins.find((plugin) => matchesPluginRoute(plugin.route, pathname));
}

export function usePluginByRoute(pathname: string): PluginManifest | undefined {
  return usePlugins().find((plugin) => matchesPluginRoute(plugin.route, pathname));
}

export function resolveEnabledOptionalPluginIds(
  enabledPluginIds?: readonly string[],
  optionalPluginIds: readonly PluginIdType[] = getOptionalPluginIds()
): PluginIdType[] {
  if (!enabledPluginIds) {
    return [...optionalPluginIds];
  }

  const enabled = new Set(enabledPluginIds);
  return optionalPluginIds.filter((pluginId) => enabled.has(pluginId));
}

export function enabledOptionalPluginIdSet(
  enabledPluginIds?: readonly string[],
  optionalPluginIds: readonly PluginIdType[] = getOptionalPluginIds()
): Set<PluginIdType> {
  return new Set(resolveEnabledOptionalPluginIds(enabledPluginIds, optionalPluginIds));
}

export function useEnabledOptionalPluginIdSet(enabledPluginIds?: readonly string[]): Set<PluginIdType> {
  const optionalPluginIds = useOptionalPluginIds();
  return enabledOptionalPluginIdSet(enabledPluginIds, optionalPluginIds);
}

export function pluginVisible(
  plugin: PluginSpec,
  user: Pick<User, "enabled_plugins" | "is_admin" | "effective_permissions"> | null | undefined,
  enabledOptionalIds: ReadonlySet<PluginIdType>
): boolean {
  if (!user) {
    return false;
  }
  if (plugin.adminOnly && !user.is_admin) {
    return false;
  }
  if (!pluginPermitted(plugin, user)) {
    return false;
  }
  if (plugin.kind === PluginKind.SYSTEM) {
    return true;
  }
  return enabledOptionalIds.has(plugin.id);
}

export function tabVisible(
  tab: PluginTabSpec,
  user: Pick<User, "is_admin"> | null | undefined
): boolean {
  return !tab.adminOnly || Boolean(user?.is_admin);
}

export function visiblePlugins(
  user: Pick<User, "enabled_plugins" | "is_admin" | "effective_permissions"> | null | undefined,
  enabledOptionalIds: ReadonlySet<PluginIdType>,
  plugins: readonly PluginManifest[] = getPlugins()
): PluginManifest[] {
  return plugins.filter((plugin) => pluginVisible(plugin, user, enabledOptionalIds));
}

export function useVisiblePlugins(
  user: Pick<User, "enabled_plugins" | "is_admin" | "effective_permissions"> | null | undefined,
  enabledOptionalIds: ReadonlySet<PluginIdType>
): PluginManifest[] {
  const plugins = usePlugins();
  return visiblePlugins(user, enabledOptionalIds, plugins);
}

export function pluginNavSection(plugin: Pick<PluginManifest, "navSection">): NavSection {
  return plugin.navSection ?? NavSection.PRIMARY;
}

export function primaryVisiblePlugins(
  user: Pick<User, "enabled_plugins" | "is_admin" | "effective_permissions"> | null | undefined,
  enabledOptionalIds: ReadonlySet<PluginIdType>,
  plugins: readonly PluginManifest[] = getPlugins()
): PluginManifest[] {
  return visiblePlugins(user, enabledOptionalIds, plugins).filter(
    (plugin) => pluginNavSection(plugin) === NavSection.PRIMARY
  );
}

export function usePrimaryVisiblePlugins(
  user: Pick<User, "enabled_plugins" | "is_admin" | "effective_permissions"> | null | undefined,
  enabledOptionalIds: ReadonlySet<PluginIdType>
): PluginManifest[] {
  const plugins = usePlugins();
  return primaryVisiblePlugins(user, enabledOptionalIds, plugins);
}

export function accountVisiblePlugins(
  user: Pick<User, "enabled_plugins" | "is_admin" | "effective_permissions"> | null | undefined,
  enabledOptionalIds: ReadonlySet<PluginIdType>,
  plugins: readonly PluginManifest[] = getPlugins()
): PluginManifest[] {
  return visiblePlugins(user, enabledOptionalIds, plugins).filter(
    (plugin) => pluginNavSection(plugin) === NavSection.ACCOUNT
  );
}

export function useAccountVisiblePlugins(
  user: Pick<User, "enabled_plugins" | "is_admin" | "effective_permissions"> | null | undefined,
  enabledOptionalIds: ReadonlySet<PluginIdType>
): PluginManifest[] {
  const plugins = usePlugins();
  return accountVisiblePlugins(user, enabledOptionalIds, plugins);
}

export function visibleTabs(
  plugin: PluginManifest,
  user: Pick<User, "is_admin"> | null | undefined
): PluginTab[] {
  return plugin.tabs.filter((tab) => tabVisible(tab, user));
}

export {
  getDefaultTabIdByPlugin,
  getOptionalPluginIds,
  getPluginIds,
  getSystemPluginIds,
  getTabById,
  getTabCatalog,
  getTabDefinitions,
  useDefaultTabIdByPlugin,
  useOptionalPluginIds,
  usePluginIds,
  useSystemPluginIds,
  useTabById,
  useTabCatalog,
  useTabDefinitions,
};
