import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DeployRequest, JobCreateResponse } from "@/api/types";
import { agentClient } from "@/api/agentClient";

describe("agentClient.deploy", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("sends the exact deploy payload with bearer auth", async () => {
    const response: JobCreateResponse = {
      jobId: "job-123",
      opId: "00000000-0000-0000-0000-000000000123",
    };
    const payload: DeployRequest = {
      flags: {
        dryRun: true,
        full: true,
        noSync: true,
        stage: 4,
      },
      images: {
        "billing-api": "latest",
        "iam-api": "sha-123",
      },
      ns: "qa-demo",
      services: ["iam-api", "billing-api"],
    };

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(response), {
        headers: {
          "Content-Type": "application/json",
        },
        status: 202,
      })
    );

    const result = await agentClient.deploy(47600, "token-123", payload);

    expect(result).toEqual(response);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    const headers = new Headers(init?.headers);

    expect(url).toBe("http://127.0.0.1:47600/deploy");
    expect(init?.method).toBe("POST");
    expect(headers.get("Authorization")).toBe("Bearer token-123");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("Accept")).toBe("application/json");
    expect(headers.get("X-QAA-TMS")).toBe("1");
    expect(init?.body).toBe(JSON.stringify(payload));
  });
});
