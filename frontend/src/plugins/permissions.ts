import type { User } from "@/api/types";
import { PluginId, type PluginId as PluginIdType } from "@/constants";
import type { PluginSpec } from "@/core/plugins/types";

/**
 * Read permission required to see a plugin. `null` means no permission gate
 * (system plugins). Kept in a leaf module (no dependency on the plugin
 * registry / discovery) so it can be imported anywhere without risking the
 * discovery import cycle.
 */
export const PLUGIN_REQUIRED_READ_PERMISSION: Record<PluginIdType, string | null> = {
  [PluginId.STAGINGS]: "stagings.read",
  [PluginId.KUBER]: "kuber.read",
  [PluginId.QAA_GENERATOR]: "qaa.read",
  [PluginId.JENKINS]: "jenkins.read",
  [PluginId.STATISTICS]: "statistics.read",
  [PluginId.LEONID]: "leonid.read",
  [PluginId.NOTEBOOK]: "notebook.read",
  [PluginId.NOTIFICATOR]: "notificator.read",
  [PluginId.ADMIN]: null,
  [PluginId.PROFILE]: null,
};

export function pluginPermitted(
  plugin: Pick<PluginSpec, "id">,
  user: Pick<User, "is_admin" | "effective_permissions"> | null | undefined
): boolean {
  if (!user) {
    return false;
  }
  if (user.is_admin) {
    return true;
  }
  const required = PLUGIN_REQUIRED_READ_PERMISSION[plugin.id];
  if (!required) {
    return true;
  }
  return (user.effective_permissions ?? []).includes(required);
}
