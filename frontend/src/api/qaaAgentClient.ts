import { AgentRequestError } from "@/api/agentClient";
import { parseSseStream } from "@/api/sse";
import type {
  QaaRunArtifacts,
  QaaRunControlResponse,
  QaaRunCreateRequest,
  QaaRunEvent,
  QaaRunListResponse,
  QaaRunRead,
} from "@/api/types";
import {
  AGENT_HOST,
  AGENT_REQUEST_HEADER,
  AGENT_REQUEST_HEADER_VALUE,
  AUTH_SCHEME_BEARER,
  HttpHeader,
  HttpMethod,
  MediaType,
} from "@/constants";

const QAA_RUNS_PATH = "/qaa/runs" as const;
const QAA_ARTIFACTS_PATH = "/artifacts" as const;
const QAA_EVENTS_STREAM_PATH = "/events/stream" as const;
const QAA_PAUSE_PATH = "/pause" as const;
const QAA_RESUME_PATH = "/resume" as const;
const QAA_STOP_PATH = "/stop" as const;

type QaaRunsListParams = {
  createdFrom?: string;
  createdTo?: string;
  cursor?: string | null;
  effectiveActor?: string;
  jiraKey?: string;
  limit?: number;
  status?: string[];
};

function buildAgentUrl(port: number, path: string): string {
  return `http://${AGENT_HOST}:${port}${path}`;
}

function createAgentHeaders(token: string, extraHeaders?: HeadersInit): Headers {
  const headers = new Headers(extraHeaders);
  headers.set(HttpHeader.ACCEPT, MediaType.JSON);
  headers.set(AGENT_REQUEST_HEADER, AGENT_REQUEST_HEADER_VALUE);
  headers.set(HttpHeader.AUTHORIZATION, `${AUTH_SCHEME_BEARER} ${token}`);
  return headers;
}

