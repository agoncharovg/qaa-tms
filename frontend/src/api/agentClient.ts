import {
  AGENT_APP_NAME,
  AGENT_HOST,
  AGENT_REQUEST_HEADER,
  AGENT_REQUEST_HEADER_VALUE,
  AgentPath,
  buildAgentJenkinsBuildsPath,
  buildAgentJenkinsScopePath,
  buildAgentJenkinsTreePath,
  AUTH_SCHEME_BEARER,
  buildAgentE2eSuitesPath,
  buildAgentJobCancelPath,
  buildAgentJobPath,
  buildAgentJobStreamPath,
  buildAgentKubeNamespacesPath,
  buildAgentKubePodDeletePath,
  buildAgentKubePodDescribePath,
  buildAgentKubePodLogsPath,
  buildAgentKubePodsPath,
  buildAgentKubeTopPath,
  buildAgentNamespaceCredsPath,
  buildAgentNamespaceDeployRecipePath,
  buildAgentNamespaceLogsPath,
  buildAgentNamespaceStatusPath,
  HttpHeader,
  HttpMethod,
  JobStreamEvent,
  MediaType,
  type Product,
} from "@/constants";
import type {
  AdoptRequest,
  AgentSettings,
  AgentSettingsUpdate,
  AgentPingResponse,
  AgentPreflightState,
  DeployRequest,
  DestroyRequest,
  E2eRunRequest,
  E2eSuitesResponse,
  JenkinsBuildsResponse,
  JenkinsScopeResponse,
  JenkinsTreeResponse,
  JobCreateResponse,
  KubeCommandResult,
  KubeconfigRefreshRequest,
  KubeconfigStatus,
  KubeContextsResponse,
  KubeDeletePodRequest,
  KubeNamespacesResponse,
  KubePodDescribe,
  KubePodsResponse,
  KubeTopResponse,
  KubeUseContextRequest,
  JobLogEvent,
  JobRead,
  JobStreamMessage,
  JobTerminalEvent,
  NamespaceCreds,
  NamespaceDeployRecipe,
  NamespaceList,
  NamespaceStatus,
  PreflightItem,
  SyncRequest,
} from "@/api/types";
import { resolveAgentPortRange } from "@/core/runtimeConfig";
import { parseSseStream } from "@/api/sse";

export class AgentRequestError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AgentRequestError";
    this.status = status;
  }
}

type AgentDiscovery = {
  agent: AgentPingResponse;
  port: number;
};

function buildAgentUrl(port: number, path: string): string {
  return `http://${AGENT_HOST}:${port}${path}`;
}

function createAgentHeaders(token?: string, extraHeaders?: HeadersInit): Headers {
  const headers = new Headers(extraHeaders);
  headers.set(HttpHeader.ACCEPT, MediaType.JSON);
  headers.set(AGENT_REQUEST_HEADER, AGENT_REQUEST_HEADER_VALUE);

  if (token) {
    headers.set(HttpHeader.AUTHORIZATION, `${AUTH_SCHEME_BEARER} ${token}`);
  }

  return headers;
}

