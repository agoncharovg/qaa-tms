import type { JenkinsBuild } from "@/api/types";

const BuildStatusCopy = {
  RUNNING: "Running",
  UNKNOWN: "Unknown",
} as const;

export function getBuildColor(build: JenkinsBuild): string {
  if (build.building) {
    return "blue";
  }
  if (build.result === "SUCCESS") {
    return "green";
  }
  if (build.result === "ABORTED" || build.result === "NOT_BUILT") {
    return "gray";
  }
  return "red";
}

export function getBuildHistoryColor(build: JenkinsBuild): string {
  return `var(--mantine-color-${getBuildColor(build)}-6)`;
}

export function formatBuildHistoryLabel(build: JenkinsBuild): string {
  return "#" + String(build.number) + ": " + getBuildLabel(build);
}

export function getBuildLabel(build: JenkinsBuild): string {
  if (build.building) {
    return BuildStatusCopy.RUNNING;
  }
  return build.result ?? BuildStatusCopy.UNKNOWN;
}
