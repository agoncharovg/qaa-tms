const VERSION_PART_SEPARATOR = "." as const;
const VERSION_PART_COUNT = 3 as const;

function parseVersion(version: string): number[] {
  const parts = version.split(VERSION_PART_SEPARATOR).map((part) => Number.parseInt(part, 10));
  return Array.from({ length: VERSION_PART_COUNT }, (_, index) => parts[index] ?? 0);
}

export function compareVersions(left: string, right: string): number {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);

  for (let index = 0; index < VERSION_PART_COUNT; index += 1) {
    const delta = leftParts[index] - rightParts[index];
    if (delta !== 0) {
      return delta < 0 ? -1 : 1;
    }
  }

  return 0;
}
