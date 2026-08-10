import {
  AGENT_APP_NAME,
  AGENT_HOST,
  AGENT_REQUEST_HEADER,
  AGENT_REQUEST_HEADER_VALUE,
  AgentPath,
  AUTH_SCHEME_BEARER,
  buildAgentE2eSuitesPath,
  buildAgentJobCancelPath,
  buildAgentJobPath,
  buildAgentJobStreamPath,
  buildAgentNamespaceCredsPath,
  buildAgentNamespaceDeployRecipePath,
  buildAgentNamespaceLogsPath,
  buildAgentNamespaceStatusPath,
  DEFAULT_AGENT_PORT_RANGE,
  HttpHeader,
  HttpMethod,
  JobStreamEvent,
  MediaType,
  type Product,
} from "@/constants";
import type {
  AdoptRequest,
  AgentPingResponse,
  AgentPreflightState,
  DeployRequest,
  DestroyRequest,
  E2eRunRequest,
  E2eSuitesResponse,
  JobCreateResponse,
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
import { parseSseStream } from "@/api/sse";

type AgentDiscovery = {
  agent: AgentPingResponse;
  port: number;
};

function parsePortRange(rawValue: string | undefined): number[] {
  const value = rawValue?.trim();
  if (!value) {
    return [...DEFAULT_AGENT_PORT_RANGE];
  }

  const rangeSeparator = value.includes("-") ? "-" : value.includes("..") ? ".." : null;
  if (rangeSeparator) {
    const [startRaw, endRaw] = value.split(rangeSeparator);
    const start = Number.parseInt(startRaw, 10);
    const end = Number.parseInt(endRaw, 10);
    if (Number.isNaN(start) || Number.isNaN(end) || end < start) {
      return [...DEFAULT_AGENT_PORT_RANGE];
    }

    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
  }

  const ports = value
    .split(",")
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((port) => Number.isFinite(port));

  return ports.length > 0 ? ports : [...DEFAULT_AGENT_PORT_RANGE];
}

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
    throw new Error(payload?.detail ?? "Agent request failed.");
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

function createJsonBody(body: unknown): Pick<RequestInit, "body" | "headers" | "method"> {
  return {
    body: JSON.stringify(body),
    headers: {
      [HttpHeader.CONTENT_TYPE]: MediaType.JSON,
    },
    method: HttpMethod.POST,
  };
}

export function getConfiguredAgentPorts(): number[] {
  return parsePortRange(import.meta.env.VITE_AGENT_PORTS);
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

  listNamespaces(port: number, token: string, signal?: AbortSignal): Promise<NamespaceList> {
    return readAgentJson<NamespaceList>(
      port,
      AgentPath.NAMESPACES,
      { method: HttpMethod.GET },
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
};