async function readAgentJson<T>(
  port: number,
  path: string,
  init: RequestInit = {},
  token?: string,
  signal?: AbortSignal
): Promise<T> {
  const response = await fetch(buildAgentUrl(port, path), {
    ...init,
    headers: createAgentHeaders(token, init.headers),
    signal,
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new AgentRequestError(payload?.detail ?? "Agent request failed.", response.status);
  }

  return (await response.json()) as T;
}

async function probeAgentPort(port: number, signal?: AbortSignal): Promise<AgentDiscovery | null> {
  try {
    const agent = await readAgentJson<AgentPingResponse>(
      port,
      AgentPath.PING,
      { method: HttpMethod.GET },
      undefined,
      signal
    );
    return agent.app === AGENT_APP_NAME ? { agent, port } : null;
  } catch {
    return null;
  }
}

function createJsonBody(
  body: unknown,
  method: HttpMethod = HttpMethod.POST
): Pick<RequestInit, "body" | "headers" | "method"> {
  return {
    body: JSON.stringify(body),
    headers: {
      [HttpHeader.CONTENT_TYPE]: MediaType.JSON,
    },
    method,
  };
}

export function getConfiguredAgentPorts(): number[] {
  return resolveAgentPortRange();
}

export async function discoverAgent(signal?: AbortSignal): Promise<AgentDiscovery | null> {
  const ports = getConfiguredAgentPorts();
  for (const port of ports) {
    const match = await probeAgentPort(port, signal);
    if (match) {
      return match;
    }
  }

  return null;
}

export async function getPreflight(token: string, signal?: AbortSignal): Promise<AgentPreflightState> {
  const ports = getConfiguredAgentPorts();
  const discovery = await discoverAgent(signal);
  if (!discovery) {
    return {
      detected: false,
      ports,
    };
  }

  const checklist = await readAgentJson<PreflightItem[]>(
    discovery.port,
    AgentPath.PREFLIGHT,
    { method: HttpMethod.GET },
    token,
    signal
  );

  return {
    agent: discovery.agent,
    checklist,
    detected: true,
    port: discovery.port,
  };
}

export function getJenkinsTree(
  port: number,
  token: string,
  signal?: AbortSignal
): Promise<JenkinsTreeResponse> {
  return readAgentJson<JenkinsTreeResponse>(
    port,
    buildAgentJenkinsTreePath(),
    { method: HttpMethod.GET },
    token,
    signal
  );
}

export function getJenkinsScope(
  port: number,
  token: string,
  signal?: AbortSignal
): Promise<JenkinsScopeResponse> {
  return readAgentJson<JenkinsScopeResponse>(
    port,
    buildAgentJenkinsScopePath(),
    { method: HttpMethod.GET },
    token,
    signal
  );
}

export function getJenkinsBuilds(
  port: number,
  token: string,
  path: string,
  signal?: AbortSignal
): Promise<JenkinsBuildsResponse> {
  return readAgentJson<JenkinsBuildsResponse>(
    port,
    buildAgentJenkinsBuildsPath(path),
    { method: HttpMethod.GET },
    token,
    signal
  );
}

export function getKubeconfigStatus(
  port: number,
  token: string,
  signal?: AbortSignal
): Promise<KubeconfigStatus> {
  return readAgentJson<KubeconfigStatus>(
    port,
    AgentPath.KUBECONFIG_STATUS,
    { method: HttpMethod.GET },
    token,
    signal
  );
}

export function refreshKubeconfig(
  port: number,
  token: string,
  activate: boolean,
  signal?: AbortSignal
): Promise<KubeconfigStatus> {
  const payload: KubeconfigRefreshRequest = { activate };
  return readAgentJson<KubeconfigStatus>(
    port,
    AgentPath.KUBECONFIG_REFRESH,
    createJsonBody(payload),
    token,
    signal
  );
}

export function activateKubeconfig(
  port: number,
  token: string,
  signal?: AbortSignal
): Promise<KubeconfigStatus> {
  return readAgentJson<KubeconfigStatus>(
    port,
    AgentPath.KUBECONFIG_ACTIVATE,
    { method: HttpMethod.POST },
    token,
    signal
  );
}

function parseJobStreamMessage(event: string, data: string): JobStreamMessage | null {
  if (event === JobStreamEvent.LOG) {
    return {
      data: JSON.parse(data) as JobLogEvent,
      event: JobStreamEvent.LOG,
    };
  }

  if (event === JobStreamEvent.TERMINAL) {
    return {
      data: JSON.parse(data) as JobTerminalEvent,
      event: JobStreamEvent.TERMINAL,
    };
  }

  return null;
}

async function streamAgentCommand(
  port: number,
  token: string,
  path: string,
  onMessage: (message: JobStreamMessage) => void,
  signal?: AbortSignal
): Promise<void> {
  const response = await fetch(buildAgentUrl(port, path), {
    headers: createAgentHeaders(token),
    method: HttpMethod.GET,
    signal,
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(payload?.detail ?? "Agent request failed.");
  }

  if (!response.body) {
    throw new Error("Agent stream is unavailable.");
  }

  for await (const frame of parseSseStream(response.body, signal)) {
    const message = parseJobStreamMessage(frame.event, frame.data);
    if (message) {
      onMessage(message);
    }
  }
}

export const agentClient = {
  activateKubeconfig,
  adopt(
    port: number,
    token: string,
    payload: AdoptRequest,
    signal?: AbortSignal
  ): Promise<JobCreateResponse> {
    return readAgentJson<JobCreateResponse>(port, AgentPath.ADOPT, createJsonBody(payload), token, signal);
  },

  cancelJob(port: number, token: string, jobId: string, signal?: AbortSignal): Promise<JobRead> {
    return readAgentJson<JobRead>(
      port,
      buildAgentJobCancelPath(jobId),
      { method: HttpMethod.POST },
      token,
      signal
    );
  },

  deploy(
    port: number,
    token: string,
    payload: DeployRequest,
    signal?: AbortSignal
  ): Promise<JobCreateResponse> {
    return readAgentJson<JobCreateResponse>(port, AgentPath.DEPLOY, createJsonBody(payload), token, signal);
  },

  destroy(
    port: number,
    token: string,
    payload: DestroyRequest,
    signal?: AbortSignal
  ): Promise<JobCreateResponse> {
    return readAgentJson<JobCreateResponse>(port, AgentPath.DESTROY, createJsonBody(payload), token, signal);
  },

  e2eRun(
    port: number,
    token: string,
    payload: E2eRunRequest,
    signal?: AbortSignal
  ): Promise<JobCreateResponse> {
    return readAgentJson<JobCreateResponse>(port, AgentPath.E2E_RUN, createJsonBody(payload), token, signal);
  },

  getE2eSuites(
    port: number,
    token: string,
    product: Product,
    signal?: AbortSignal
  ): Promise<E2eSuitesResponse> {
    return readAgentJson<E2eSuitesResponse>(
      port,
      buildAgentE2eSuitesPath(product),
      { method: HttpMethod.GET },
      token,
      signal
    );
  },

  getJob(port: number, token: string, jobId: string, signal?: AbortSignal): Promise<JobRead> {
    return readAgentJson<JobRead>(
      port,
      buildAgentJobPath(jobId),
      { method: HttpMethod.GET },
      token,
      signal
    );
  },

  getJenkinsBuilds,
  getJenkinsScope,
  getJenkinsTree,

  getSettings(port: number, token: string, signal?: AbortSignal): Promise<AgentSettings> {
    return readAgentJson<AgentSettings>(
      port,
      AgentPath.SETTINGS,
      { method: HttpMethod.GET },
      token,
      signal
    );
  },

  getKubeContexts(
    port: number,
    token: string,
    signal?: AbortSignal
  ): Promise<KubeContextsResponse> {
    return readAgentJson<KubeContextsResponse>(
      port,
      AgentPath.KUBE_CONTEXTS,
      { method: HttpMethod.GET },
      token,
      signal
    );
  },

  getKubeTop(
    port: number,
    token: string,
    context: string | null | undefined,
    namespace: string,
    signal?: AbortSignal
  ): Promise<KubeTopResponse> {
    return readAgentJson<KubeTopResponse>(
      port,
      buildAgentKubeTopPath(context, namespace),
      { method: HttpMethod.GET },
      token,
      signal
    );
  },

  getNamespaceCreds(
    port: number,
    token: string,
    namespace: string,
    signal?: AbortSignal
  ): Promise<NamespaceCreds> {
    return readAgentJson<NamespaceCreds>(
      port,
      buildAgentNamespaceCredsPath(namespace),
      { method: HttpMethod.GET },
      token,
      signal
    );
  },

  getNamespaceStatus(
    port: number,
    token: string,
    namespace: string,
    signal?: AbortSignal
  ): Promise<NamespaceStatus> {
    return readAgentJson<NamespaceStatus>(
      port,
      buildAgentNamespaceStatusPath(namespace),
      { method: HttpMethod.GET },
      token,
      signal
    );
  },

  getNamespaceDeployRecipe(
    port: number,
    token: string,
    namespace: string,
    signal?: AbortSignal
  ): Promise<NamespaceDeployRecipe> {
    return readAgentJson<NamespaceDeployRecipe>(
      port,
      buildAgentNamespaceDeployRecipePath(namespace),
      { method: HttpMethod.GET },
      token,
      signal
    );
  },

  listKubeNamespaces(
    port: number,
    token: string,
    context?: string | null,
    signal?: AbortSignal
  ): Promise<KubeNamespacesResponse> {
    return readAgentJson<KubeNamespacesResponse>(
      port,
      buildAgentKubeNamespacesPath(context),
      { method: HttpMethod.GET },
      token,
      signal
    );
  },

  listKubePods(
    port: number,
    token: string,
    context: string | null | undefined,
    namespace: string,
    signal?: AbortSignal
  ): Promise<KubePodsResponse> {
    return readAgentJson<KubePodsResponse>(
      port,
      buildAgentKubePodsPath(context, namespace),
      { method: HttpMethod.GET },
      token,
      signal
    );
  },

  listNamespaces(port: number, token: string, signal?: AbortSignal): Promise<NamespaceList> {
    return readAgentJson<NamespaceList>(
      port,
      AgentPath.NAMESPACES,
      { method: HttpMethod.GET },
      token,
      signal
    );
  },

  updateSettings(
    port: number,
    token: string,
    payload: AgentSettingsUpdate,
    signal?: AbortSignal
  ): Promise<AgentSettings> {
    return readAgentJson<AgentSettings>(
      port,
      AgentPath.SETTINGS,
      createJsonBody(payload, HttpMethod.PUT),
      token,
      signal
    );
  },

  describeKubePod(
    port: number,
    token: string,
    pod: string,
    context: string | null | undefined,
    namespace: string,
    signal?: AbortSignal
  ): Promise<KubePodDescribe> {
    return readAgentJson<KubePodDescribe>(
      port,
      buildAgentKubePodDescribePath(pod, context, namespace),
      { method: HttpMethod.GET },
      token,
      signal
    );
  },

  deleteKubePod(
    port: number,
    token: string,
    pod: string,
    payload: KubeDeletePodRequest,
    signal?: AbortSignal
  ): Promise<KubeCommandResult> {
    return readAgentJson<KubeCommandResult>(
      port,
      buildAgentKubePodDeletePath(pod),
      createJsonBody(payload),
      token,
      signal
    );
  },

  async streamJob(
    port: number,
    token: string,
    jobId: string,
    onMessage: (message: JobStreamMessage) => void,
    signal?: AbortSignal
  ): Promise<void> {
    return streamAgentCommand(port, token, buildAgentJobStreamPath(jobId), onMessage, signal);
  },

  async streamKubePodLogs(
    port: number,
    token: string,
    pod: string,
    params: {
      context?: string | null;
      namespace: string;
      container?: string | null;
      follow: boolean;
      tail: number;
      previous: boolean;
    },
    onMessage: (message: JobStreamMessage) => void,
    signal?: AbortSignal
  ): Promise<void> {
    return streamAgentCommand(
      port,
      token,
      buildAgentKubePodLogsPath(pod, params),
      onMessage,
      signal
    );
  },

  async streamNamespaceLogs(
    port: number,
    token: string,
    namespace: string,
    deploy: string,
    onMessage: (message: JobStreamMessage) => void,
    signal?: AbortSignal
  ): Promise<void> {
    return streamAgentCommand(
      port,
      token,
      buildAgentNamespaceLogsPath(namespace, deploy),
      onMessage,
      signal
    );
  },

  sync(
    port: number,
    token: string,
    payload: SyncRequest,
    signal?: AbortSignal
  ): Promise<JobCreateResponse> {
    return readAgentJson<JobCreateResponse>(port, AgentPath.SYNC, createJsonBody(payload), token, signal);
  },

  useKubeContext(
    port: number,
    token: string,
    context: string,
    signal?: AbortSignal
  ): Promise<KubeCommandResult> {
    const payload: KubeUseContextRequest = { context };
    return readAgentJson<KubeCommandResult>(
      port,
      AgentPath.KUBE_USE_CONTEXT,
      createJsonBody(payload),
      token,
      signal
    );
  },
  getKubeconfigStatus,
  refreshKubeconfig,
};
