const RelativeTimeValue = {
  DAY_SECONDS: 86400,
  HOUR_SECONDS: 3600,
  MINUTE_SECONDS: 60,
  SECOND_MS: 1000,
} as const;

export function formatRelativeAge(timestampMs: number): string {
  const diffSeconds = Math.max(0, Math.floor((Date.now() - timestampMs) / RelativeTimeValue.SECOND_MS));
  if (diffSeconds >= RelativeTimeValue.DAY_SECONDS) {
    return `${Math.floor(diffSeconds / RelativeTimeValue.DAY_SECONDS)}d ago`;
  }
  if (diffSeconds >= RelativeTimeValue.HOUR_SECONDS) {
    return `${Math.floor(diffSeconds / RelativeTimeValue.HOUR_SECONDS)}h ago`;
  }
  if (diffSeconds >= RelativeTimeValue.MINUTE_SECONDS) {
    return `${Math.floor(diffSeconds / RelativeTimeValue.MINUTE_SECONDS)}m ago`;
  }
  return `${diffSeconds}s ago`;
}

export function formatRelativeAgeFromIso(isoTimestamp: string): string {
  const parsedTimestamp = Date.parse(isoTimestamp);
  if (Number.isNaN(parsedTimestamp)) {
    return isoTimestamp;
  }
  return formatRelativeAge(parsedTimestamp);
}

export function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / RelativeTimeValue.SECOND_MS));
  const minutes = Math.floor(totalSeconds / RelativeTimeValue.MINUTE_SECONDS);
  const seconds = totalSeconds % RelativeTimeValue.MINUTE_SECONDS;
  if (minutes === 0) {
    return `${seconds}s`;
  }
  return `${minutes}m ${seconds}s`;
}
