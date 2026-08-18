import { Group, Tooltip } from "@mantine/core";

import type { JenkinsBuild } from "@/api/types";
import { formatBuildHistoryLabel, getBuildHistoryColor } from "@/plugins/jenkins/buildStatus";

const BuildHistoryCopy = {
  BUILD_HISTORY: "Build history",
} as const;

const BuildHistoryValue = {
  HEIGHT_PX: 8,
  WIDTH_PX: 108,
} as const;

export function BuildHistoryLine({ builds }: { builds: JenkinsBuild[] }) {
  return (
    <Group
      aria-label={BuildHistoryCopy.BUILD_HISTORY}
      gap={2}
      role="group"
      style={{ width: BuildHistoryValue.WIDTH_PX }}
      wrap="nowrap"
    >
      {builds.map((build) => (
        <Tooltip key={build.url} label={formatBuildHistoryLabel(build)}>
          <div
            aria-label={formatBuildHistoryLabel(build)}
            role="img"
            style={{
              backgroundColor: getBuildHistoryColor(build),
              borderRadius: String(BuildHistoryValue.HEIGHT_PX) + "px",
              flex: 1,
              height: BuildHistoryValue.HEIGHT_PX,
              minWidth: 0,
            }}
          />
        </Tooltip>
      ))}
    </Group>
  );
}
