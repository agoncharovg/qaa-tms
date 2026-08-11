import {
  AUTH_SCHEME_BEARER,
  BackendPath,
  DEFAULT_API_BASE_URL,
  buildBackendQaaRunArtifactsPath,
  buildBackendQaaRunPath,
  buildBackendQaaRunPausePath,
  buildBackendQaaRunResumePath,
  buildBackendQaaRunStopPath,
  buildBackendQaaRunStreamPath,
  HttpHeader,
  HttpMethod,
  HttpStatus,
  MediaType,
  buildBackendOperationPath,
  buildBackendOperationReplayPath,
  type PluginId,
  buildBackendUserPath,
} from "@/constants";
import type {
  LoginRequest,
  LoginResponse,
  MePluginsResponse,
  OperationListResponse,
  OperationRead,
  OperationReplay,
  QaaRunArtifacts,
  QaaRunControlResponse,
  QaaRunCreateRequest,
  QaaRunEvent,
  QaaRunListResponse,
  QaaRunRead,
  User,
  UserCreateRequest,
  UserListResponse,
  UserUpdateRequest,
} from "@/api/types";
import { parseSseStream } from "@/api/sse";

const QAA_LIST_QUERY_PARAM = {
  CREATED_FROM: "created_from",
  CREATED_TO: "created_to",
  CURSOR: "cursor",
  EFFECTIVE_ACTOR: "effective_actor",
  JIRA_KEY: "jira_key",
  LIMIT: "limit",
  STATUS: "status",
} as const;

interface QaaRunsListParams {
  jiraKey?: string;
  status?: string[];
  effectiveActor?: string;
  createdFrom?: string;
  createdTo?: string;
  limit?: number;
  cursor?: string | null;
}

export class BackendHttpError extends Error {
  payload: unknown;
  status: number;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = "BackendHttpError";
    this.payload = payload;
    this.status = status;
  }
}

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? DEFAULT_API_BASE_URL).trim();

function buildBackendUrl(path: string): string {
  return new URL(path, apiBaseUrl).toString();
}

function getBrowserOrigin(): string | null {
  if (typeof window === "undefined" || typeof window.location?.origin !== "string") {
    return null;
  }

  return window.location.origin;
}

function toNetworkError(url: string, error: unknown): Error {
  if (error instanceof DOMException && error.name === "AbortError") {
    return new Error(`Request to ${url} was aborted.`);
  }

  const origin = getBrowserOrigin();
  const corsHint = origin ? ` If the backend is up, verify CORS_ORIGINS includes ${origin}.` : "";

  return new Error(
    `Cannot reach backend at ${url}. Check that the backend is running and VITE_API_BASE_URL is correct.${corsHint}`
  );
}

function extractBackendErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  if ("detail" in payload && typeof payload.detail === "string") {
    return payload.detail;
  }
  if ("error" in payload && typeof payload.error === "string") {
    return payload.error;
  }
  if (
    "error" in payload &&
    payload.error &&
    typeof payload.error === "object" &&
    "message" in payload.error &&
    typeof payload.error.message === "string"
  ) {
    return payload.error.message;
  }
  return null;
}

