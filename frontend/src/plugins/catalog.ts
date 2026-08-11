import type { User, WorkspaceTabDefinition } from "@/api/types";
import { PluginKind, type PluginManifest, type PluginSpec, type PluginTab, type PluginTabSpec } from "@/core/plugins/types";
import {
  ContentType,
  type PluginId as PluginIdType,
  type TabId as TabIdType,
} from "@/constants";
import { PLUGINS } from "@/plugins/discovery";

export const PLUGIN_IDS = PLUGINS.map((plugin) => plugin.id);
export const OPTIONAL_PLUGIN_IDS = PLUGINS.filter(
  (plugin) => plugin.kind === PluginKind.OPTIONAL
).map((plugin) => plugin.id);
export const SYSTEM_PLUGIN_IDS = PLUGINS.filter(
  (plugin) => plugin.kind === PluginKind.SYSTEM
).map((plugin) => plugin.id);

function matchesPluginRoute(route: string, pathname: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}

export function pluginById(id: PluginIdType | null | undefined): PluginManifest | undefined {
  return PLUGINS.find((plugin) => plugin.id === id);
}

export function pluginByRoute(pathname: string): PluginManifest | undefined {
  return PLUGINS.find((plugin) => matchesPluginRoute(plugin.route, pathname));
}

export function resolveEnabledOptionalPluginIds(enabledPluginIds?: readonly string[]): PluginIdType[] {
  if (!enabledPluginIds) {
    return [...OPTIONAL_PLUGIN_IDS];
  }

  const enabled = new Set(enabledPluginIds);
  return OPTIONAL_PLUGIN_IDS.filter((pluginId) => enabled.has(pluginId));
}

export function enabledOptionalPluginIdSet(
  enabledPluginIds?: readonly string[]
): Set<PluginIdType> {
  return new Set(resolveEnabledOptionalPluginIds(enabledPluginIds));
}

export function pluginVisible(
  plugin: PluginSpec,
  user: Pick<User, "enabled_plugins" | "is_admin"> | null | undefined,
  enabledOptionalIds: ReadonlySet<PluginIdType>
): boolean {
  if (!user) {
    return false;
  }
  if (plugin.adminOnly && !user.is_admin) {
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
  user: Pick<User, "enabled_plugins" | "is_admin"> | null | undefined,
  enabledOptionalIds: ReadonlySet<PluginIdType>
): PluginManifest[] {
  return PLUGINS.filter((plugin) => pluginVisible(plugin, user, enabledOptionalIds));
}

export function visibleTabs(
  plugin: PluginManifest,
  user: Pick<User, "is_admin"> | null | undefined
): PluginTab[] {
  return plugin.tabs.filter((tab) => tabVisible(tab, user));
}

export const tabById = Object.fromEntries(
  PLUGINS.flatMap((plugin) => plugin.tabs.map((tab) => [tab.id, tab] as const))
) as Record<TabIdType, PluginTab>;

export const tabDefinitions = Object.fromEntries(
  PLUGINS.flatMap((plugin) =>
    plugin.tabs.map((tab) => [
      tab.id,
      {
        adminOnly: tab.adminOnly,
        closeable: true,
        contentType: ContentType.REACT_VIEW,
        id: tab.id,
        pluginId: plugin.id,
        title: tab.title,
        viewKey: tab.viewKey,
      } satisfies WorkspaceTabDefinition,
    ])
  )
) as Record<TabIdType, WorkspaceTabDefinition>;

export const tabCatalog = Object.fromEntries(
  PLUGINS.map((plugin) => [plugin.id, plugin.tabs.map((tab) => tab.id)])
) as Record<PluginIdType, TabIdType[]>;

export const defaultTabIdByPlugin = Object.fromEntries(
  PLUGINS.map((plugin) => [plugin.id, plugin.tabs[0]?.id ?? null])
) as Record<PluginIdType, TabIdType | null>;
