import { beforeEach, describe, expect, it, vi } from "vitest";

describe("backendClient same-origin API base", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.resetModules();
    vi.stubGlobal("fetch", fetchMock);
    vi.unstubAllEnvs();
  });

  it("uses the browser origin when the build-time API base is explicitly empty", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "");
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ items: [], total: 0 }), {
        headers: {
          "Content-Type": "application/json",
        },
      })
    );

    const { backendClient } = await import("@/api/backendClient");

    await backendClient.listUsers("token-123");

    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${window.location.origin}/api/v1/users`);
  });
});
