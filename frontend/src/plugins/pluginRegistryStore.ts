import { create } from "zustand";

import type { WorkspaceTabDefinition } from "@/api/types";
import {
  ContentType,
  type PluginId as PluginIdType,
  type TabId as TabIdType,
  type ViewKey,
} from "@/constants";
import {
  PluginKind,
  pluginTabHasElement,
  type PluginManifest,
  type PluginTab,
} from "@/core/plugins/types";
import { BUILTIN_PLUGINS, sortPluginManifests, validatePluginManifests } from "@/plugins/discovery";

type PluginRegistryDerivedState = {
  defaultTabIdByPlugin: Record<PluginIdType, TabIdType | null>;
  optionalPluginIds: PluginIdType[];
  pluginIds: PluginIdType[];
  systemPluginIds: PluginIdType[];
  tabById: Record<TabIdType, PluginTab>;
  tabCatalog: Record<PluginIdType, TabIdType[]>;
  tabDefinitions: Record<TabIdType, WorkspaceTabDefinition>;
  viewRegistry: Record<ViewKey, PluginTab["element"]>;
};

interface PluginRegistryState {
  plugins: PluginManifest[];
  setLocalPlugins: (local: PluginManifest[]) => void;
}

type PluginUniqueValueLabel = "plugin id" | "plugin route" | "tab id" | "view key";

interface PluginUniqueValueSets {
  pluginIds: Set<string>;
  routes: Set<string>;
  tabIds: Set<string>;
  viewKeys: Set<string>;
}

interface PluginCollision {
  label: PluginUniqueValueLabel;
  value: string;
}

function createPluginUniqueValueSets(): PluginUniqueValueSets {
  return {
    pluginIds: new Set<string>(),
    routes: new Set<string>(),
    tabIds: new Set<string>(),
    viewKeys: new Set<string>(),
  };
}

function recordPluginUniqueValues(
  plugin: PluginManifest,
  uniqueValues: PluginUniqueValueSets
): void {
  uniqueValues.pluginIds.add(plugin.id);
  uniqueValues.routes.add(plugin.route);

  for (const tab of plugin.tabs) {
    uniqueValues.tabIds.add(tab.id);
    uniqueValues.viewKeys.add(tab.viewKey);
  }
}

function findPluginCollision(
  plugin: PluginManifest,
  uniqueValues: PluginUniqueValueSets
): PluginCollision | null {
  if (uniqueValues.pluginIds.has(plugin.id)) {
    return { label: "plugin id", value: plugin.id };
  }

  if (uniqueValues.routes.has(plugin.route)) {
    return { label: "plugin route", value: plugin.route };
  }

  for (const tab of plugin.tabs) {
    if (uniqueValues.tabIds.has(tab.id)) {
      return { label: "tab id", value: tab.id };
    }

    if (uniqueValues.viewKeys.has(tab.viewKey)) {
      return { label: "view key", value: tab.viewKey };
    }
  }

  return null;
}

function validateSinglePluginManifest(plugin: PluginManifest): PluginManifest {
  return validatePluginManifests([plugin])[0];
}

function mergePlugins(localPlugins: readonly PluginManifest[]): PluginManifest[] {
  if (localPlugins.length === 0) {
    return BUILTIN_PLUGINS;
  }

  const uniqueValues = createPluginUniqueValueSets();
  for (const builtinPlugin of BUILTIN_PLUGINS) {
    recordPluginUniqueValues(builtinPlugin, uniqueValues);
  }

  const retainedLocalPlugins: PluginManifest[] = [];
  const sortedLocalPlugins = sortPluginManifests(
    localPlugins.map((plugin) => validateSinglePluginManifest(plugin))
  );

  for (const localPlugin of sortedLocalPlugins) {
    const collision = findPluginCollision(localPlugin, uniqueValues);
    if (collision) {
      console.warn(
        `Dropping local plugin "${localPlugin.id}" because ${collision.label} "${collision.value}" collides with an existing plugin.`
      );
      continue;
    }

    retainedLocalPlugins.push(localPlugin);
    recordPluginUniqueValues(localPlugin, uniqueValues);
  }

  if (retainedLocalPlugins.length === 0) {
    return BUILTIN_PLUGINS;
  }

  return validatePluginManifests([...BUILTIN_PLUGINS, ...retainedLocalPlugins]);
}

