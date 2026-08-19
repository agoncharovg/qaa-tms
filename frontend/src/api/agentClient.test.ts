import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AdoptRequest,
  DeployRequest,
  DestroyRequest,
  E2eRunRequest,
  E2eSuitesResponse,
  JenkinsBuildsResponse,
  JenkinsResumeRunAccepted,
  JenkinsResumeRunRequest,
  JenkinsTreeResponse,
  JobCreateResponse,
  KubeCommandResult,
  KubeconfigStatus,
  KubeContextsResponse,
  KubeNamespacesResponse,
  KubePodDescribe,
  KubePodsResponse,
  KubeTopResponse,
  NamespaceCreds,
  NamespaceDeployRecipe,
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
        clean: true,
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

  it("sends the exact destroy, adopt, sync, and e2e payloads with bearer auth", async () => {
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
    const e2ePayload: E2eRunRequest = {
      ns: "qa-demo",
      product: "IAM",
      suites: ["smoke", "full"],
      image: "latest",
      mark: "auth and not slow",
      marks: "product_iam and smoke",
      threads: 7,
    };

    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(response), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(response), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(response), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(response), { status: 202 }));

    await agentClient.destroy(47600, "token-123", destroyPayload);
    await agentClient.adopt(47600, "token-123", adoptPayload);
    await agentClient.sync(47600, "token-123", syncPayload);
    await agentClient.e2eRun(47600, "token-123", e2ePayload);

    expect(fetchMock).toHaveBeenCalledTimes(4);

    const [destroyUrl, destroyInit] = fetchMock.mock.calls[0] ?? [];
    const [adoptUrl, adoptInit] = fetchMock.mock.calls[1] ?? [];
    const [syncUrl, syncInit] = fetchMock.mock.calls[2] ?? [];
    const [e2eUrl, e2eInit] = fetchMock.mock.calls[3] ?? [];

    expect(destroyUrl).toBe("http://127.0.0.1:47600/destroy");
    expect(adoptUrl).toBe("http://127.0.0.1:47600/adopt");
    expect(syncUrl).toBe("http://127.0.0.1:47600/sync");
    expect(e2eUrl).toBe("http://127.0.0.1:47600/e2e-run");
    expect(destroyInit?.body).toBe(JSON.stringify(destroyPayload));
    expect(adoptInit?.body).toBe(JSON.stringify(adoptPayload));
    expect(syncInit?.body).toBe(JSON.stringify(syncPayload));
    expect(e2eInit?.body).toBe(JSON.stringify(e2ePayload));

    for (const init of [destroyInit, adoptInit, syncInit, e2eInit]) {
      const headers = new Headers(init?.headers);
      expect(init?.method).toBe("POST");
      expect(headers.get("Authorization")).toBe("Bearer token-123");
      expect(headers.get("Content-Type")).toBe("application/json");
      expect(headers.get("Accept")).toBe("application/json");
      expect(headers.get("X-QAA-TMS")).toBe("1");
    }
  });
});