function toHttpError(response: Response, payload: unknown): Error {
  const detail = extractBackendErrorMessage(payload);
  if (detail) {
    return new BackendHttpError(detail, response.status, payload);
  }

  const statusText = response.statusText || "Unknown error";
  return new BackendHttpError(
    `Backend request failed with ${response.status} ${statusText}.`,
    response.status,
    payload
  );
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  token?: string,
  signal?: AbortSignal
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set(HttpHeader.ACCEPT, MediaType.JSON);

  if (init.body !== undefined && !headers.has(HttpHeader.CONTENT_TYPE)) {
    headers.set(HttpHeader.CONTENT_TYPE, MediaType.JSON);
  }

  if (token) {
    headers.set(HttpHeader.AUTHORIZATION, `${AUTH_SCHEME_BEARER} ${token}`);
  }

  const url = buildBackendUrl(path);
  let response: Response;

  try {
    response = await fetch(url, {
      ...init,
      headers,
      signal,
    });
  } catch (error) {
    throw toNetworkError(url, error);
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as unknown;
    throw toHttpError(response, payload);
  }

  if (response.status === HttpStatus.NO_CONTENT) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

interface ListOperationsParams {
  limit: number;
  offset: number;
  ns?: string;
  status?: string;
  type?: string;
  userId?: number;
}

function buildOperationsListPath(params: ListOperationsParams): string {
  const searchParams = new URLSearchParams();
  searchParams.set("limit", String(params.limit));
  searchParams.set("offset", String(params.offset));

  if (params.status) {
    searchParams.set("status", params.status);
  }
  if (params.type) {
    searchParams.set("type", params.type);
  }
  if (params.ns) {
    searchParams.set("ns", params.ns);
  }
  if (params.userId !== undefined) {
    searchParams.set("user_id", String(params.userId));
  }

  return `${BackendPath.OPERATIONS}?${searchParams.toString()}`;
}

function buildQaaRunsListPath(params: QaaRunsListParams): string {
  const searchParams = new URLSearchParams();

  if (params.jiraKey) {
    searchParams.set(QAA_LIST_QUERY_PARAM.JIRA_KEY, params.jiraKey);
  }
  if (params.effectiveActor) {
    searchParams.set(QAA_LIST_QUERY_PARAM.EFFECTIVE_ACTOR, params.effectiveActor);
  }
  if (params.createdFrom) {
    searchParams.set(QAA_LIST_QUERY_PARAM.CREATED_FROM, params.createdFrom);
  }
  if (params.createdTo) {
    searchParams.set(QAA_LIST_QUERY_PARAM.CREATED_TO, params.createdTo);
  }
  if (params.limit !== undefined) {
    searchParams.set(QAA_LIST_QUERY_PARAM.LIMIT, String(params.limit));
  }
  if (params.cursor) {
    searchParams.set(QAA_LIST_QUERY_PARAM.CURSOR, params.cursor);
  }
  for (const statusValue of params.status ?? []) {
    searchParams.append(QAA_LIST_QUERY_PARAM.STATUS, statusValue);
  }

  const serialized = searchParams.toString();
  return serialized ? `${BackendPath.QAA_RUNS}?${serialized}` : BackendPath.QAA_RUNS;
}

export const backendClient = {
  createQaaRun(
    token: string,
    payload: QaaRunCreateRequest,
    signal?: AbortSignal
  ): Promise<QaaRunRead> {
    return request<QaaRunRead>(
      BackendPath.QAA_RUNS,
      {
        body: JSON.stringify(payload),
        method: HttpMethod.POST,
      },
      token,
      signal
    );
  },

  getQaaRun(token: string, runId: string, signal?: AbortSignal): Promise<QaaRunRead> {
    return request<QaaRunRead>(buildBackendQaaRunPath(runId), { method: HttpMethod.GET }, token, signal);
  },

  getQaaRunArtifacts(token: string, runId: string, signal?: AbortSignal): Promise<QaaRunArtifacts> {
    return request<QaaRunArtifacts>(
      buildBackendQaaRunArtifactsPath(runId),
      { method: HttpMethod.GET },
      token,
      signal
    );
  },

  getCurrentUser(token: string, signal?: AbortSignal): Promise<User> {
    return request<User>(BackendPath.ME, { method: HttpMethod.GET }, token, signal);
  },

  getMyPlugins(token: string, signal?: AbortSignal): Promise<MePluginsResponse> {
    return request<MePluginsResponse>(BackendPath.ME_PLUGINS, { method: HttpMethod.GET }, token, signal);
  },

  updateMyPlugins(
    token: string,
    enabledPluginIds: PluginId[],
    signal?: AbortSignal
  ): Promise<MePluginsResponse> {
    return request<MePluginsResponse>(
      BackendPath.ME_PLUGINS,
      {
        body: JSON.stringify({ enabled_plugins: enabledPluginIds }),
        method: HttpMethod.PUT,
      },
      token,
      signal
    );
  },

  listUsers(token: string, signal?: AbortSignal): Promise<UserListResponse> {
    return request<UserListResponse>(BackendPath.USERS, { method: HttpMethod.GET }, token, signal);
  },

  createUser(token: string, payload: UserCreateRequest, signal?: AbortSignal): Promise<User> {
    return request<User>(
      BackendPath.USERS,
      {
        body: JSON.stringify(payload),
        method: HttpMethod.POST,
      },
      token,
      signal
    );
  },

  getUser(token: string, userId: number, signal?: AbortSignal): Promise<User> {
    return request<User>(buildBackendUserPath(userId), { method: HttpMethod.GET }, token, signal);
  },

  updateUser(
    token: string,
    userId: number,
    payload: UserUpdateRequest,
    signal?: AbortSignal
  ): Promise<User> {
    return request<User>(
      buildBackendUserPath(userId),
      {
        body: JSON.stringify(payload),
        method: HttpMethod.PATCH,
      },
      token,
      signal
    );
  },

  deleteUser(token: string, userId: number, signal?: AbortSignal): Promise<void> {
    return request<void>(buildBackendUserPath(userId), { method: HttpMethod.DELETE }, token, signal);
  },

  getOperation(token: string, operationId: string, signal?: AbortSignal): Promise<OperationRead> {
    return request<OperationRead>(
      buildBackendOperationPath(operationId),
      { method: HttpMethod.GET },
      token,
      signal
    );
  },

  getOperationReplay(
    token: string,
    operationId: string,
    signal?: AbortSignal
  ): Promise<OperationReplay> {
    return request<OperationReplay>(
      buildBackendOperationReplayPath(operationId),
      { method: HttpMethod.GET },
      token,
      signal
    );
  },

  listOperations(
    token: string,
    params: ListOperationsParams,
    signal?: AbortSignal
  ): Promise<OperationListResponse> {
    return request<OperationListResponse>(
      buildOperationsListPath(params),
      { method: HttpMethod.GET },
      token,
      signal
    );
  },

  listQaaRuns(token: string, params: QaaRunsListParams, signal?: AbortSignal): Promise<QaaRunListResponse> {
    return request<QaaRunListResponse>(
      buildQaaRunsListPath(params),
      { method: HttpMethod.GET },
      token,
      signal
    );
  },

  pauseQaaRun(token: string, runId: string, signal?: AbortSignal): Promise<QaaRunControlResponse> {
    return request<QaaRunControlResponse>(
      buildBackendQaaRunPausePath(runId),
      { method: HttpMethod.POST },
      token,
      signal
    );
  },

  resumeQaaRun(token: string, runId: string, signal?: AbortSignal): Promise<QaaRunControlResponse> {
    return request<QaaRunControlResponse>(
      buildBackendQaaRunResumePath(runId),
      { method: HttpMethod.POST },
      token,
      signal
    );
  },

  stopQaaRun(token: string, runId: string, signal?: AbortSignal): Promise<QaaRunControlResponse> {
    return request<QaaRunControlResponse>(
      buildBackendQaaRunStopPath(runId),
      { method: HttpMethod.POST },
      token,
      signal
    );
  },

  async streamQaaRun(
    token: string,
    runId: string,
    onMessage: (message: QaaRunEvent) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const response = await fetch(buildBackendUrl(buildBackendQaaRunStreamPath(runId)), {
      headers: {
        [HttpHeader.ACCEPT]: MediaType.TEXT_EVENT_STREAM,
        [HttpHeader.AUTHORIZATION]: `${AUTH_SCHEME_BEARER} ${token}`,
      },
      method: HttpMethod.GET,
      signal,
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as unknown;
      throw toHttpError(response, payload);
    }

    if (!response.body) {
      throw new Error("QAA run stream is unavailable.");
    }

    for await (const frame of parseSseStream(response.body, signal)) {
      onMessage(JSON.parse(frame.data) as QaaRunEvent);
    }
  },

  login(payload: LoginRequest, signal?: AbortSignal): Promise<LoginResponse> {
    return request<LoginResponse>(
      BackendPath.AUTH_LOGIN,
      {
        body: JSON.stringify(payload),
        method: HttpMethod.POST,
      },
      undefined,
      signal
    );
  },
};
