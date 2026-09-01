import type { AgentAccess, MountContext } from "./contracts";

export const CONTRACT_VERSION = 1 as const;

export const SUPPORTED_CONTRACT_VERSION_RANGE = {
  min: CONTRACT_VERSION,
  max: CONTRACT_VERSION,
} as const;

export const AGENT_REQUEST_HEADER = "X-QAA-TMS" as const;
export const AGENT_REQUEST_HEADER_VALUE = "1" as const;
export const AUTH_SCHEME_BEARER = "Bearer" as const;

export const HttpHeader = {
  ACCEPT: "Accept",
  AUTHORIZATION: "Authorization",
  CONTENT_TYPE: "Content-Type",
} as const;

export const MediaType = {
  JSON: "application/json",
} as const;

export function isSupportedContractVersion(version: number): boolean {
  return (
    Number.isInteger(version) &&
    version >= SUPPORTED_CONTRACT_VERSION_RANGE.min &&
    version <= SUPPORTED_CONTRACT_VERSION_RANGE.max
  );
}

function normalizeAgentBaseUrl(agentBaseUrl: string): string {
  return agentBaseUrl.endsWith("/") ? agentBaseUrl : `${agentBaseUrl}/`;
}

interface AgentUrlContext {
  agent?: Pick<AgentAccess, "baseUrl" | "fetch">;
  agentBaseUrl?: string;
}

function readAgentBaseUrl(ctx: AgentUrlContext): string {
  return ctx.agent?.baseUrl || ctx.agentBaseUrl || "";
}

export function resolveAgentUrl(
  ctx: AgentUrlContext,
  path: string
): string {
  const agentBaseUrl = readAgentBaseUrl(ctx);
  if (!agentBaseUrl) {
    throw new Error("MountContext.agent.baseUrl or MountContext.agentBaseUrl is required.");
  }

  return new URL(path, normalizeAgentBaseUrl(agentBaseUrl)).href;
}

export interface CreateAgentHeadersOptions {
  token?: string;
  headers?: HeadersInit;
  accept?: string;
}

export function createAgentHeaders(options: CreateAgentHeadersOptions = {}): Headers {
  const headers = new Headers({
    [AGENT_REQUEST_HEADER]: AGENT_REQUEST_HEADER_VALUE,
    [HttpHeader.ACCEPT]: options.accept ?? MediaType.JSON,
  });

  if (options.token) {
    headers.set(HttpHeader.AUTHORIZATION, `${AUTH_SCHEME_BEARER} ${options.token}`);
  }

  const extraHeaders = new Headers(options.headers);
  extraHeaders.forEach((value, key) => {
    headers.set(key, value);
  });

  return headers;
}

export interface AgentFetchOptions extends Omit<RequestInit, "headers"> {
  path: string;
  token?: string;
  headers?: HeadersInit;
  fetchImpl?: typeof fetch;
}

export function agentFetch(
  ctx: Pick<MountContext, "agent" | "agentBaseUrl"> | Pick<MountContext, "agentBaseUrl">,
  { path, token, headers, fetchImpl = fetch, ...init }: AgentFetchOptions
): Promise<Response> {
  if ("agent" in ctx && ctx.agent) {
    return ctx.agent.fetch(path, {
      ...init,
      headers,
    });
  }

  return fetchImpl(resolveAgentUrl(ctx, path), {
    ...init,
    headers: createAgentHeaders({ headers, token }),
  });
}
