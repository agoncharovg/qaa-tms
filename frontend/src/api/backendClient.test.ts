import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OperationListResponse, OperationRead, OperationReplay } from "@/api/types";
import { backendClient } from "@/api/backendClient";

describe("backendClient operations", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("parses the operations list and passes pagination params", async () => {
    const response: OperationListResponse = {
      items: [
        {
          agent_host: "laptop",
          agent_version: "0.1.0",
          created_at: "2026-08-09T10:00:00Z",
          exit_code: 0,
          finished_at: "2026-08-09T10:05:00Z",
          id: "00000000-0000-0000-0000-000000000001",
          ns: "qa-demo",
          recipe: {
            flags: {
              dryRun: false,
              full: true,
              noSync: false,
              stage: 2,
            },
            images: {
              "iam-api": "sha-123",
            },
            product: null,
            services: ["iam-api"],
            suites: [],
          },
          stagings_sha: "abc123",
          started_at: "2026-08-09T10:00:00Z",
          status: "success",
          type: "deploy",
          user_id: 1,
        },
      ],
      limit: 20,
      offset: 40,
      total: 41,
    };

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(response), {
        headers: {
          "Content-Type": "application/json",
        },
      })
    );

    const result = await backendClient.listOperations("token-123", {
      limit: 20,
      offset: 40,
    });

    expect(result).toEqual(response);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    const headers = new Headers(init?.headers);

    expect(url).toBe("http://localhost:8000/api/v1/operations?limit=20&offset=40");
    expect(init?.method).toBe("GET");
    expect(headers.get("Authorization")).toBe("Bearer token-123");
  });

  it("parses operation detail and replay responses", async () => {
    const detail: OperationRead = {
      agent_host: "laptop",
      agent_version: "0.1.0",
      created_at: "2026-08-09T10:00:00Z",
      exit_code: 1,
      finished_at: "2026-08-09T10:05:00Z",
      id: "00000000-0000-0000-0000-000000000002",
      log: "line 1\nline 2",
      ns: "qa-demo",
      recipe: {
        flags: {
          dryRun: false,
          full: true,
          noSync: false,
          stage: 3,
        },
        images: {
          "billing-api": "latest",
        },
        product: null,
        services: ["billing-api"],
        suites: [],
      },
      stagings_sha: "def456",
      started_at: "2026-08-09T10:00:00Z",
      status: "failed",
      type: "deploy",
      user_id: 1,
    };
    const replay: OperationReplay = {
      id: detail.id,
      ns: detail.ns,
      recipe: detail.recipe,
      type: detail.type,
    };

    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify(detail), {
          headers: {
            "Content-Type": "application/json",
          },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(replay), {
          headers: {
            "Content-Type": "application/json",
          },
        })
      );

    const detailResult = await backendClient.getOperation("token-123", detail.id);
    const replayResult = await backendClient.getOperationReplay("token-123", detail.id);

    expect(detailResult).toEqual(detail);
    expect(replayResult).toEqual(replay);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://localhost:8000/api/v1/operations/00000000-0000-0000-0000-000000000002"
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "http://localhost:8000/api/v1/operations/00000000-0000-0000-0000-000000000002/replay"
    );
  });

  it("returns a helpful message when the backend is unreachable", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await backendClient
      .login({
        password: "admin",
        username: "admin",
      })
      .then(() => {
        throw new Error("Expected login to fail");
      })
      .catch((error: unknown) => {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain(
          "Cannot reach backend at http://localhost:8000/api/v1/auth/login."
        );
        expect((error as Error).message).toContain("VITE_API_BASE_URL");
      });
  });

  it("includes HTTP status when backend error payload is not JSON", async () => {
    fetchMock.mockResolvedValue(
      new Response("service unavailable", {
        status: 503,
        statusText: "Service Unavailable",
      })
    );

    await expect(
      backendClient.login({
        password: "admin",
        username: "admin",
      })
    ).rejects.toThrow("Backend request failed with 503 Service Unavailable.");
  });
});
