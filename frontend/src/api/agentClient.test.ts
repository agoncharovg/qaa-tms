import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AdoptRequest,
  DeployRequest,
  DestroyRequest,
  JobCreateResponse,
  NamespaceCreds,
  NamespaceList,
  NamespaceStatus,
  SyncRequest,
} from "@/api/types";
import { agentClient } from "@/api/agentClient";

describe("agentClient job creation requests", () => {
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

  it("sends the exact destroy, adopt, and sync payloads with bearer auth", async () => {
    const response: JobCreateResponse = {
      jobId: "job-456",
      opId: "00000000-0000-0000-0000-000000000456",
    };
    const destroyPayload: DestroyRequest = { ns: "qa-demo" };
    const adoptPayload: AdoptRequest = { ns: "qa-demo" };
    const syncPayload: SyncRequest = {
      flags: {
        apply: true,
        pull: false,
        service: "iam-api",
        verbose: true,
      },
    };

    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(response), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(response), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(response), { status: 202 }));

    await agentClient.destroy(47600, "token-123", destroyPayload);
    await agentClient.adopt(47600, "token-123", adoptPayload);
    await agentClient.sync(47600, "token-123", syncPayload);

    expect(fetchMock).toHaveBeenCalledTimes(3);

    const [destroyUrl, destroyInit] = fetchMock.mock.calls[0] ?? [];
    const [adoptUrl, adoptInit] = fetchMock.mock.calls[1] ?? [];
    const [syncUrl, syncInit] = fetchMock.mock.calls[2] ?? [];

    expect(destroyUrl).toBe("http://127.0.0.1:47600/destroy");
    expect(adoptUrl).toBe("http://127.0.0.1:47600/adopt");
    expect(syncUrl).toBe("http://127.0.0.1:47600/sync");
    expect(destroyInit?.body).toBe(JSON.stringify(destroyPayload));
    expect(adoptInit?.body).toBe(JSON.stringify(adoptPayload));
    expect(syncInit?.body).toBe(JSON.stringify(syncPayload));

    for (const init of [destroyInit, adoptInit, syncInit]) {
      const headers = new Headers(init?.headers);
      expect(init?.method).toBe("POST");
      expect(headers.get("Authorization")).toBe("Bearer token-123");
      expect(headers.get("Content-Type")).toBe("application/json");
      expect(headers.get("Accept")).toBe("application/json");
      expect(headers.get("X-QAA-TMS")).toBe("1");
    }
  });
});

describe("agentClient namespace reads", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("parses the list, status, and credentials responses with bearer auth", async () => {
    const list: NamespaceList = {
      clusterNamespaces: [
        {
          createdAt: "2026-08-07T15:17:19Z",
          name: "qa-demo",
          status: "Active",
        },
      ],
      exitCode: 0,
      localOverlays: [{ name: "qa-iam" }],
      raw: "cluster\nlocal\n",
    };
    const status: NamespaceStatus = {
      exitCode: 3,
      ns: "qa-demo",
      raw: "pod/iam-api CrashLoopBackOff\n",
    };
    const creds: NamespaceCreds = {
      exitCode: 0,
      ns: "qa-demo",
      raw: "sysadmin: secret\n",
    };

    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify(list), {
          headers: {
            "Content-Type": "application/json",
          },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(status), {
          headers: {
            "Content-Type": "application/json",
          },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(creds), {
          headers: {
            "Content-Type": "application/json",
          },
        })
      );

    const listResult = await agentClient.listNamespaces(47600, "token-123");
    const statusResult = await agentClient.getNamespaceStatus(47600, "token-123", "qa-demo");
    const credsResult = await agentClient.getNamespaceCreds(47600, "token-123", "qa-demo");

    expect(listResult).toEqual(list);
    expect(statusResult).toEqual(status);
    expect(credsResult).toEqual(creds);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const firstHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    const secondHeaders = new Headers(fetchMock.mock.calls[1]?.[1]?.headers);
    const thirdHeaders = new Headers(fetchMock.mock.calls[2]?.[1]?.headers);

    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://127.0.0.1:47600/namespaces");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://127.0.0.1:47600/namespaces/qa-demo/status");
    expect(fetchMock.mock.calls[2]?.[0]).toBe("http://127.0.0.1:47600/namespaces/qa-demo/creds");
    expect(firstHeaders.get("Authorization")).toBe("Bearer token-123");
    expect(secondHeaders.get("Authorization")).toBe("Bearer token-123");
    expect(thirdHeaders.get("Authorization")).toBe("Bearer token-123");
  });
});
