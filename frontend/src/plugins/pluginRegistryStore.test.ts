import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/plugins/admin/UsersPage", () => ({
  UsersPage: () => null,
}));

vi.mock("@/plugins/admin/ServerSettingsPage", () => ({
  ServerSettingsPage: () => null,
}));

vi.mock("@/plugins/jenkins/JenkinsSection", () => ({
  JenkinsSection: () => null,
}));

vi.mock("@/plugins/kuber/KuberSection", () => ({
  KuberSection: () => null,
}));

vi.mock("@/plugins/notificator/NotificatorSection", () => ({
  NotificatorSection: () => null,
}));

vi.mock("@/plugins/profile/ProfilePage", () => ({
  ProfilePage: () => null,
}));

vi.mock("@/plugins/qaa-generator/QaaGeneratorSection", () => ({
  QaaGeneratorSection: () => null,
}));

vi.mock("@/plugins/stagings/StagingsSection", () => ({
  StagingsSection: () => null,
}));

import type { WorkspaceTabDefinition } from "@/api/types";
import {
  CONTRACT_VERSION,
  ContentType,
  IconName,
  PluginId,
  PluginOrigin,
  type TabId,
  type ViewKey,
} from "@/constants";
import { pluginTabHasElement, PluginKind, type PluginManifest, type PluginTab } from "@/core/plugins/types";
import { BUILTIN_PLUGINS } from "@/plugins/discovery";
import {
  getDefaultTabIdByPlugin,
  getOptionalPluginIds,
  getPluginIds,
  getPlugins,
  getSystemPluginIds,
  getTabById,
  getTabCatalog,
  getTabDefinitions,
  getViewRegistry,
  setLocalPlugins,
} from "@/plugins/pluginRegistryStore";

type LegacyDerivedState = {
  defaultTabIdByPlugin: ReturnType<typeof getDefaultTabIdByPlugin>;
  optionalPluginIds: ReturnType<typeof getOptionalPluginIds>;
  pluginIds: ReturnType<typeof getPluginIds>;
  systemPluginIds: ReturnType<typeof getSystemPluginIds>;
  tabById: ReturnType<typeof getTabById>;
  tabCatalog: ReturnType<typeof getTabCatalog>;
  tabDefinitions: ReturnType<typeof getTabDefinitions>;
  viewRegistry: ReturnType<typeof getViewRegistry>;
};

function buildLegacyDerivedState(plugins: readonly PluginManifest[]): LegacyDerivedState {
  return {
    defaultTabIdByPlugin: Object.fromEntries(
      plugins.map((plugin) => [plugin.id, plugin.tabs[0]?.id ?? null])
    ) as ReturnType<typeof getDefaultTabIdByPlugin>,
    optionalPluginIds: plugins
      .filter((plugin) => plugin.kind === PluginKind.OPTIONAL)
      .map((plugin) => plugin.id),
    pluginIds: plugins.map((plugin) => plugin.id),
    systemPluginIds: plugins.filter((plugin) => plugin.kind === PluginKind.SYSTEM).map((plugin) => plugin.id),
    tabById: Object.fromEntries(
      plugins.flatMap((plugin) => plugin.tabs.map((tab) => [tab.id, tab] as const))
    ) as Record<TabId, PluginTab>,
    tabCatalog: Object.fromEntries(
      plugins.map((plugin) => [plugin.id, plugin.tabs.map((tab) => tab.id)])
    ) as ReturnType<typeof getTabCatalog>,
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
    ) as ReturnType<typeof getTabDefinitions>,
    viewRegistry: Object.fromEntries(
      plugins.flatMap((plugin) =>
        plugin.tabs
          .filter(pluginTabHasElement)
          .map((tab) => [tab.viewKey, tab.element] as const)
      )
    ) as Record<ViewKey, PluginTab["element"]>,
  };
}

function createLocalPlugin(options: {
  id: string;
  label: string;
  route: string;
  order?: number;
  tabId?: string;
  viewKey?: string;
}): PluginManifest {
  return {
    contractVersion: CONTRACT_VERSION,
    icon: IconName.SPARKLES,
    id: options.id as PluginId,
    kind: PluginKind.OPTIONAL,
    label: options.label,
    order: options.order ?? 1_000,
    origin: PluginOrigin.LOCAL,
    route: options.route,
    tabs: [
      {
        element: null,
        id: (options.tabId ?? `${options.id}-tab`) as TabId,
        title: `${options.label} tab`,
        viewKey: (options.viewKey ?? `${options.id}-view`) as ViewKey,
      },
    ],
  };
}

afterEach(() => {
  setLocalPlugins([]);
  vi.restoreAllMocks();
});

describe("pluginRegistryStore", () => {
  it("initializes to the builtin registry state", () => {
    const expected = buildLegacyDerivedState(BUILTIN_PLUGINS);

    expect(getPlugins()).toBe(BUILTIN_PLUGINS);
    expect(getPluginIds()).toStrictEqual(expected.pluginIds);
    expect(getOptionalPluginIds()).toStrictEqual(expected.optionalPluginIds);
    expect(getSystemPluginIds()).toStrictEqual(expected.systemPluginIds);
    expect(getViewRegistry()).toStrictEqual(expected.viewRegistry);
    expect(getTabById()).toStrictEqual(expected.tabById);
    expect(getTabDefinitions()).toStrictEqual(expected.tabDefinitions);
    expect(getTabCatalog()).toStrictEqual(expected.tabCatalog);
    expect(getDefaultTabIdByPlugin()).toStrictEqual(expected.defaultTabIdByPlugin);
  });

  it("merges, sorts, and dedupes local plugins while keeping builtins on collisions", () => {
    const alphaLocal = createLocalPlugin({
      id: "alpha-local",
      label: "Alpha Local",
      route: "/alpha-local",
    });
    const zetaLocal = createLocalPlugin({
      id: "zeta-local",
      label: "Zeta Local",
      route: "/zeta-local",
    });
    const builtinCollision = createLocalPlugin({
      id: PluginId.STAGINGS,
      label: "Shadow Stagings",
      route: "/shadow-stagings",
    });
    const localCollision = createLocalPlugin({
      id: "gamma-local",
      label: "Gamma Local",
      route: alphaLocal.route,
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    setLocalPlugins([zetaLocal, builtinCollision, localCollision, alphaLocal]);

    expect(getPlugins().map((plugin) => plugin.id)).toEqual([
      ...BUILTIN_PLUGINS.map((plugin) => plugin.id),
      "alpha-local",
      "zeta-local",
    ]);
    expect(getPlugins().filter((plugin) => plugin.origin === PluginOrigin.LOCAL).map((plugin) => plugin.id)).toEqual([
      "alpha-local",
      "zeta-local",
    ]);
    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Dropping local plugin "stagings" because plugin id "stagings" collides')
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'Dropping local plugin "gamma-local" because plugin route "/alpha-local" collides'
      )
    );
  });
});
