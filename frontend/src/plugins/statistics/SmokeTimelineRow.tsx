import { Box, Text, Tooltip } from "@mantine/core";

import type { JenkinsBuild } from "@/api/types";
import { usePalette } from "@/app/theme/usePalette";
import { formatDuration, formatRelativeAge } from "@/plugins/jenkins/relativeTime";
import type {
  SmokeBuildSegment,
  SmokeIdleSegment,
  SmokeRow,
  SmokeSegment,
} from "@/plugins/statistics/smokeTimeline";

const SmokeTimelineRowCopy = {
  IDLE: "Idle",
  NO_RUN: "no run",
  RUNNING: "Running",
  OTHER: "Other",
  NO_DATA: "No builds in range",
  STARTED: "started",
} as const;

const SmokeTimelineRowValue = {
  LABEL_WIDTH_PX: 260,
  ROW_HEIGHT_PX: 30,
} as const;

function formatClockTime(timestampMs: number): string {
  return new Date(timestampMs).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function buildOutcome(build: JenkinsBuild, running: boolean): string {
  if (running) {
    return SmokeTimelineRowCopy.RUNNING;
  }
  return build.result ?? SmokeTimelineRowCopy.OTHER;
}

function buildSegmentTooltip(segment: SmokeBuildSegment): string {
  const { build, running } = segment;
  const outcome = running
    ? SmokeTimelineRowCopy.RUNNING
    : buildOutcome(build, running);
  const duration = running ? formatRelativeAge(build.timestamp) : formatDuration(build.durationMs);
  return [
    `#${String(build.number)} · ${outcome}`,
    `${SmokeTimelineRowCopy.STARTED} ${formatClockTime(build.timestamp)}`,
    duration,
  ].join(" · ");
}

function idleSegmentTooltip(segment: SmokeIdleSegment): string {
  return [
    SmokeTimelineRowCopy.IDLE,
    SmokeTimelineRowCopy.NO_RUN,
    segment.openEnded
      ? formatRelativeAge(segment.startMs)
      : formatDuration(segment.endMs - segment.startMs),
  ].join(" · ");
}

function segmentTooltip(segment: SmokeSegment): string {
  return segment.kind === "build" ? buildSegmentTooltip(segment) : idleSegmentTooltip(segment);
}

export function SmokeTimelineRow({
  row,
  onOpenBuild,
}: {
  row: SmokeRow;
  onOpenBuild: (url: string) => void;
}) {
  const palette = usePalette();

  return (
    <Box
      style={{ alignItems: "center", display: "flex", gap: 12, width: "100%" }}
    >
      <Tooltip label={row.pipeline.name} openDelay={400}>
        <Text
          c={palette.inkSoft}
          size="sm"
          style={{
            flex: "0 0 auto",
            overflow: "hidden",
            textAlign: "right",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            width: SmokeTimelineRowValue.LABEL_WIDTH_PX,
          }}
        >
          {row.pipeline.name}
        </Text>
      </Tooltip>

      <Box
        style={{
          backgroundColor: palette.chip,
          borderRadius: 6,
          flex: "1 1 auto",
          height: SmokeTimelineRowValue.ROW_HEIGHT_PX,
          overflow: "hidden",
          position: "relative",
        }}
      >
        {row.segments.length === 0 ? (
          <Text
            c={palette.faint}
            size="xs"
            style={{
              left: 8,
              position: "absolute",
              top: "50%",
              transform: "translateY(-50%)",
            }}
          >
            {SmokeTimelineRowCopy.NO_DATA}
          </Text>
        ) : null}

        {row.segments.map((segment) => (
          <Tooltip
            key={`${segment.kind}-${String(segment.startMs)}-${String(segment.endMs)}-${String(segment.leftPct)}`}
            label={segmentTooltip(segment)}
          >
            <Box
              aria-label={segmentTooltip(segment)}
              onClick={
                segment.kind === "build"
                  ? () => onOpenBuild(segment.build.url)
                  : undefined
              }
              role={segment.kind === "build" ? "button" : undefined}
              style={{
                backgroundColor: segment.color,
                cursor: segment.kind === "build" ? "pointer" : "default",
                height: "100%",
                left: `${String(segment.leftPct)}%`,
                opacity: segment.kind === "idle" ? 0.25 : segment.running ? 0.9 : 1,
                position: "absolute",
                top: 0,
                width: `${String(Math.max(segment.widthPct, 0.4))}%`,
              }}
            />
          </Tooltip>
        ))}
      </Box>
    </Box>
  );
}

export { SmokeTimelineRowValue };
