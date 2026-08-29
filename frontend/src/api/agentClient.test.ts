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
  KubeExecRequest,
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

    fetchMock.mockResolvedValue(new Response(JSON.stringify(response), { status: 202 }));

    const result = await agentClient.deploy(47600, "token-123", payload);

    expect(result).toEqual(response);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    const headers = new Headers(init?.headers);

    expect(url).toBe("http://127.0.0.1:47600/deploy");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify(payload));
    expect(headers.get("Authorization")).toBe("Bearer token-123");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("Accept")).toBe("application/json");
    expect(headers.get("X-QAA-TMS")).toBe("1");
  });

  it("sends destroy, adopt, sync, and e2e payloads with bearer auth", async () => {
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
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://127.0.0.1:47600/destroy");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://127.0.0.1:47600/adopt");
    expect(fetchMock.mock.calls[2]?.[0]).toBe("http://127.0.0.1:47600/sync");
    expect(fetchMock.mock.calls[3]?.[0]).toBe("http://127.0.0.1:47600/e2e-run");
  });
});

describe("agentClient jenkins requests", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("sends Jenkins tree, builds, and resume-run requests", async () => {
    const tree: JenkinsTreeResponse = {
      signature: "scope-1234",
      roots: [],
    };
    const builds: JenkinsBuildsResponse = { builds: [] };
    const accepted: JenkinsResumeRunAccepted = { runId: "run-1" };
    const payload: JenkinsResumeRunRequest = {
      restartPipelines: true,
      runId: "run-1",
      snapshot: [],
    };

    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(tree), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(builds), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(accepted), { status: 202 }));

    expect(await agentClient.getJenkinsTree(47600, "token-123")).toEqual(tree);
    expect(await agentClient.getJenkinsBuilds(47600, "token-123", "job/.QAA/job/E2E/job/PREPROD")).toEqual(builds);
    expect(await agentClient.startJenkinsResumeRun(47600, "token-123", payload)).toEqual(accepted);

    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://127.0.0.1:47600/jenkins/tree");
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "http://127.0.0.1:47600/jenkins/builds?path=job%2F.QAA%2Fjob%2FE2E%2Fjob%2FPREPROD"
    );
    expect(fetchMock.mock.calls[2]?.[0]).toBe("http://127.0.0.1:47600/jenkins/resume-run");
  });
});

describe("agentClient kube requests", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("sends kube JSON requests with the expected URLs", async () => {
    const contexts: KubeContextsResponse = {
      contexts: [{ cluster: "dev-cluster", current: true, name: "team/dev", namespace: "qa-demo", user: "dev-user" }],
      currentContext: "team/dev",
      exitCode: 0,
    };
    const commandResult: KubeCommandResult = { raw: "ok\n", exitCode: 0 };
    const namespaces: KubeNamespacesResponse = { namespaces: [{ name: "qa-demo", phase: "Active" }], exitCode: 0 };
    const pods: KubePodsResponse = {
      pods: [{ containers: ["api"], createdAt: "2026-08-11T08:00:00Z", name: "iam-api-123", node: "node-a", phase: "Running", ready: "1/1", restarts: 0 }],
      exitCode: 0,
    };
    const describe: KubePodDescribe = { name: "iam-api-123", raw: "Name: iam-api-123\n", exitCode: 0 };
    const top: KubeTopResponse = { raw: "iam-api-123 10m 32Mi\n", exitCode: 0 };

    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(contexts), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(commandResult), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(namespaces), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(pods), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(describe), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(commandResult), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(top), { status: 200 }));

    await agentClient.getKubeContexts(47600, "token-123");
    await agentClient.useKubeContext(47600, "token-123", "team/prod");
    await agentClient.listKubeNamespaces(47600, "token-123", "team/prod");
    await agentClient.listKubePods(47600, "token-123", "team/prod", "qa-demo");
    await agentClient.describeKubePod(47600, "token-123", "iam-api-123", "team/prod", "qa-demo");
    await agentClient.deleteKubePod(47600, "token-123", "iam-api-123", { context: "team/prod", namespace: "qa-demo" });
    await agentClient.getKubeTop(47600, "token-123", "team/prod", "qa-demo");

    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://127.0.0.1:47600/kube/contexts");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://127.0.0.1:47600/kube/contexts/use");
    expect(fetchMock.mock.calls[2]?.[0]).toBe("http://127.0.0.1:47600/kube/namespaces?context=team%2Fprod");
    expect(fetchMock.mock.calls[3]?.[0]).toBe("http://127.0.0.1:47600/kube/pods?namespace=qa-demo&context=team%2Fprod");
    expect(fetchMock.mock.calls[4]?.[0]).toBe("http://127.0.0.1:47600/kube/pods/iam-api-123/describe?namespace=qa-demo&context=team%2Fprod");
    expect(fetchMock.mock.calls[5]?.[0]).toBe("http://127.0.0.1:47600/kube/pods/iam-api-123/delete");
    expect(fetchMock.mock.calls[6]?.[0]).toBe("http://127.0.0.1:47600/kube/top?namespace=qa-demo&context=team%2Fprod");
  });

  it("streams kube pod logs through fetch SSE with bearer auth", async () => {
    const frames = [
      "event: log\ndata: {\"type\":\"line\",\"line\":\"line one\"}\n\n",
      "event: terminal\ndata: {\"type\":\"terminal\",\"status\":\"success\",\"exitCode\":0}\n\n",
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

    fetchMock.mockResolvedValue(new Response(body, { status: 200 }));

    await agentClient.streamKubePodLogs(
      47600,
      "token-123",
      "iam-api-123",
      { context: "team/prod", namespace: "qa-demo", container: "api", follow: true, tail: 200, previous: false },
      onMessage
    );

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://127.0.0.1:47600/kube/pods/iam-api-123/logs?follow=true&namespace=qa-demo&previous=false&tail=200&context=team%2Fprod&container=api"
    );
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("GET");
    expect(onMessage).toHaveBeenNthCalledWith(1, {
      event: "log",
      data: { type: "line", line: "line one" },
    });
    expect(onMessage).toHaveBeenNthCalledWith(2, {
      event: "terminal",
      data: { type: "terminal", status: "success", exitCode: 0 },
    });
  });

  it("streams kube pod exec over POST SSE with the JSON body", async () => {
    const frames = [
      "event: log\ndata: {\"type\":\"line\",\"line\":\"exec line\"}\n\n",
      "event: terminal\ndata: {\"type\":\"terminal\",\"status\":\"success\",\"exitCode\":0}\n\n",
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
    const payload: KubeExecRequest = {
      command: "echo hello",
      container: "api",
      context: "team/prod",
      namespace: "qa-demo",
    };
    const onMessage = vi.fn();

    fetchMock.mockResolvedValue(new Response(body, { status: 200 }));

    await agentClient.execKubePod(47600, "token-123", "iam-api-123", payload, onMessage);

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    const headers = new Headers(init?.headers);

    expect(url).toBe("http://127.0.0.1:47600/kube/pods/iam-api-123/exec");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify(payload));
    expect(headers.get("Authorization")).toBe("Bearer token-123");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(onMessage).toHaveBeenNthCalledWith(1, {
      event: "log",
      data: { type: "line", line: "exec line" },
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

    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(status), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(status), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(status), { status: 200 }));

    await agentClient.getKubeconfigStatus(47600, "token-123");
    await agentClient.refreshKubeconfig(47600, "token-123", true);
    await agentClient.activateKubeconfig(47600, "token-123");

    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://127.0.0.1:47600/staging/kubeconfig/status");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://127.0.0.1:47600/staging/kubeconfig/refresh");
    expect(fetchMock.mock.calls[2]?.[0]).toBe("http://127.0.0.1:47600/staging/kubeconfig/activate");
  });
});

