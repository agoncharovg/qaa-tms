const BuildHistoryLayoutValue = {
  DEFAULT_SLOT_COUNT: 8,
  GAP_PX: 2,
  WIDTH_PX: 12,
} as const;

export function resolveBuildHistorySlotCount(slotCount: number | null | undefined): number {
  if (!slotCount || slotCount < 1) {
    return BuildHistoryLayoutValue.DEFAULT_SLOT_COUNT;
  }

  return slotCount;
}

export function getBuildHistoryLineWidth(slotCount: number | null | undefined): number {
  const resolvedSlotCount = resolveBuildHistorySlotCount(slotCount);
  return (
    resolvedSlotCount * BuildHistoryLayoutValue.WIDTH_PX +
    Math.max(0, resolvedSlotCount - 1) * BuildHistoryLayoutValue.GAP_PX
  );
}
