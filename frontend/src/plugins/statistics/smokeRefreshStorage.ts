import { DEFAULT_SMOKE_REFRESH_MS, SMOKE_REFRESH_OPTIONS_MS, StorageKey } from "@/constants";

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function readStoredSmokeRefreshMs(): number {
  if (!isBrowser()) {
    return DEFAULT_SMOKE_REFRESH_MS;
  }

  const stored = Number(window.localStorage.getItem(StorageKey.SMOKE_REFRESH));
  return (SMOKE_REFRESH_OPTIONS_MS as readonly number[]).includes(stored)
    ? stored
    : DEFAULT_SMOKE_REFRESH_MS;
}

export function writeStoredSmokeRefreshMs(refreshMs: number): void {
  if (!isBrowser()) {
    return;
  }

  window.localStorage.setItem(StorageKey.SMOKE_REFRESH, String(refreshMs));
}
