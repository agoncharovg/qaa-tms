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
  [PluginId.REQUESTS]: "requests.read",
  [PluginId.NOTIFICATOR]: "notificator.read",
  [PluginId.ADMIN]: null,
  [PluginId.PROFILE]: null,
};

/**
 * Action (non-read) permissions per plugin that gate its Profile → Settings
 * section. Settings only configures credentials/tokens used by mutating actions
 * (freeze/resume, deploy, …), so read-only users have no use for it — tree reads
 * and other read paths use a shared read-only token, not personal companion
 * settings. A plugin absent here (or with an empty list) has no editable
 * settings and its section is hidden for non-admins.
 */
export const PLUGIN_SETTINGS_ACTION_PERMISSIONS: Partial<Record<PluginIdType, string[]>> = {
  [PluginId.JENKINS]: ["jenkins.freeze", "jenkins.resume"],
  [PluginId.STAGINGS]: [
    "stagings.deploy",
    "stagings.destroy",
    "stagings.e2e_run",
  ],
  [PluginId.KUBER]: ["kuber.use_context", "kuber.delete_pod"],
  [PluginId.QAA_GENERATOR]: ["qaa.run", "qaa.admin"],
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

/**
 * True when the user holds `permission` (admins always pass). Use to gate
 * write/action controls whose backend endpoint requires that permission, so
 * read-only users never see buttons that would only 403 server-side.
 */
export function hasPermission(
  user: Pick<User, "is_admin" | "effective_permissions"> | null | undefined,
  permission: string
): boolean {
  if (!user) {
    return false;
  }
  if (user.is_admin) {
    return true;
  }
  return (user.effective_permissions ?? []).includes(permission);
}

/**
 * True when the user may edit `pluginId`'s Profile → Settings section: admins
 * always pass, otherwise they must hold at least one of the plugin's action
 * permissions. Read-only users (and plugins with no editable settings) get
 * `false` — read paths rely on shared read-only tokens, not these settings.
 */
export function canEditPluginSettings(
  pluginId: PluginIdType,
  user: Pick<User, "is_admin" | "effective_permissions"> | null | undefined
): boolean {
  if (!user) {
    return false;
  }
  if (user.is_admin) {
    return true;
  }
  const required = PLUGIN_SETTINGS_ACTION_PERMISSIONS[pluginId] ?? [];
  const granted = new Set(user.effective_permissions ?? []);
  return required.some((permission) => granted.has(permission));
}
