import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearAgentPortRangeOverride,
  clearApiBaseUrlOverride,
  resolveAgentPortRange,
  resolveApiBaseUrl,
  setAgentPortRangeOverride,
  setApiBaseUrlOverride,
} from "@/core/runtimeConfig";
import { DEFAULT_AGENT_PORT_RANGE, DEFAULT_API_BASE_URL, StorageKey } from "@/constants";

describe("runtimeConfig", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.unstubAllEnvs();
  });

  it("prefers localStorage overrides over build-time values", () => {
    vi.stubEnv("VITE_API_BASE_URL", "http://env.example");
    vi.stubEnv("VITE_AGENT_PORTS", "48000-48002");

    setApiBaseUrlOverride("http://override.example");
    setAgentPortRangeOverride("49000, 49001");

    expect(resolveApiBaseUrl()).toBe("http://override.example");
    expect(resolveAgentPortRange()).toEqual([49000, 49001]);
  });

  it("falls back to build-time values when no override exists", () => {
    vi.stubEnv("VITE_API_BASE_URL", "http://env.example");
    vi.stubEnv("VITE_AGENT_PORTS", "48000-48002");

    clearApiBaseUrlOverride();
    clearAgentPortRangeOverride();

    expect(resolveApiBaseUrl()).toBe("http://env.example");
    expect(resolveAgentPortRange()).toEqual([48000, 48001, 48002]);
  });

  it("falls back to shipped defaults when both override and build-time values are absent", () => {
    localStorage.removeItem(StorageKey.APP_API_BASE_URL);
    localStorage.removeItem(StorageKey.APP_AGENT_PORTS);

    expect(resolveApiBaseUrl()).toBe(DEFAULT_API_BASE_URL);
    expect(resolveAgentPortRange()).toEqual([...DEFAULT_AGENT_PORT_RANGE]);
  });
});
