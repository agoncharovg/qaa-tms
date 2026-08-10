import type { User, WorkspaceTabDefinition } from "@/api/types";
import { PluginKind, type PluginSpec, type PluginTabSpec } from "@/core/plugins/types";
import {
  ContentType,
  PluginId,
  TabId,
  TabTitle,
  ViewKey,
  type PluginId as PluginIdType,
  type TabId as TabIdType,
} from "@/constants";
import { IconRocket, IconSettings } from "@tabler/icons-react";

export const STAGINGS_PLUGIN_ROUTE = "/stagings" as const;
export const ADMIN_PLUGIN_ROUTE = "/admin" as const;

export const stagingsPluginSpec: PluginSpec = {
  id: PluginId.STAGINGS,
  icon: IconRocket,
  kind: PluginKind.OPTIONAL,
  label: "Stagings",
  requiresAgent: true,
  route: STAGINGS_PLUGIN_ROUTE,
  tabs: [
    {
      id: TabId.STAGINGS_PREFLIGHT,
      title: TabTitle[TabId.STAGINGS_PREFLIGHT],
      viewKey: ViewKey.STAGINGS_PREFLIGHT,
    },
    {
      id: TabId.STAGINGS_DEPLOY,
      title: TabTitle[TabId.STAGINGS_DEPLOY],
      viewKey: ViewKey.STAGINGS_DEPLOY,
    },
    {
      id: TabId.STAGINGS_HISTORY,
      title: TabTitle[TabId.STAGINGS_HISTORY],
      viewKey: ViewKey.STAGINGS_HISTORY,
    },
    {
      id: TabId.STAGINGS_NAMESPACES,
      title: TabTitle[TabId.STAGINGS_NAMESPACES],
      viewKey: ViewKey.STAGINGS_NAMESPACES,
    },
    {
      id: TabId.STAGINGS_SYNC,
      title: TabTitle[TabId.STAGINGS_SYNC],
      viewKey: ViewKey.STAGINGS_SYNC,
    },
    {
      id: TabId.STAGINGS_E2E,
      title: TabTitle[TabId.STAGINGS_E2E],
      viewKey: ViewKey.STAGINGS_E2E,
    },
  ],
};

export const adminPluginSpec: PluginSpec = {
  adminOnly: false,
  id: PluginId.ADMIN,
  icon: IconSettings,
  kind: PluginKind.SYSTEM,
  label: "Administration",
  route: ADMIN_PLUGIN_ROUTE,
  tabs: [
    {
      id: TabId.ADMIN_PLUGINS,
      title: TabTitle[TabId.ADMIN_PLUGINS],
      viewKey: ViewKey.ADMIN_PLUGINS,
    },
    {
      adminOnly: true,
      id: TabId.ADMIN_USERS,
      title: TabTitle[TabId.ADMIN_USERS],
      viewKey: ViewKey.ADMIN_USERS,
    },
  ],
};

export const PLUGIN_SPECS = [stagingsPluginSpec, adminPluginSpec] as const satisfies readonly PluginSpec[];
export const PLUGIN_IDS = PLUGIN_SPECS.map((plugin) => plugin.id);
export const OPTIONAL_PLUGIN_IDS = PLUGIN_SPECS.filter(
  (plugin) => plugin.kind === PluginKind.OPTIONAL
).map((plugin) => plugin.id);
export const SYSTEM_PLUGIN_IDS = PLUGIN_SPECS.filter(
  (plugin) => plugin.kind === PluginKind.SYSTEM
).map((plugin) => plugin.id);

function matchesPluginRoute(route: string, pathname: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}

export function pluginById(id: PluginIdType | null | undefined): PluginSpec | undefined {
  return PLUGIN_SPECS.find((plugin) => plugin.id === id);
}

export function pluginByRoute(pathname: string): PluginSpec | undefined {
  return PLUGIN_SPECS.find((plugin) => matchesPluginRoute(plugin.route, pathname));
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
): PluginSpec[] {
  return PLUGIN_SPECS.filter((plugin) => pluginVisible(plugin, user, enabledOptionalIds));
}

export function visibleTabs(
  plugin: PluginSpec,
  user: Pick<User, "is_admin"> | null | undefined
): PluginTabSpec[] {
  return plugin.tabs.filter((tab) => tabVisible(tab, user));
}

export const tabById = Object.fromEntries(
  PLUGIN_SPECS.flatMap((plugin) => plugin.tabs.map((tab) => [tab.id, tab] as const))
) as Record<TabIdType, PluginTabSpec>;

export const tabDefinitions = Object.fromEntries(
  PLUGIN_SPECS.flatMap((plugin) =>
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
  PLUGIN_SPECS.map((plugin) => [plugin.id, plugin.tabs.map((tab) => tab.id)])
) as Record<PluginIdType, TabIdType[]>;

export const defaultTabIdByPlugin = Object.fromEntries(
  PLUGIN_SPECS.map((plugin) => [plugin.id, plugin.tabs[0]?.id ?? null])
) as Record<PluginIdType, TabIdType | null>;
