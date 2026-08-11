import type { ReactNode } from "react";

import type { IconName, PluginId, PluginOrigin, TabId, ViewKey } from "@/constants";
import type { MountContext, Unmount } from "@/core/plugins/host";

export const PluginKind = {
  SYSTEM: "system",
  OPTIONAL: "optional",
} as const;

export type PluginKind = (typeof PluginKind)[keyof typeof PluginKind];

export interface PluginTabSpec {
  id: TabId;
  title: string;
  viewKey: ViewKey;
  adminOnly?: boolean;
}

export interface PluginSpec {
  id: PluginId;
  label: string;
  icon: IconName;
  route: string;
  order: number;
  kind: PluginKind;
  origin: PluginOrigin;
  contractVersion: number;
  adminOnly?: boolean;
  tabs: PluginTabSpec[];
  requiresAgent?: boolean;
}

export interface PluginElementTab extends PluginTabSpec {
  element: ReactNode;
  mount?: never;
}

export interface PluginMountTab extends PluginTabSpec {
  element?: never;
  mount: (context: MountContext) => Unmount;
}

export type PluginTab = PluginElementTab | PluginMountTab;

export interface PluginManifest extends Omit<PluginSpec, "tabs"> {
  tabs: PluginTab[];
}

export function pluginTabHasElement(tab: PluginTab): tab is PluginElementTab {
  return "element" in tab;
}

export function pluginTabHasMount(tab: PluginTab): tab is PluginMountTab {
  return "mount" in tab;
}