describe("agentClient namespace reads", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("parses namespace list, status, credentials, deploy recipe, and e2e suites", async () => {
    const list: NamespaceList = {
      clusterNamespaces: [{ createdAt: "2026-08-07T15:17:19Z", hasLocalOverlay: true, name: "qa-demo", status: "Active" }],
      exitCode: 0,
      localOverlays: [{ name: "qa-iam" }],
      raw: "cluster\nlocal\n",
    };
    const status: NamespaceStatus = { exitCode: 3, ns: "qa-demo", raw: "pod/iam-api CrashLoopBackOff\n" };
    const creds: NamespaceCreds = { exitCode: 0, ns: "qa-demo", raw: "sysadmin: secret\n" };
    const deployRecipe: NamespaceDeployRecipe = {
      ns: "qa-iam",
      recipe: {
        flags: { clean: true, dryRun: false, full: true, noSync: true, stage: 3 },
        images: { "iam-api": "sha-local" },
        product: null,
        services: ["iam-api", "billing"],
        suites: [],
      },
    };
    const suites: E2eSuitesResponse = {
      exitCode: 0,
      product: "IAM",
      suites: [{ marks: "product_iam and smoke", name: "smoke" }],
    };

    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(list), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(status), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(creds), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(deployRecipe), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(suites), { status: 200 }));

    expect(await agentClient.listNamespaces(47600, "token-123")).toEqual(list);
    expect(await agentClient.getNamespaceStatus(47600, "token-123", "qa-demo")).toEqual(status);
    expect(await agentClient.getNamespaceCreds(47600, "token-123", "qa-demo")).toEqual(creds);
    expect(await agentClient.getNamespaceDeployRecipe(47600, "token-123", "qa-iam")).toEqual(deployRecipe);
    expect(await agentClient.getE2eSuites(47600, "token-123", "IAM")).toEqual(suites);

    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://127.0.0.1:47600/namespaces");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://127.0.0.1:47600/namespaces/qa-demo/status");
    expect(fetchMock.mock.calls[2]?.[0]).toBe("http://127.0.0.1:47600/namespaces/qa-demo/creds");
    expect(fetchMock.mock.calls[3]?.[0]).toBe("http://127.0.0.1:47600/namespaces/qa-iam/deploy-recipe");
    expect(fetchMock.mock.calls[4]?.[0]).toBe("http://127.0.0.1:47600/e2e/suites?product=IAM");
  });
});
