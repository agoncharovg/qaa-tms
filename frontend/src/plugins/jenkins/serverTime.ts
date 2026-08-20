// Server clocks are UTC, but SQLite-backed timestamps (e.g. freeze.createdAt)
// can come back without a tz designator while the in-memory tree cache emits an
// explicit offset. Normalize a missing tz to UTC so both sides compare on the
// same clock.
export function parseServerTimestampMs(value: string | null | undefined): number {
  if (!value) {
    return Number.NaN;
  }
  const trimmed = value.trim();
  const hasTimezone = /([zZ])|([+-]\d{2}:?\d{2})$/.test(trimmed);
  return Date.parse(hasTimezone ? trimmed : `${trimmed}Z`);
}