describe("agentClient jenkins requests", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("sends Jenkins tree and builds requests with bearer auth and URL-encoded paths", async () => {
    const tree: JenkinsTreeResponse = {
      signature: "scope-1234",
      roots: [
        {
          builds: [],
          children: [],
          color: null,
          kind: "folder",
          name: "PREPROD",
          scheduled: false,
          synthetic: false,
          path: "job/.QAA/job/E2E/job/PREPROD",
          status: null,
          url: "https://jenkins.p.gc.onl/job/.QAA/job/E2E/job/PREPROD/",
        },
      ],
    };
    const builds: JenkinsBuildsResponse = {
      builds: [
        {
          allureUrl: "https://jenkins.p.gc.onl/job/.QAA/job/E2E/job/PREPROD/job/Smoke/42/allure/",
          building: false,
          durationMs: 120000,
          number: 42,
          result: "SUCCESS",
          timestamp: 1723539600000,
          url: "https://jenkins.p.gc.onl/job/.QAA/job/E2E/job/PREPROD/job/Smoke/42/",
        },
      ],
    };

    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(tree), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(builds), { status: 200 }));

    expect(await agentClient.getJenkinsTree(47600, "token-123")).toEqual(tree);
    expect(
      await agentClient.getJenkinsBuilds(
        47600,
        "token-123",
        "job/.QAA/job/E2E/job/PREPROD/job/Smoke"
      )
    ).toEqual(builds);

    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [treeUrl, treeInit] = fetchMock.mock.calls[0] ?? [];
    const [buildsUrl, buildsInit] = fetchMock.mock.calls[1] ?? [];

    expect(treeUrl).toBe("http://127.0.0.1:47600/jenkins/tree");
    expect(buildsUrl).toBe(
      "http://127.0.0.1:47600/jenkins/builds?path=job%2F.QAA%2Fjob%2FE2E%2Fjob%2FPREPROD%2Fjob%2FSmoke"
    );
    expect(treeInit?.method).toBe("GET");
    expect(buildsInit?.method).toBe("GET");

    for (const init of [treeInit, buildsInit]) {
      const headers = new Headers(init?.headers);
      expect(headers.get("Authorization")).toBe("Bearer token-123");
      expect(headers.get("Accept")).toBe("application/json");
      expect(headers.get("X-QAA-TMS")).toBe("1");
    }
  });

  it("starts a Jenkins resume campaign on the local agent with bearer auth", async () => {
    const response: JenkinsResumeRunAccepted = {
      runId: "run-1",
    };
    const payload: JenkinsResumeRunRequest = {
      runId: "run-1",
      snapshot: [
        {
          fullName: ".QAA/E2E/PREPROD/Smoke",
          name: "Smoke",
          path: "job/.QAA/job/E2E/job/PREPROD/job/Smoke",
          scheduled: false,
          wasBuilding: false,
          wasDisabled: false,
        },
      ],
      restartPipelines: true,
    };

    fetchMock.mockResolvedValue(new Response(JSON.stringify(response), { status: 202 }));

    expect(await agentClient.startJenkinsResumeRun(47600, "token-123", payload)).toEqual(response);

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    const headers = new Headers(init?.headers);

    expect(url).toBe("http://127.0.0.1:47600/jenkins/resume-run");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify(payload));
    expect(headers.get("Authorization")).toBe("Bearer token-123");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("Accept")).toBe("application/json");
    expect(headers.get("X-QAA-TMS")).toBe("1");
  });
});

