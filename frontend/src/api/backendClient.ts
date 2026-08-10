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

function toHttpError(response: Response, payload: { detail?: string } | null): Error {
  if (payload?.detail) {
    return new Error(payload.detail);
  }

  const statusText = response.statusText || "Unknown error";
  return new Error(`Backend request failed with ${response.status} ${statusText}.`);
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
    const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw toHttpError(response, payload);
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
    return request<LoginResponse>(
      BackendPath.AUTH_LOGIN,
      {
        body: JSON.stringify(payload),
        method: "POST",
      },
      undefined,
      signal
    );
  },
};
