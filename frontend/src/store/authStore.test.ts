import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LoginResponse } from "@/api/types";
import { StorageKey } from "@/constants";

const backendClientMock = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  login: vi.fn(),
}));

vi.mock("@/api/backendClient", () => ({
  backendClient: backendClientMock,
}));

import { resetAuthStoreState, useAuthStore } from "@/store/authStore";

const loginResponse: LoginResponse = {
  access_token: "token-123",
  token_type: "bearer",
  user: {
    auto_login: false,
    created_at: "2026-08-09T00:00:00Z",
    display_name: "Administrator",
    enabled_plugins: ["stagings"],
    id: 1,
    is_admin: true,
    updated_at: "2026-08-09T00:00:00Z",
    username: "admin",
  },
};

describe("authStore", () => {
  beforeEach(() => {
    localStorage.clear();
    resetAuthStoreState();
    backendClientMock.getCurrentUser.mockReset();
    backendClientMock.login.mockReset();
  });

  it("stores the session on login and clears it on logout", async () => {
    backendClientMock.login.mockResolvedValue(loginResponse);

    await useAuthStore.getState().login(
      {
        password: "admin",
        username: "admin",
      },
      {
        autoLogin: true,
        rememberCredentials: true,
      }
    );

    expect(useAuthStore.getState().token).toBe("token-123");
    expect(useAuthStore.getState().currentUser?.username).toBe("admin");
    expect(localStorage.getItem(StorageKey.TOKEN)).toBe("token-123");
    expect(JSON.parse(localStorage.getItem(StorageKey.REMEMBER_ME) ?? "{}")).toEqual({
      password: "admin",
      rememberCredentials: true,
      username: "admin",
    });
    expect(localStorage.getItem(StorageKey.AUTO_LOGIN)).toBe("true");

    useAuthStore.getState().logout();

    expect(useAuthStore.getState().token).toBeNull();
    expect(useAuthStore.getState().currentUser).toBeNull();
    expect(localStorage.getItem(StorageKey.TOKEN)).toBeNull();
    expect(localStorage.getItem(StorageKey.REMEMBER_ME)).not.toBeNull();
  });
});