describe("agentClient kube requests", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("sends kube JSON requests with the expected URLs, methods, bodies, and bearer auth", async () => {
    const contexts: KubeContextsResponse = {
      contexts: [
        {
          cluster: "dev-cluster",
          current: true,
          name: "team/dev",
          namespace: "qa-demo",
          user: "dev-user",
        },
      ],
      currentContext: "team/dev",
      exitCode: 0,
    };
    const commandResult: KubeCommandResult = {
      raw: "ok\n",
      exitCode: 0,
    };
    const namespaces: KubeNamespacesResponse = {
      namespaces: [{ name: "qa-demo", phase: "Active" }],
      exitCode: 0,
    };
    const pods: KubePodsResponse = {
      pods: [
        {
          containers: ["api"],
          createdAt: "2026-08-11T08:00:00Z",
          name: "iam-api-123",
          node: "node-a",
          phase: "Running",
          ready: "1/1",
          restarts: 0,
        },
      ],
      exitCode: 0,
    };
    const describe: KubePodDescribe = {
      name: "iam-api-123",
      raw: "Name: iam-api-123\n",
      exitCode: 0,
    };
    const top: KubeTopResponse = {
      raw: "iam-api-123 10m 32Mi\n",
      exitCode: 0,
    };

    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(contexts), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(commandResult), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(namespaces), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(pods), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(describe), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(commandResult), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(top), { status: 200 }));

    expect(await agentClient.getKubeContexts(47600, "token-123")).toEqual(contexts);
    expect(await agentClient.useKubeContext(47600, "token-123", "team/prod")).toEqual(commandResult);
    expect(await agentClient.listKubeNamespaces(47600, "token-123", "team/prod")).toEqual(namespaces);
    expect(await agentClient.listKubePods(47600, "token-123", "team/prod", "qa-demo")).toEqual(pods);
    expect(await agentClient.describeKubePod(47600, "token-123", "iam-api-123", "team/prod", "qa-demo")).toEqual(
      describe
    );
    expect(
      await agentClient.deleteKubePod(47600, "token-123", "iam-api-123", {
        context: "team/prod",
        namespace: "qa-demo",
      })
    ).toEqual(commandResult);
    expect(await agentClient.getKubeTop(47600, "token-123", "team/prod", "qa-demo")).toEqual(top);

    expect(fetchMock).toHaveBeenCalledTimes(7);

    const [contextsUrl, contextsInit] = fetchMock.mock.calls[0] ?? [];
    const [useContextUrl, useContextInit] = fetchMock.mock.calls[1] ?? [];
    const [namespacesUrl, namespacesInit] = fetchMock.mock.calls[2] ?? [];
    const [podsUrl, podsInit] = fetchMock.mock.calls[3] ?? [];
    const [describeUrl, describeInit] = fetchMock.mock.calls[4] ?? [];
    const [deleteUrl, deleteInit] = fetchMock.mock.calls[5] ?? [];
    const [topUrl, topInit] = fetchMock.mock.calls[6] ?? [];

    expect(contextsUrl).toBe("http://127.0.0.1:47600/kube/contexts");
    expect(useContextUrl).toBe("http://127.0.0.1:47600/kube/contexts/use");
    expect(namespacesUrl).toBe("http://127.0.0.1:47600/kube/namespaces?context=team%2Fprod");
    expect(podsUrl).toBe("http://127.0.0.1:47600/kube/pods?namespace=qa-demo&context=team%2Fprod");
    expect(describeUrl).toBe(
      "http://127.0.0.1:47600/kube/pods/iam-api-123/describe?namespace=qa-demo&context=team%2Fprod"
    );
    expect(deleteUrl).toBe("http://127.0.0.1:47600/kube/pods/iam-api-123/delete");
    expect(topUrl).toBe("http://127.0.0.1:47600/kube/top?namespace=qa-demo&context=team%2Fprod");

    for (const init of [
      contextsInit,
      useContextInit,
      namespacesInit,
      podsInit,
      describeInit,
      deleteInit,
      topInit,
    ]) {
      const headers = new Headers(init?.headers);
      expect(headers.get("Authorization")).toBe("Bearer token-123");
      expect(headers.get("Accept")).toBe("application/json");
      expect(headers.get("X-QAA-TMS")).toBe("1");
    }

    expect(contextsInit?.method).toBe("GET");
    expect(namespacesInit?.method).toBe("GET");
    expect(podsInit?.method).toBe("GET");
    expect(describeInit?.method).toBe("GET");
    expect(topInit?.method).toBe("GET");
    expect(useContextInit?.method).toBe("POST");
    expect(deleteInit?.method).toBe("POST");
    expect(useContextInit?.body).toBe(JSON.stringify({ context: "team/prod" }));
    expect(deleteInit?.body).toBe(JSON.stringify({ context: "team/prod", namespace: "qa-demo" }));
  });

  it("streams kube pod logs through fetch SSE with bearer auth", async () => {
    const frames = [
      'event: log\ndata: {"type":"line","line":"line one"}\n\n',
      'event: terminal\ndata: {"type":"terminal","status":"success","exitCode":0}\n\n',
    ];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const frame of frames) {
          controller.enqueue(encoder.encode(frame));
        }
        controller.close();
      },
    });
    const onMessage = vi.fn();

    fetchMock.mockResolvedValue(
      new Response(body, {
        headers: {
          "Content-Type": "text/event-stream",
        },
        status: 200,
      })
    );

    await agentClient.streamKubePodLogs(
      47600,
      "token-123",
      "iam-api-123",
      {
        context: "team/prod",
        namespace: "qa-demo",
        container: "api",
        follow: true,
        tail: 200,
        previous: false,
      },
      onMessage
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    const headers = new Headers(init?.headers);

    expect(url).toBe(
      "http://127.0.0.1:47600/kube/pods/iam-api-123/logs?follow=true&namespace=qa-demo&previous=false&tail=200&context=team%2Fprod&container=api"
    );
    expect(init?.method).toBe("GET");
    expect(headers.get("Authorization")).toBe("Bearer token-123");
    expect(onMessage).toHaveBeenNthCalledWith(1, {
      event: "log",
      data: { type: "line", line: "line one" },
    });
    expect(onMessage).toHaveBeenNthCalledWith(2, {
      event: "terminal",
      data: { type: "terminal", status: "success", exitCode: 0 },
    });
  });
});

