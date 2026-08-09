import {
  BackendPath,
  DEFAULT_API_BASE_URL,
  buildBackendOperationPath,
  buildBackendOperationReplayPath,
} from "@/constants";
import type {
  LoginRequest,
  LoginResponse,
  OperationListResponse,
  OperationRead,
  OperationReplay,
  User,
} from "@/api/types";

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? DEFAULT_API_BASE_URL).trim();

function buildBackendUrl(path: string): string {
  return new URL(path, apiBaseUrl).toString();
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  token?: string,
  signal?: AbortSignal
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");

  if (init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(buildBackendUrl(path), {
    ...init,
    headers,
    signal,
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(payload?.detail ?? "Backend request failed.");
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

export const backendClient = {
  getCurrentUser(token: string, signal?: AbortSignal): Promise<User> {
    return request<User>(BackendPath.ME, { method: "GET" }, token, signal);
  },

  getOperation(token: string, operationId: string, signal?: AbortSignal): Promise<OperationRead> {
    return request<OperationRead>(
      buildBackendOperationPath(operationId),
      { method: "GET" },
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
      { method: "GET" },
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
      { method: "GET" },
      token,
      signal
    );
  },

  login(payload: LoginRequest, signal?: AbortSignal): Promise<LoginResponse> {
    return request<LoginResponse>(BackendPath.AUTH_LOGIN, {
      body: JSON.stringify(payload),
      method: "POST",
    }, undefined, signal);
  },
};