async function readQaaJson<T>(
  port: number,
  token: string,
  path: string,
  init: RequestInit = {},
  signal?: AbortSignal
): Promise<T> {
  const response = await fetch(buildAgentUrl(port, path), {
    ...init,
    headers: createAgentHeaders(token, init.headers),
    signal,
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as unknown;
    const message =
      typeof payload === "object" && payload !== null && "detail" in payload && typeof (payload as { detail?: unknown }).detail === "string"
        ? (payload as { detail: string }).detail
        : "Agent request failed.";
    const error = new AgentRequestError(message, response.status) as AgentRequestError & { payload?: unknown };
    error.payload = payload;
    throw error;
  }

  return (await response.json()) as T;
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

function buildQaaRunPath(runId: string): string {
  return `${QAA_RUNS_PATH}/${encodeURIComponent(runId)}`;
}

function buildQaaRunArtifactsPath(runId: string): string {
  return `${buildQaaRunPath(runId)}${QAA_ARTIFACTS_PATH}`;
}

function buildQaaRunPausePath(runId: string): string {
  return `${buildQaaRunPath(runId)}${QAA_PAUSE_PATH}`;
}

function buildQaaRunResumePath(runId: string): string {
  return `${buildQaaRunPath(runId)}${QAA_RESUME_PATH}`;
}

function buildQaaRunStopPath(runId: string): string {
  return `${buildQaaRunPath(runId)}${QAA_STOP_PATH}`;
}

function buildQaaRunStreamPath(runId: string): string {
  return `${buildQaaRunPath(runId)}${QAA_EVENTS_STREAM_PATH}`;
}

function buildQaaRunsListPath(params: QaaRunsListParams): string {
  const searchParams = new URLSearchParams();
  if (params.jiraKey) {
    searchParams.set("jira_key", params.jiraKey);
  }
  if (params.effectiveActor) {
    searchParams.set("effective_actor", params.effectiveActor);
  }
  if (params.createdFrom) {
    searchParams.set("created_from", params.createdFrom);
  }
  if (params.createdTo) {
    searchParams.set("created_to", params.createdTo);
  }
  if (params.limit !== undefined) {
    searchParams.set("limit", String(params.limit));
  }
  if (params.cursor) {
    searchParams.set("cursor", params.cursor);
  }
  for (const statusValue of params.status ?? []) {
    searchParams.append("status", statusValue);
  }
  const serialized = searchParams.toString();
  return serialized ? `${QAA_RUNS_PATH}?${serialized}` : QAA_RUNS_PATH;
}

export const qaaAgentClient = {
  createQaaRun(port: number, token: string, payload: QaaRunCreateRequest, signal?: AbortSignal): Promise<QaaRunRead> {
    return readQaaJson<QaaRunRead>(port, token, QAA_RUNS_PATH, createJsonBody(payload), signal);
  },

  listQaaRuns(port: number, token: string, params: QaaRunsListParams, signal?: AbortSignal): Promise<QaaRunListResponse> {
    return readQaaJson<QaaRunListResponse>(port, token, buildQaaRunsListPath(params), { method: HttpMethod.GET }, signal);
  },

  getQaaRun(port: number, token: string, runId: string, signal?: AbortSignal): Promise<QaaRunRead> {
    return readQaaJson<QaaRunRead>(port, token, buildQaaRunPath(runId), { method: HttpMethod.GET }, signal);
  },

  getQaaRunArtifacts(port: number, token: string, runId: string, signal?: AbortSignal): Promise<QaaRunArtifacts> {
    return readQaaJson<QaaRunArtifacts>(port, token, buildQaaRunArtifactsPath(runId), { method: HttpMethod.GET }, signal);
  },

  pauseQaaRun(port: number, token: string, runId: string, signal?: AbortSignal): Promise<QaaRunControlResponse> {
    return readQaaJson<QaaRunControlResponse>(port, token, buildQaaRunPausePath(runId), { method: HttpMethod.POST }, signal);
  },

  resumeQaaRun(port: number, token: string, runId: string, signal?: AbortSignal): Promise<QaaRunControlResponse> {
    return readQaaJson<QaaRunControlResponse>(port, token, buildQaaRunResumePath(runId), { method: HttpMethod.POST }, signal);
  },

  stopQaaRun(port: number, token: string, runId: string, signal?: AbortSignal): Promise<QaaRunControlResponse> {
    return readQaaJson<QaaRunControlResponse>(port, token, buildQaaRunStopPath(runId), { method: HttpMethod.POST }, signal);
  },

  async streamQaaRun(
    port: number,
    token: string,
    runId: string,
    onMessage: (message: QaaRunEvent, eventId: string | null) => void,
    signal?: AbortSignal,
    lastEventId?: string | null
  ): Promise<void> {
    const streamHeaders: Record<string, string> = {
      [HttpHeader.ACCEPT]: MediaType.TEXT_EVENT_STREAM,
    };
    // Resume after the last received event so a reconnect doesn't replay the whole
    // history — the proxy forwards this header to the qaa-generator service.
    if (lastEventId) {
      streamHeaders[HttpHeader.LAST_EVENT_ID] = lastEventId;
    }

    const response = await fetch(buildAgentUrl(port, buildQaaRunStreamPath(runId)), {
      headers: createAgentHeaders(token, streamHeaders),
      method: HttpMethod.GET,
      signal,
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as unknown;
      const message =
        typeof payload === "object" && payload !== null && "detail" in payload && typeof (payload as { detail?: unknown }).detail === "string"
          ? (payload as { detail: string }).detail
          : "Agent request failed.";
      const error = new AgentRequestError(message, response.status) as AgentRequestError & { payload?: unknown };
      error.payload = payload;
      throw error;
    }

    if (!response.body) {
      throw new Error("SSE response did not include a readable body.");
    }

    for await (const frame of parseSseStream(response.body, signal)) {
      // qaa-generator names each frame after the run event_type (RUN_STARTED,
      // RUN_COMPLETED, ...), never "message", so we handle every data frame.
      // Keepalive comments carry no data and are never yielded by the parser.
      onMessage(JSON.parse(frame.data) as QaaRunEvent, frame.id);
    }
  },
};

export type { QaaRunsListParams };
