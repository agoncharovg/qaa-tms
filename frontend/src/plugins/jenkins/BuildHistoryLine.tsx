import { Group, Tooltip } from "@mantine/core";

import type { JenkinsBuild } from "@/api/types";
import { formatBuildHistoryLabel, getBuildHistoryColor } from "@/plugins/jenkins/buildStatus";
import {
  getBuildHistoryLineWidth,
  resolveBuildHistorySlotCount,
} from "@/plugins/jenkins/buildHistoryLayout";

const BuildHistoryCopy = {
  BUILD_HISTORY: "Build history",
} as const;

const BuildHistoryValue = {
  EMPTY_SLOT_COLOR: "rgba(148, 163, 184, 0.2)",
  GAP_PX: 2,
  HEIGHT_PX: 8,
  WIDTH_PX: 12,
} as const;

export function BuildHistoryLine({
  builds,
  slotCount,
}: {
  builds: JenkinsBuild[];
  slotCount?: number | null;
}) {
  const resolvedSlotCount = resolveBuildHistorySlotCount(slotCount);
  const buildSlots = Array.from(
    { length: resolvedSlotCount },
    (_, index) => builds[index] ?? null
  );

  return (
    <Group
      aria-label={BuildHistoryCopy.BUILD_HISTORY}
      gap={BuildHistoryValue.GAP_PX}
      role="group"
      style={{ width: getBuildHistoryLineWidth(resolvedSlotCount) }}
      wrap="nowrap"
    >
      {buildSlots.map((build, index) =>
        build ? (
          <Tooltip key={build.url} label={formatBuildHistoryLabel(build)}>
            <div
              aria-label={formatBuildHistoryLabel(build)}
              role="img"
              style={{
                backgroundColor: getBuildHistoryColor(build),
                borderRadius: String(BuildHistoryValue.HEIGHT_PX) + "px",
                flex: "0 0 auto",
                height: BuildHistoryValue.HEIGHT_PX,
                width: BuildHistoryValue.WIDTH_PX,
              }}
            />
          </Tooltip>
        ) : (
          <div
            aria-hidden="true"
            key={"empty-slot-" + String(index)}
            style={{
              backgroundColor: BuildHistoryValue.EMPTY_SLOT_COLOR,
              borderRadius: String(BuildHistoryValue.HEIGHT_PX) + "px",
              flex: "0 0 auto",
              height: BuildHistoryValue.HEIGHT_PX,
              width: BuildHistoryValue.WIDTH_PX,
            }}
          />
        )
      )}
    </Group>
  );
}
