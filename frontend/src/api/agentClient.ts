import {
  AGENT_APP_NAME,
  AGENT_HOST,
  AGENT_REQUEST_HEADER,
  AGENT_REQUEST_HEADER_VALUE,
  AgentPath,
  DEFAULT_AGENT_PORT_RANGE,
  JobStreamEvent,
} from "@/constants";
import type {
  AgentPingResponse,
  AgentPreflightState,
  DeployRequest,
  JobCreateResponse,
  JobLogEvent,
  JobRead,
  JobStreamMessage,
  JobTerminalEvent,
  PreflightItem,
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
  headers.set("Accept", "application/json");
  headers.set(AGENT_REQUEST_HEADER, AGENT_REQUEST_HEADER_VALUE);

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
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
      { method: "GET" },
      undefined,
      signal
    );
    return agent.app === AGENT_APP_NAME ? { agent, port } : null;
  } catch {
    return null;
  }
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
    { method: "GET" },
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

export function buildAgentJobStreamPath(jobId: string): string {
  return `${AgentPath.JOBS}/${jobId}${AgentPath.STREAM}`;
}

function buildAgentJobPath(jobId: string): string {
  return `${AgentPath.JOBS}/${jobId}`;
}

function buildAgentJobCancelPath(jobId: string): string {
  return `${buildAgentJobPath(jobId)}${AgentPath.CANCEL}`;
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

export const agentClient = {
  cancelJob(port: number, token: string, jobId: string, signal?: AbortSignal): Promise<JobRead> {
    return readAgentJson<JobRead>(
      port,
      buildAgentJobCancelPath(jobId),
      { method: "POST" },
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
    return readAgentJson<JobCreateResponse>(
      port,
      AgentPath.DEPLOY,
      {
        body: JSON.stringify(payload),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      },
      token,
      signal
    );
  },

  getJob(port: number, token: string, jobId: string, signal?: AbortSignal): Promise<JobRead> {
    return readAgentJson<JobRead>(
      port,
      buildAgentJobPath(jobId),
      { method: "GET" },
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
    const response = await fetch(buildAgentUrl(port, buildAgentJobStreamPath(jobId)), {
      headers: createAgentHeaders(token),
      method: "GET",
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
  },
};
