import { describe, expect, it } from "vitest";

import { PluginId } from "@/constants";
import {
  OPTIONAL_PLUGIN_IDS,
  enabledOptionalPluginIdSet,
  pluginById,
  pluginPermitted,
  pluginVisible,
} from "@/plugins/catalog";

function requirePlugin(pluginId: PluginId) {
  const plugin = pluginById(pluginId);
  expect(plugin).toBeDefined();
  return plugin!;
}

describe("pluginPermitted", () => {
  it("allows admins to access every plugin", () => {
    const adminUser = {
      effective_permissions: [],
      is_admin: true,
    };

    for (const pluginId of Object.values(PluginId)) {
      expect(pluginPermitted(requirePlugin(pluginId), adminUser)).toBe(true);
    }
  });

  it("matches read permissions for non-admin users", () => {
    const user = {
      effective_permissions: ["jenkins.read"],
      is_admin: false,
    };

    expect(pluginPermitted(requirePlugin(PluginId.JENKINS), user)).toBe(true);
    expect(pluginPermitted(requirePlugin(PluginId.KUBER), user)).toBe(false);
    expect(pluginPermitted(requirePlugin(PluginId.STAGINGS), user)).toBe(false);
  });

  it("allows null-required system plugins and blocks optionals without permissions", () => {
    const user = {
      effective_permissions: [],
      is_admin: false,
    };

    expect(pluginPermitted(requirePlugin(PluginId.PROFILE), user)).toBe(true);
    expect(pluginPermitted(requirePlugin(PluginId.ADMIN), user)).toBe(true);
    expect(pluginPermitted(requirePlugin(PluginId.JENKINS), user)).toBe(false);
    expect(pluginPermitted(requirePlugin(PluginId.KUBER), user)).toBe(false);
  });

  it("maps qaa-generator to qaa.read", () => {
    expect(
      pluginPermitted(requirePlugin(PluginId.QAA_GENERATOR), {
        effective_permissions: ["qaa.read"],
        is_admin: false,
      })
    ).toBe(true);
    expect(
      pluginPermitted(requirePlugin(PluginId.QAA_GENERATOR), {
        effective_permissions: ["qaa-generator.read"],
        is_admin: false,
      })
    ).toBe(false);
  });
});

describe("pluginVisible", () => {
  it("hides optional plugins for a guest-like user even when optional plugins default to enabled", () => {
    const guestUser = {
      effective_permissions: [],
      enabled_plugins: [],
      is_admin: false,
    };
    const enabledOptionalIds = enabledOptionalPluginIdSet();

    for (const pluginId of OPTIONAL_PLUGIN_IDS) {
      expect(pluginVisible(requirePlugin(pluginId), guestUser, enabledOptionalIds)).toBe(false);
    }
    expect(pluginVisible(requirePlugin(PluginId.PROFILE), guestUser, enabledOptionalIds)).toBe(true);
    expect(pluginVisible(requirePlugin(PluginId.ADMIN), guestUser, enabledOptionalIds)).toBe(false);
  });

  it("shows a permitted plugin only when its personal toggle is enabled", () => {
    const user = {
      effective_permissions: ["jenkins.read", "statistics.read"],
      enabled_plugins: [PluginId.JENKINS],
      is_admin: false,
    };

    expect(
      pluginVisible(requirePlugin(PluginId.JENKINS), user, enabledOptionalPluginIdSet([PluginId.JENKINS]))
    ).toBe(true);
    expect(
      pluginVisible(requirePlugin(PluginId.STATISTICS), user, enabledOptionalPluginIdSet([PluginId.JENKINS]))
    ).toBe(false);
  });

  it("hides a plugin that is permitted but toggled off", () => {
    const user = {
      effective_permissions: ["jenkins.read"],
      enabled_plugins: [],
      is_admin: false,
    };

    expect(
      pluginVisible(requirePlugin(PluginId.JENKINS), user, enabledOptionalPluginIdSet([]))
    ).toBe(false);
  });
});
