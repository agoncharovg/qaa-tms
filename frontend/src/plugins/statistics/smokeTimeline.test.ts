import { describe, expect, it } from "vitest";

import type { JenkinsBuild, JenkinsNode } from "@/api/types";
import {
  computeSmokeAxisTicks,
  computeSmokeRow,
  computeSmokeWindow,
} from "@/plugins/statistics/smokeTimeline";

const NOW = 1_700_000_000_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function build(overrides: Partial<JenkinsBuild> & Pick<JenkinsBuild, "number" | "timestamp">): JenkinsBuild {
  return {
    result: "SUCCESS",
    building: false,
    durationMs: 2 * MINUTE,
    url: `https://jenkins.test/${String(overrides.number)}/`,
    allureUrl: `https://jenkins.test/${String(overrides.number)}/allure/`,
    ...overrides,
  };
}

function pipeline(builds: JenkinsBuild[]): JenkinsNode {
  return {
    name: "Billing Smoke",
    path: "job/.QAA/job/E2E/job/PREPROD/job/SMOKE/job/Billing",
    url: "https://jenkins.test/smoke/billing/",
    kind: "pipeline",
    status: null,
    color: null,
    synthetic: false,
    scheduled: false,
    builds,
    children: [],
  };
}

describe("computeSmokeWindow", () => {
  it("is a fixed one-hour window ending now, regardless of build history", () => {
    const window = computeSmokeWindow(NOW);
    expect(window.end).toBe(NOW);
    expect(window.start).toBe(NOW - HOUR);
  });
});

describe("computeSmokeRow", () => {
  it("renders a finished build as one result-colored block followed by idle to now", () => {
    const node = pipeline([
      build({ number: 7, timestamp: NOW - 10 * MINUTE, durationMs: 2 * MINUTE, result: "SUCCESS" }),
    ]);
    const window = { start: NOW - 15 * MINUTE, end: NOW };
    const row = computeSmokeRow(node, window, NOW);

    expect(row.segments).toHaveLength(2);
    const [finished, idle] = row.segments;
    expect(finished.kind).toBe("build");
    expect(finished.running).toBe(false);
    expect(finished.color).toContain("green");
    expect(Math.round(finished.leftPct)).toBe(Math.round((5 / 15) * 100));
    expect(idle.kind).toBe("idle");
    expect(idle.color).toContain("gray");
    expect(Math.round(idle.leftPct + idle.widthPct)).toBe(100);
  });

  it("renders a currently building build as a single blue interval up to now", () => {
    const node = pipeline([
      build({ number: 8, timestamp: NOW - 3 * MINUTE, building: true, result: null }),
    ]);
    const window = { start: NOW - 15 * MINUTE, end: NOW };
    const row = computeSmokeRow(node, window, NOW);

    expect(row.segments).toHaveLength(1);
    expect(row.segments[0]?.kind).toBe("build");
    expect(row.segments[0]?.running).toBe(true);
    expect(row.segments[0]?.color).toContain("blue");
    expect(Math.round(row.segments[0]?.widthPct ?? 0)).toBe(Math.round((3 / 15) * 100));
  });

  it("renders idle gaps in gray instead of holding the previous finished result color", () => {
    const node = pipeline([
      build({ number: 1, timestamp: NOW - 40 * MINUTE, durationMs: MINUTE, result: "FAILURE" }),
      build({ number: 2, timestamp: NOW - 5 * MINUTE, durationMs: MINUTE, result: "FAILURE" }),
    ]);
    const window = { start: NOW - 15 * MINUTE, end: NOW };
    const row = computeSmokeRow(node, window, NOW);

    expect(row.segments).toHaveLength(3);
    expect(row.segments[0]?.kind).toBe("idle");
    expect(row.segments[0]?.color).toContain("gray");
    expect(row.segments[0]?.leftPct).toBe(0);
    expect(row.segments[1]?.kind).toBe("build");
    expect(row.segments[1]?.color).toContain("red");
    expect(row.segments[2]?.kind).toBe("idle");
  });

  it("fills the window with idle gray when the last finished build ended before the window", () => {
    const node = pipeline([
      build({ number: 21, timestamp: NOW - 65 * MINUTE, durationMs: 5 * MINUTE, result: "SUCCESS" }),
    ]);
    const window = { start: NOW - HOUR, end: NOW };
    const row = computeSmokeRow(node, window, NOW);

    expect(row.segments).toHaveLength(1);
    expect(row.segments[0]?.kind).toBe("idle");
    expect(row.segments[0]?.color).toContain("gray");
    expect(row.segments[0]?.leftPct).toBe(0);
    expect(row.segments[0]?.widthPct).toBe(100);
  });
});

describe("computeSmokeAxisTicks", () => {
  it("returns evenly spaced ticks spanning the window", () => {
    const ticks = computeSmokeAxisTicks({ start: NOW - HOUR, end: NOW }, 5);
    expect(ticks).toHaveLength(5);
    expect(ticks[0]?.leftPct).toBe(0);
    expect(ticks[4]?.leftPct).toBe(100);
    expect(ticks[4]?.timestamp).toBe(NOW);
  });

  it("returns no ticks for an empty window", () => {
    expect(computeSmokeAxisTicks({ start: NOW, end: NOW }, 5)).toEqual([]);
  });
});
