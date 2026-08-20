import { createElement, forwardRef } from "react";
import type { ComponentPropsWithoutRef } from "react";
import type { TablerIcon } from "@tabler/icons-react";
import {
  IconChartBar,
  IconPuzzle,
  IconRocket,
  IconServer,
  IconSettings,
  IconSparkles,
  IconUserCircle,
} from "@tabler/icons-react";

import { IconName } from "@/constants";

type LocalIconProps = ComponentPropsWithoutRef<"svg"> & {
  color?: string;
  size?: number | string;
  stroke?: number | string;
};

const JenkinsIcon = forwardRef<SVGSVGElement, LocalIconProps>(function JenkinsIcon(
  { color = "currentColor", size = 24, stroke = 2, ...props },
  ref
) {
  return createElement(
    "svg",
    {
      ...props,
      ref,
      fill: "none",
      height: size,
      stroke: color,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      strokeWidth: stroke,
      viewBox: "0 0 24 24",
      width: size,
    },
    [
      createElement("path", { d: "M7 7h10v7a5 5 0 0 1-10 0z", key: "body" }),
      createElement("path", { d: "M9 7V5h6v2", key: "lid" }),
      createElement("path", { d: "M11 12h2v5a2 2 0 1 1-4 0", key: "j" }),
      createElement("path", { d: "M17 10h1a2 2 0 0 1 0 4h-1", key: "handle" }),
    ]
  );
}) as TablerIcon;

export const FALLBACK_PLUGIN_ICON = IconPuzzle;

export const ICON_REGISTRY: Record<IconName, TablerIcon> = {
  [IconName.CLUSTER]: IconServer,
  [IconName.JENKINS]: JenkinsIcon,
  [IconName.ROCKET]: IconRocket,
  [IconName.SPARKLES]: IconSparkles,
  [IconName.SETTINGS]: IconSettings,
  [IconName.STATISTICS]: IconChartBar,
  [IconName.USER]: IconUserCircle,
};

export function resolveIcon(name: string): TablerIcon {
  return ICON_REGISTRY[name as IconName] ?? FALLBACK_PLUGIN_ICON;
}
