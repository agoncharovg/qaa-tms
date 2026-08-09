import { BackendPath, DEFAULT_API_BASE_URL } from "@/constants";
import type { LoginRequest, LoginResponse, User } from "@/api/types";

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? DEFAULT_API_BASE_URL).trim();

function buildBackendUrl(path: string): string {
  return new URL(path, apiBaseUrl).toString();
}

async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
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
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(payload?.detail ?? "Backend request failed.");
  }

  return (await response.json()) as T;
}

export const backendClient = {
  login(payload: LoginRequest): Promise<LoginResponse> {
    return request<LoginResponse>(BackendPath.AUTH_LOGIN, {
      body: JSON.stringify(payload),
      method: "POST",
    });
  },

  getCurrentUser(token: string): Promise<User> {
    return request<User>(BackendPath.ME, { method: "GET" }, token);
  },
};
