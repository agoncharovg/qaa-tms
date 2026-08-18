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
