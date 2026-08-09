import {
  AGENT_APP_NAME,
  AGENT_HOST,
  AGENT_REQUEST_HEADER,
  AgentPath,
  DEFAULT_AGENT_PORT_RANGE,
} from "@/constants";
import type { AgentPingResponse, AgentPreflightState, PreflightItem } from "@/api/types";

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

async function readAgentJson<T>(
  port: number,
  path: string,
  token?: string,
  signal?: AbortSignal
): Promise<T> {
  const headers = new Headers();
  headers.set("Accept", "application/json");
  headers.set(AGENT_REQUEST_HEADER, "1");

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(buildAgentUrl(port, path), {
    headers,
    method: "GET",
    signal,
  });

  if (!response.ok) {
    throw new Error("Agent request failed.");
  }

  return (await response.json()) as T;
}

async function probeAgentPort(port: number, signal?: AbortSignal): Promise<AgentDiscovery | null> {
  try {
    const agent = await readAgentJson<AgentPingResponse>(port, AgentPath.PING, undefined, signal);
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
  return `${AgentPath.JOBS}/${jobId}/stream`;
}
