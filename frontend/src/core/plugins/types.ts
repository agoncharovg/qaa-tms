import type { ReactNode } from "react";
import type { TablerIcon } from "@tabler/icons-react";

import type { PluginId, TabId, ViewKey } from "@/constants";

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
  icon: TablerIcon;
  route: string;
  order: number;
  kind: PluginKind;
  adminOnly?: boolean;
  tabs: PluginTabSpec[];
  requiresAgent?: boolean;
}

export interface PluginTab extends PluginTabSpec {
  element: ReactNode;
}

export interface PluginManifest extends Omit<PluginSpec, "tabs"> {
  tabs: PluginTab[];
}