describe("agentClient kubeconfig requests", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("sends the kubeconfig status, refresh, and activate requests with bearer auth", async () => {
    const status: KubeconfigStatus = {
      active: false,
      activePath: "/tmp/.kube/config",
      ageSeconds: 173000,
      contentValid: true,
      exists: true,
      healthy: false,
      maxAgeSeconds: 172800,
      modifiedAt: "2026-08-11T08:00:00Z",
      path: "/tmp/.kube/ai-staging.yaml",
      reasons: ["stale"],
      recommendedAction: "refresh_and_activate",
      stale: true,
      tokenExpired: false,
      tokenExpiresAt: "2026-08-12T08:00:00Z",
      url: "https://kube.example/config",
    };
    const refreshed: KubeconfigStatus = {
      ...status,
      active: true,
      ageSeconds: 0,
      healthy: true,
      reasons: ["healthy"],
      recommendedAction: "none",
      stale: false,
    };

    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(status), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(refreshed), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(refreshed), { status: 200 }));

    expect(await agentClient.getKubeconfigStatus(47600, "token-123")).toEqual(status);
    expect(await agentClient.refreshKubeconfig(47600, "token-123", true)).toEqual(refreshed);
    expect(await agentClient.activateKubeconfig(47600, "token-123")).toEqual(refreshed);

    expect(fetchMock).toHaveBeenCalledTimes(3);

    const [statusUrl, statusInit] = fetchMock.mock.calls[0] ?? [];
    const [refreshUrl, refreshInit] = fetchMock.mock.calls[1] ?? [];
    const [activateUrl, activateInit] = fetchMock.mock.calls[2] ?? [];

    expect(statusUrl).toBe("http://127.0.0.1:47600/staging/kubeconfig/status");
    expect(refreshUrl).toBe("http://127.0.0.1:47600/staging/kubeconfig/refresh");
    expect(activateUrl).toBe("http://127.0.0.1:47600/staging/kubeconfig/activate");
    expect(statusInit?.method).toBe("GET");
    expect(refreshInit?.method).toBe("POST");
    expect(activateInit?.method).toBe("POST");
    expect(refreshInit?.body).toBe(JSON.stringify({ activate: true }));

    for (const init of [statusInit, refreshInit, activateInit]) {
      const headers = new Headers(init?.headers);
      expect(headers.get("Authorization")).toBe("Bearer token-123");
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

  it("parses the list, status, credentials, and local deploy-recipe responses with bearer auth", async () => {
    const list: NamespaceList = {
      clusterNamespaces: [
        {
          createdAt: "2026-08-07T15:17:19Z",
          hasLocalOverlay: true,
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
    const deployRecipe: NamespaceDeployRecipe = {
      ns: "qa-iam",
      recipe: {
        flags: {
          clean: true,
          dryRun: false,
          full: true,
          noSync: true,
          stage: 3,
        },
        images: {
          "iam-api": "sha-local",
        },
        product: null,
        services: ["iam-api", "billing"],
        suites: [],
      },
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
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(deployRecipe), {
          headers: {
            "Content-Type": "application/json",
          },
        })
      );

    const listResult = await agentClient.listNamespaces(47600, "token-123");
    const statusResult = await agentClient.getNamespaceStatus(47600, "token-123", "qa-demo");
    const credsResult = await agentClient.getNamespaceCreds(47600, "token-123", "qa-demo");
    const deployRecipeResult = await agentClient.getNamespaceDeployRecipe(47600, "token-123", "qa-iam");

    expect(listResult).toEqual(list);
    expect(statusResult).toEqual(status);
    expect(credsResult).toEqual(creds);
    expect(deployRecipeResult).toEqual(deployRecipe);
    expect(fetchMock).toHaveBeenCalledTimes(4);

    const firstHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    const secondHeaders = new Headers(fetchMock.mock.calls[1]?.[1]?.headers);
    const thirdHeaders = new Headers(fetchMock.mock.calls[2]?.[1]?.headers);
    const fourthHeaders = new Headers(fetchMock.mock.calls[3]?.[1]?.headers);

    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://127.0.0.1:47600/namespaces");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://127.0.0.1:47600/namespaces/qa-demo/status");
    expect(fetchMock.mock.calls[2]?.[0]).toBe("http://127.0.0.1:47600/namespaces/qa-demo/creds");
    expect(fetchMock.mock.calls[3]?.[0]).toBe("http://127.0.0.1:47600/namespaces/qa-iam/deploy-recipe");
    expect(firstHeaders.get("Authorization")).toBe("Bearer token-123");
    expect(secondHeaders.get("Authorization")).toBe("Bearer token-123");
    expect(thirdHeaders.get("Authorization")).toBe("Bearer token-123");
    expect(fourthHeaders.get("Authorization")).toBe("Bearer token-123");
  });

  it("parses the e2e suite registry response with bearer auth", async () => {
    const suites: E2eSuitesResponse = {
      product: "IAM",
      suites: [
        {
          name: "smoke",
          marks: "product_iam and smoke and not long_term",
        },
      ],
      exitCode: 0,
    };

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(suites), {
        headers: {
          "Content-Type": "application/json",
        },
      })
    );

    const result = await agentClient.getE2eSuites(47600, "token-123", "IAM");

    expect(result).toEqual(suites);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    const headers = new Headers(init?.headers);

    expect(url).toBe("http://127.0.0.1:47600/e2e/suites?product=IAM");
    expect(init?.method).toBe("GET");
    expect(headers.get("Authorization")).toBe("Bearer token-123");
    expect(headers.get("Accept")).toBe("application/json");
    expect(headers.get("X-QAA-TMS")).toBe("1");
  });
});
