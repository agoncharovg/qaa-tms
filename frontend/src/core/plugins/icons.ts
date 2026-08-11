import type { TablerIcon } from "@tabler/icons-react";
import { IconPuzzle, IconRocket, IconSettings, IconSparkles } from "@tabler/icons-react";

import { IconName } from "@/constants";

export const FALLBACK_PLUGIN_ICON = IconPuzzle;

export const ICON_REGISTRY: Record<IconName, TablerIcon> = {
  [IconName.ROCKET]: IconRocket,
  [IconName.SPARKLES]: IconSparkles,
  [IconName.SETTINGS]: IconSettings,
};

export function resolveIcon(name: string): TablerIcon {
  return ICON_REGISTRY[name as IconName] ?? FALLBACK_PLUGIN_ICON;
}