function buildDerivedPluginRegistryState(
  plugins: readonly PluginManifest[]
): PluginRegistryDerivedState {
  return {
    defaultTabIdByPlugin: Object.fromEntries(
      plugins.map((plugin) => [plugin.id, plugin.tabs[0]?.id ?? null])
    ) as Record<PluginIdType, TabIdType | null>,
    optionalPluginIds: plugins
      .filter((plugin) => plugin.kind === PluginKind.OPTIONAL)
      .map((plugin) => plugin.id),
    pluginIds: plugins.map((plugin) => plugin.id),
    systemPluginIds: plugins
      .filter((plugin) => plugin.kind === PluginKind.SYSTEM)
      .map((plugin) => plugin.id),
    tabById: Object.fromEntries(
      plugins.flatMap((plugin) => plugin.tabs.map((tab) => [tab.id, tab] as const))
    ) as Record<TabIdType, PluginTab>,
    tabCatalog: Object.fromEntries(
      plugins.map((plugin) => [plugin.id, plugin.tabs.map((tab) => tab.id)])
    ) as Record<PluginIdType, TabIdType[]>,
    tabDefinitions: Object.fromEntries(
      plugins.flatMap((plugin) =>
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
    ) as Record<TabIdType, WorkspaceTabDefinition>,
    viewRegistry: Object.fromEntries(
      plugins.flatMap((plugin) =>
        plugin.tabs
          .filter(pluginTabHasElement)
          .map((tab) => [tab.viewKey, tab.element] as const)
      )
    ) as Record<ViewKey, PluginTab["element"]>,
  };
}

const derivedStateCache = new WeakMap<readonly PluginManifest[], PluginRegistryDerivedState>();

function selectDerivedState(plugins: readonly PluginManifest[]): PluginRegistryDerivedState {
  const cached = derivedStateCache.get(plugins);
  if (cached) {
    return cached;
  }

  const derivedState = buildDerivedPluginRegistryState(plugins);
  derivedStateCache.set(plugins, derivedState);
  return derivedState;
}

export const usePluginRegistryStore = create<PluginRegistryState>()((set) => ({
  plugins: BUILTIN_PLUGINS,
  setLocalPlugins(localPlugins) {
    set({
      plugins: mergePlugins(localPlugins),
    });
  },
}));

export function getPlugins(): PluginManifest[] {
  return usePluginRegistryStore.getState().plugins;
}

export function setLocalPlugins(localPlugins: PluginManifest[]): void {
  usePluginRegistryStore.getState().setLocalPlugins(localPlugins);
}

export function usePlugins(): PluginManifest[] {
  return usePluginRegistryStore((state) => state.plugins);
}

export function getPluginIds(): PluginIdType[] {
  return selectDerivedState(getPlugins()).pluginIds;
}

export function usePluginIds(): PluginIdType[] {
  return usePluginRegistryStore((state) => selectDerivedState(state.plugins).pluginIds);
}

export function getOptionalPluginIds(): PluginIdType[] {
  return selectDerivedState(getPlugins()).optionalPluginIds;
}

export function useOptionalPluginIds(): PluginIdType[] {
  return usePluginRegistryStore((state) => selectDerivedState(state.plugins).optionalPluginIds);
}

export function getSystemPluginIds(): PluginIdType[] {
  return selectDerivedState(getPlugins()).systemPluginIds;
}

export function useSystemPluginIds(): PluginIdType[] {
  return usePluginRegistryStore((state) => selectDerivedState(state.plugins).systemPluginIds);
}

export function getViewRegistry(): Record<ViewKey, PluginTab["element"]> {
  return selectDerivedState(getPlugins()).viewRegistry;
}

export function useViewRegistry(): Record<ViewKey, PluginTab["element"]> {
  return usePluginRegistryStore((state) => selectDerivedState(state.plugins).viewRegistry);
}

export function getTabById(): Record<TabIdType, PluginTab> {
  return selectDerivedState(getPlugins()).tabById;
}

export function useTabById(): Record<TabIdType, PluginTab> {
  return usePluginRegistryStore((state) => selectDerivedState(state.plugins).tabById);
}

export function getTabDefinitions(): Record<TabIdType, WorkspaceTabDefinition> {
  return selectDerivedState(getPlugins()).tabDefinitions;
}

export function useTabDefinitions(): Record<TabIdType, WorkspaceTabDefinition> {
  return usePluginRegistryStore((state) => selectDerivedState(state.plugins).tabDefinitions);
}

export function getTabCatalog(): Record<PluginIdType, TabIdType[]> {
  return selectDerivedState(getPlugins()).tabCatalog;
}

export function useTabCatalog(): Record<PluginIdType, TabIdType[]> {
  return usePluginRegistryStore((state) => selectDerivedState(state.plugins).tabCatalog);
}

export function getDefaultTabIdByPlugin(): Record<PluginIdType, TabIdType | null> {
  return selectDerivedState(getPlugins()).defaultTabIdByPlugin;
}

export function useDefaultTabIdByPlugin(): Record<PluginIdType, TabIdType | null> {
  return usePluginRegistryStore((state) => selectDerivedState(state.plugins).defaultTabIdByPlugin);
}

export function getPluginRegistrySnapshot(): PluginRegistryDerivedState & {
  plugins: PluginManifest[];
} {
  const plugins = getPlugins();
  return {
    plugins,
    ...selectDerivedState(plugins),
  };
}
