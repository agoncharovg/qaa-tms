import {
  DEFAULT_AGENT_PORT_RANGE,
  DEFAULT_API_BASE_URL,
  StorageKey,
} from "@/constants";

const RANGE_SEPARATOR = "-" as const;
const ALT_RANGE_SEPARATOR = ".." as const;
const CSV_SEPARATOR = "," as const;

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readStorageValue(key: StorageKey): string | null {
  if (!isBrowser()) {
    return null;
  }

  return window.localStorage.getItem(key);
}

function writeStorageValue(key: StorageKey, value: string): void {
  if (!isBrowser()) {
    return;
  }

  window.localStorage.setItem(key, value);
}

function clearStorageValue(key: StorageKey): void {
  if (!isBrowser()) {
    return;
  }

  window.localStorage.removeItem(key);
}

export function parsePortRange(rawValue: string | undefined | null): number[] {
  const value = rawValue?.trim();
  if (!value) {
    return [...DEFAULT_AGENT_PORT_RANGE];
  }

  const rangeSeparator = value.includes(RANGE_SEPARATOR)
    ? RANGE_SEPARATOR
    : value.includes(ALT_RANGE_SEPARATOR)
      ? ALT_RANGE_SEPARATOR
      : null;
  if (rangeSeparator) {
    const [startRaw, endRaw] = value.split(rangeSeparator);
    const start = Number.parseInt(startRaw, 10);
    const end = Number.parseInt(endRaw, 10);
    if (Number.isNaN(start) || Number.isNaN(end) || end < start) {
      return [...DEFAULT_AGENT_PORT_RANGE];
    }

    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
  }

  const ports = value
    .split(CSV_SEPARATOR)
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((port) => Number.isFinite(port));

  return ports.length > 0 ? ports : [...DEFAULT_AGENT_PORT_RANGE];
}

export function resolveApiBaseUrl(): string {
  const localOverride = readStorageValue(StorageKey.APP_API_BASE_URL)?.trim();
  if (localOverride) {
    return localOverride;
  }

  const buildValue = import.meta.env.VITE_API_BASE_URL?.trim();
  if (buildValue) {
    return buildValue;
  }

  return DEFAULT_API_BASE_URL;
}

export function resolveAgentPortRange(): number[] {
  const localOverride = readStorageValue(StorageKey.APP_AGENT_PORTS);
  if (localOverride?.trim()) {
    return parsePortRange(localOverride);
  }

  return parsePortRange(import.meta.env.VITE_AGENT_PORTS);
}

export function setApiBaseUrlOverride(value: string): void {
  writeStorageValue(StorageKey.APP_API_BASE_URL, value.trim());
}

export function clearApiBaseUrlOverride(): void {
  clearStorageValue(StorageKey.APP_API_BASE_URL);
}

export function setAgentPortRangeOverride(value: string): void {
  writeStorageValue(StorageKey.APP_AGENT_PORTS, value.trim());
}

export function clearAgentPortRangeOverride(): void {
  clearStorageValue(StorageKey.APP_AGENT_PORTS);
}
