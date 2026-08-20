import { describe, expect, it } from "vitest";

import { compareVersions } from "@/utils/compareVersions";

describe("compareVersions", () => {
  it("compares patch, minor, and major versions numerically", () => {
    expect(compareVersions("0.1.0", "0.1.0")).toBe(0);
    expect(compareVersions("0.1.1", "0.1.0")).toBe(1);
    expect(compareVersions("0.2.0", "0.10.0")).toBe(-1);
    expect(compareVersions("1.0.0", "0.9.9")).toBe(1);
  });
});
