import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  OperationListResponse,
  OperationRead,
  OperationReplay,
  User,
  UserCreateRequest,
  UserListResponse,
  UserUpdateRequest,
} from "@/api/types";
import { backendClient } from "@/api/backendClient";

describe("backendClient operations", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("parses the users list and sends the bearer token", async () => {
    const response: UserListResponse = {
      items: [
        {
          auto_login: false,
          created_at: "2026-08-09T10:00:00Z",
          display_name: "Administrator",
          enabled_plugins: ["stagings"],
          id: 1,
          is_admin: true,
          updated_at: "2026-08-09T10:00:00Z",
          username: "admin",
        },
      ],
      total: 1,
    };

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(response), {
        headers: {
          "Content-Type": "application/json",
        },
      })
    );

    const result = await backendClient.listUsers("token-123");

    expect(result).toEqual(response);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    const headers = new Headers(init?.headers);

    expect(url).toBe("http://localhost:8000/api/v1/users");
    expect(init?.method).toBe("GET");
    expect(headers.get("Authorization")).toBe("Bearer token-123");
  });

  it("gets and updates the caller plugin settings with the correct wire shape", async () => {
    const response = {
      enabled_plugins: ["stagings"],
    };

    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify(response), {
          headers: {
            "Content-Type": "application/json",
          },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ enabled_plugins: [] }), {
          headers: {
            "Content-Type": "application/json",
          },
        })
      );

    const getResult = await backendClient.getMyPlugins("token-123");
    const updateResult = await backendClient.updateMyPlugins("token-123", []);

    expect(getResult).toEqual(response);
    expect(updateResult).toEqual({ enabled_plugins: [] });

    const [getUrl, getInit] = fetchMock.mock.calls[0] ?? [];
    const [updateUrl, updateInit] = fetchMock.mock.calls[1] ?? [];

    expect(getUrl).toBe("http://localhost:8000/api/v1/me/plugins");
    expect(getInit?.method).toBe("GET");
    expect(new Headers(getInit?.headers).get("Authorization")).toBe("Bearer token-123");

    expect(updateUrl).toBe("http://localhost:8000/api/v1/me/plugins");
    expect(updateInit?.method).toBe("PUT");
    expect(updateInit?.body).toBe(JSON.stringify({ enabled_plugins: [] }));
    expect(new Headers(updateInit?.headers).get("Authorization")).toBe("Bearer token-123");
  });

  it("sends create, update, get, and delete user requests with the correct wire shape", async () => {
    const createdUser: User = {
      auto_login: true,
      created_at: "2026-08-09T10:00:00Z",
      display_name: "Jane Admin",
      enabled_plugins: ["stagings"],
      id: 3,
      is_admin: true,
      updated_at: "2026-08-09T10:00:00Z",
      username: "jane",
    };
    const createPayload: UserCreateRequest = {
      auto_login: true,
      display_name: "Jane Admin",
      is_admin: true,
      password: "p@ssword1",
      username: "jane",
    };
    const updatePayload: UserUpdateRequest = {
      auto_login: false,
      display_name: "Jane Updated",
      is_admin: false,
      password: "rotated",
    };

    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify(createdUser), {
          headers: {
            "Content-Type": "application/json",
          },
          status: 201,
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(createdUser), {
          headers: {
            "Content-Type": "application/json",
          },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ...createdUser, ...updatePayload }), {
          headers: {
            "Content-Type": "application/json",
          },
        })
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 204,
        })
      );

    const createResult = await backendClient.createUser("token-123", createPayload);
    const getResult = await backendClient.getUser("token-123", 3);
    const updateResult = await backendClient.updateUser("token-123", 3, updatePayload);
    const deleteResult = await backendClient.deleteUser("token-123", 3);

    expect(createResult).toEqual(createdUser);
    expect(getResult).toEqual(createdUser);
    expect(updateResult).toEqual({ ...createdUser, ...updatePayload });
    expect(deleteResult).toBeUndefined();

    const [createUrl, createInit] = fetchMock.mock.calls[0] ?? [];
    const [getUrl, getInit] = fetchMock.mock.calls[1] ?? [];
    const [updateUrl, updateInit] = fetchMock.mock.calls[2] ?? [];
    const [deleteUrl, deleteInit] = fetchMock.mock.calls[3] ?? [];

    expect(createUrl).toBe("http://localhost:8000/api/v1/users");
    expect(createInit?.method).toBe("POST");
    expect(createInit?.body).toBe(JSON.stringify(createPayload));
    expect(new Headers(createInit?.headers).get("Authorization")).toBe("Bearer token-123");

    expect(getUrl).toBe("http://localhost:8000/api/v1/users/3");
    expect(getInit?.method).toBe("GET");

    expect(updateUrl).toBe("http://localhost:8000/api/v1/users/3");
    expect(updateInit?.method).toBe("PATCH");
    expect(updateInit?.body).toBe(JSON.stringify(updatePayload));

    expect(deleteUrl).toBe("http://localhost:8000/api/v1/users/3");
    expect(deleteInit?.method).toBe("DELETE");
  });

  it("parses the operations list and passes pagination params", async () => {
    const response: OperationListResponse = {
      items: [
        {
          agent_host: "laptop",
          agent_version: "0.1.0",
          created_at: "2026-08-09T10:00:00Z",
          exit_code: 0,
          finished_at: "2026-08-09T10:05:00Z",
          id: "00000000-0000-0000-0000-000000000001",
          ns: "qa-demo",
          recipe: {
            flags: {
              dryRun: false,
              full: true,
              noSync: false,
              stage: 2,
            },
            images: {
              "iam-api": "sha-123",
            },
            product: null,
            services: ["iam-api"],
            suites: [],
          },
          stagings_sha: "abc123",
          started_at: "2026-08-09T10:00:00Z",
          status: "success",
          type: "deploy",
          user_id: 1,
        },
      ],
      limit: 20,
      offset: 40,
      total: 41,
    };

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(response), {
        headers: {
          "Content-Type": "application/json",
        },
      })
    );

    const result = await backendClient.listOperations("token-123", {
      limit: 20,
      offset: 40,
    });

    expect(result).toEqual(response);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    const headers = new Headers(init?.headers);

    expect(url).toBe("http://localhost:8000/api/v1/operations?limit=20&offset=40");
    expect(init?.method).toBe("GET");
    expect(headers.get("Authorization")).toBe("Bearer token-123");
  });

  it("parses operation detail and replay responses", async () => {
    const detail: OperationRead = {
      agent_host: "laptop",
      agent_version: "0.1.0",
      created_at: "2026-08-09T10:00:00Z",
      exit_code: 1,
      finished_at: "2026-08-09T10:05:00Z",
      id: "00000000-0000-0000-0000-000000000002",
      log: "line 1\nline 2",
      ns: "qa-demo",
      recipe: {
        flags: {
          dryRun: false,
          full: true,
          noSync: false,
          stage: 3,
        },
        images: {
          "billing-api": "latest",
        },
        product: null,
        services: ["billing-api"],
        suites: [],
      },
      stagings_sha: "def456",
      started_at: "2026-08-09T10:00:00Z",
      status: "failed",
      type: "deploy",
      user_id: 1,
    };
    const replay: OperationReplay = {
      id: detail.id,
      ns: detail.ns,
      recipe: detail.recipe,
      type: detail.type,
    };

    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify(detail), {
          headers: {
            "Content-Type": "application/json",
          },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(replay), {
          headers: {
            "Content-Type": "application/json",
          },
        })
      );

    const detailResult = await backendClient.getOperation("token-123", detail.id);
    const replayResult = await backendClient.getOperationReplay("token-123", detail.id);

    expect(detailResult).toEqual(detail);
    expect(replayResult).toEqual(replay);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://localhost:8000/api/v1/operations/00000000-0000-0000-0000-000000000002"
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "http://localhost:8000/api/v1/operations/00000000-0000-0000-0000-000000000002/replay"
    );
  });

  it("returns a helpful message when the backend is unreachable", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await backendClient
      .login({
        password: "admin",
        username: "admin",
      })
      .then(() => {
        throw new Error("Expected login to fail");
      })
      .catch((error: unknown) => {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain(
          "Cannot reach backend at http://localhost:8000/api/v1/auth/login."
        );
        expect((error as Error).message).toContain("VITE_API_BASE_URL");
      });
  });

  it("includes HTTP status when backend error payload is not JSON", async () => {
    fetchMock.mockResolvedValue(
      new Response("service unavailable", {
        status: 503,
        statusText: "Service Unavailable",
      })
    );

    await expect(
      backendClient.login({
        password: "admin",
        username: "admin",
      })
    ).rejects.toThrow("Backend request failed with 503 Service Unavailable.");
  });
});
