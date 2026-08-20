import { describe, expect, it, vi } from "vitest";

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

vi.mock("@/plugins/profile/ProfilePage", () => ({
  ProfilePage: () => null,
}));

vi.mock("@/plugins/qaa-generator/QaaGeneratorSection", () => ({
  QaaGeneratorSection: () => null,
}));

vi.mock("@/plugins/stagings/StagingsSection", () => ({
  StagingsSection: () => null,
}));

import {
  CONTRACT_VERSION,
  IconName,
  PluginId,
  PluginOrigin,
  TabId,
  TabTitle,
  ViewKey,
} from "@/constants";
import { PluginKind, type PluginManifest } from "@/core/plugins/types";
import { PLUGINS, validatePluginManifests } from "@/plugins/discovery";

function createPluginManifest(overrides: Partial<PluginManifest>): PluginManifest {
  return {
    contractVersion: CONTRACT_VERSION,
    id: PluginId.STAGINGS,
    icon: IconName.ROCKET,
    kind: PluginKind.OPTIONAL,
    label: "Stagings",
    origin: PluginOrigin.BUILTIN,
    order: 10,
    requiresAgent: true,
    route: "/stagings",
    tabs: [
      {
        element: null,
        id: TabId.STAGINGS_PREFLIGHT,
        title: TabTitle[TabId.STAGINGS_PREFLIGHT],
        viewKey: ViewKey.STAGINGS_PREFLIGHT,
      },
    ],
    ...overrides,
  };
}

describe("plugin discovery", () => {
  it("discovers the shipped plugins in deterministic manifest order", () => {
    expect(PLUGINS.map((plugin) => plugin.id)).toEqual([
      PluginId.STAGINGS,
      PluginId.KUBER,
      PluginId.QAA_GENERATOR,
      PluginId.JENKINS,
      PluginId.STATISTICS,
      PluginId.ADMIN,
      PluginId.PROFILE,
    ]);
    expect(new Set(PLUGINS.map((plugin) => plugin.id)).size).toBe(PLUGINS.length);
    expect(new Set(PLUGINS.map((plugin) => plugin.route)).size).toBe(PLUGINS.length);

    const viewKeys = PLUGINS.flatMap((plugin) => plugin.tabs.map((tab) => tab.viewKey));
    expect(new Set(viewKeys).size).toBe(viewKeys.length);
    expect(PLUGINS[0]?.requiresAgent).toBe(true);
    expect(PLUGINS[1]?.requiresAgent).toBe(true);
    expect(PLUGINS[2]?.requiresAgent).toBe(false);
    expect(PLUGINS[3]?.kind).toBe(PluginKind.OPTIONAL);
    expect(PLUGINS[4]?.kind).toBe(PluginKind.OPTIONAL);
    expect(PLUGINS[4]?.requiresAgent).toBe(true);
    expect(PLUGINS[5]?.kind).toBe(PluginKind.SYSTEM);
    expect(PLUGINS[6]?.kind).toBe(PluginKind.SYSTEM);
  });

  it("rejects duplicate plugin ids", () => {
    expect(() =>
      validatePluginManifests([
        createPluginManifest({}),
        createPluginManifest({
          icon: IconName.SETTINGS,
          label: "Administration",
          order: 20,
          route: "/admin",
          tabs: [
            {
              element: null,
              id: TabId.PROFILE,
              title: TabTitle[TabId.PROFILE],
              viewKey: ViewKey.PROFILE,
            },
          ],
        }),
      ])
    ).toThrow(/duplicate plugin id/i);
  });

  it("rejects duplicate tab ids across plugins", () => {
    expect(() =>
      validatePluginManifests([
        createPluginManifest({}),
        createPluginManifest({
          contractVersion: CONTRACT_VERSION,
          icon: IconName.SETTINGS,
          id: PluginId.ADMIN,
          kind: PluginKind.SYSTEM,
          label: "Administration",
          origin: PluginOrigin.BUILTIN,
          order: 20,
          requiresAgent: false,
          route: "/admin",
          tabs: [
            {
              element: null,
              id: TabId.STAGINGS_PREFLIGHT,
              title: TabTitle[TabId.STAGINGS_PREFLIGHT],
              viewKey: ViewKey.PROFILE,
            },
          ],
        }),
      ])
    ).toThrow(/duplicate tab id/i);
  });

  it("rejects a non-admin-only system plugin that defaults to an admin-only tab", () => {
    expect(() =>
      validatePluginManifests([
        createPluginManifest({
          adminOnly: false,
          contractVersion: CONTRACT_VERSION,
          icon: IconName.SETTINGS,
          id: PluginId.ADMIN,
          kind: PluginKind.SYSTEM,
          label: "Administration",
          origin: PluginOrigin.BUILTIN,
          order: 20,
          requiresAgent: false,
          route: "/admin",
          tabs: [
            {
              adminOnly: true,
              element: null,
              id: TabId.ADMIN_USERS,
              title: TabTitle[TabId.ADMIN_USERS],
              viewKey: ViewKey.ADMIN_USERS,
            },
          ],
        }),
      ])
    ).toThrow(/admin-only tab/i);
  });

  it("allows an admin-only system plugin to default to an admin-only tab", () => {
    expect(() =>
      validatePluginManifests([
        createPluginManifest({
          adminOnly: true,
          contractVersion: CONTRACT_VERSION,
          icon: IconName.SETTINGS,
          id: PluginId.ADMIN,
          kind: PluginKind.SYSTEM,
          label: "Administration",
          origin: PluginOrigin.BUILTIN,
          order: 20,
          requiresAgent: false,
          route: "/admin",
          tabs: [
            {
              adminOnly: true,
              element: null,
              id: TabId.ADMIN_USERS,
              title: TabTitle[TabId.ADMIN_USERS],
              viewKey: ViewKey.ADMIN_USERS,
            },
          ],
        }),
      ])
    ).not.toThrow();
  });
});
