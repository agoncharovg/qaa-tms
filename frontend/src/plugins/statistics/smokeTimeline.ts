import type { JenkinsBuild, JenkinsNode } from "@/api/types";
import { SMOKE_TIMELINE_WINDOW_MS } from "@/constants";
import { flattenPipelines } from "@/plugins/jenkins/treeUtils";

type SmokeSegmentKind = "build" | "idle";

interface SmokeSegmentBase {
  leftPct: number;
  widthPct: number;
  color: string;
  endMs: number;
  kind: SmokeSegmentKind;
  startMs: number;
}

export interface SmokeBuildSegment extends SmokeSegmentBase {
  build: JenkinsBuild;
  kind: "build";
  running: boolean;
}

export interface SmokeIdleSegment extends SmokeSegmentBase {
  build: null;
  kind: "idle";
  openEnded: boolean;
  running: false;
}

export type SmokeSegment = SmokeBuildSegment | SmokeIdleSegment;

export interface SmokeRow {
  pipeline: JenkinsNode;
  segments: SmokeSegment[];
}

export interface SmokeWindow {
  start: number;
  end: number;
}

export interface SmokeAxisTick {
  leftPct: number;
  timestamp: number;
}

interface RawSegmentBase {
  color: string;
  start: number;
  end: number;
  kind: SmokeSegmentKind;
}

interface RawBuildSegment extends RawSegmentBase {
  build: JenkinsBuild;
  kind: "build";
  running: boolean;
}

interface RawIdleSegment extends RawSegmentBase {
  build: null;
  kind: "idle";
  openEnded: boolean;
  running: false;
}

type RawSegment = RawBuildSegment | RawIdleSegment;

function buildColorName(build: JenkinsBuild): string {
  if (build.building) {
    return "blue";
  }
  if (build.result === "SUCCESS") {
    return "green";
  }
  if (build.result === "FAILURE" || build.result === "UNSTABLE") {
    return "red";
  }
  return "gray";
}

function buildSegmentColor(build: JenkinsBuild): string {
  return `var(--mantine-color-${buildColorName(build)}-6)`;
}

function idleSegmentColor(): string {
  return "var(--mantine-color-gray-6)";
}

export function collectSmokePipelines(roots: JenkinsNode[]): JenkinsNode[] {
  return roots.flatMap((root) => flattenPipelines(root));
}

function ascendingBuilds(builds: JenkinsBuild[]): JenkinsBuild[] {
  return [...builds]
    .filter((build) => build.timestamp > 0)
    .sort((left, right) => left.timestamp - right.timestamp);
}

export function computeSmokeWindow(now: number): SmokeWindow {
  return { start: now - SMOKE_TIMELINE_WINDOW_MS, end: now };
}

function rawSegmentsForPipeline(
  builds: JenkinsBuild[],
  now: number
): RawSegment[] {
  const ordered = ascendingBuilds(builds);
  const segments: RawSegment[] = [];

  ordered.forEach((build, index) => {
    const next = ordered[index + 1] ?? null;
    const nextStart = next ? next.timestamp : now;
    const blockStart = build.timestamp;
    const rawBlockEnd = build.building ? now : build.timestamp + build.durationMs;
    const blockEnd = Math.min(rawBlockEnd, nextStart);

    if (blockEnd > blockStart) {
      segments.push({
        build,
        color: buildSegmentColor(build),
        end: blockEnd,
        kind: "build",
        running: build.building,
        start: blockStart,
      });
    }

    if (nextStart > blockEnd) {
      segments.push({
        build: null,
        color: idleSegmentColor(),
        end: nextStart,
        kind: "idle",
        openEnded: next === null,
        running: false,
        start: blockEnd,
      });
    }
  });

  return segments;
}

export function computeSmokeRow(
  pipeline: JenkinsNode,
  window: SmokeWindow,
  now: number
): SmokeRow {
  const span = window.end - window.start;
  if (span <= 0) {
    return { pipeline, segments: [] };
  }

  const segments: SmokeSegment[] = [];
  for (const raw of rawSegmentsForPipeline(pipeline.builds, now)) {
    const start = Math.max(raw.start, window.start);
    const end = Math.min(raw.end, window.end);
    if (end <= start) {
      continue;
    }
    if (raw.kind === "build") {
      segments.push({
        build: raw.build,
        color: raw.color,
        endMs: raw.end,
        kind: raw.kind,
        leftPct: ((start - window.start) / span) * 100,
        running: raw.running,
        startMs: raw.start,
        widthPct: ((end - start) / span) * 100,
      });
      continue;
    }

    segments.push({
      build: null,
      color: raw.color,
      endMs: raw.end,
      kind: raw.kind,
      leftPct: ((start - window.start) / span) * 100,
      openEnded: raw.openEnded,
      running: false,
      startMs: raw.start,
      widthPct: ((end - start) / span) * 100,
    });
  }

  return { pipeline, segments };
}

export function computeSmokeRows(
  pipelines: JenkinsNode[],
  window: SmokeWindow,
  now: number
): SmokeRow[] {
  return pipelines.map((pipeline) => computeSmokeRow(pipeline, window, now));
}

export function computeSmokeAxisTicks(window: SmokeWindow, tickCount: number): SmokeAxisTick[] {
  const span = window.end - window.start;
  if (span <= 0 || tickCount < 2) {
    return [];
  }
  return Array.from({ length: tickCount }, (_, index) => {
    const fraction = index / (tickCount - 1);
    return {
      leftPct: fraction * 100,
      timestamp: window.start + fraction * span,
    };
  });
}

export function latestBuild(pipeline: JenkinsNode): JenkinsBuild | null {
  return ascendingBuilds(pipeline.builds).at(-1) ?? null;
}
