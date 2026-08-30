import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const agentClientMock = vi.hoisted(() => ({
  createEnvironment: vi.fn(),
  deleteEnvironment: vi.fn(),
  listEnvironments: vi.fn(),
  setActiveEnvironment: vi.fn(),
  updateEnvironment: vi.fn(),
}));

const getPreflightMock = vi.hoisted(() => vi.fn());

Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
  configurable: true,
  value: vi.fn(),
  writable: true,
});

vi.mock("@/api/agentClient", async () => {
  const actual = await vi.importActual<typeof import("@/api/agentClient")>("@/api/agentClient");
  return {
    ...actual,
    agentClient: {
      ...actual.agentClient,
      ...agentClientMock,
    },
    getPreflight: getPreflightMock,
  };
});

import { EnvironmentsPanel } from "@/plugins/requests/EnvironmentsPanel";
import { PluginId } from "@/constants";
import { renderWithProviders } from "@/test/render";
import { resetAuthStoreState, useAuthStore } from "@/store/authStore";

const TOKEN = "token-123" as const;
const PORT = 47600 as const;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function seedAuth(permissions: string[]) {
  useAuthStore.setState({
    currentUser: {
      auto_login: false,
      created_at: "2026-08-26T00:00:00Z",
      display_name: "Test User",
      effective_permissions: permissions,
      enabled_plugins: [PluginId.REQUESTS],
      id: 7,
      is_admin: false,
      updated_at: "2026-08-26T00:00:00Z",
      username: "tester",
    },
    token: TOKEN,
  });
}

function seedPreflight() {
  getPreflightMock.mockResolvedValue({
    agent: {
      app: "qaa-tms-agent",
      os: "linux",
      stagingsInstalled: true,
      stagingsSha: "abc123",
      version: "0.1.0",
    },
    checklist: [],
    detected: true,
    port: PORT,
  });
}

describe("EnvironmentsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    resetAuthStoreState();
    seedAuth(["requests.read", "requests.write"]);
    seedPreflight();
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("creates, updates, deletes, and activates environments with refetches", async () => {
    const user = userEvent.setup();
    let state = {
      activeId: "env-staging" as string | null,
      environments: [
        {
          createdAt: "2026-08-29T08:00:00Z",
          id: "env-staging",
          name: "staging",
          updatedAt: "2026-08-29T09:00:00Z",
          variables: [{ enabled: true, key: "iamBase", value: "https://stg.test" }],
        },
      ],
    };

    agentClientMock.listEnvironments.mockImplementation(() => clone(state));
    agentClientMock.createEnvironment.mockImplementation(
      (_port: number, _token: string, payload: { name: string; variables: Array<{ enabled: boolean; key: string; value: string }> }) => {
        state = {
          ...state,
          environments: [
            ...state.environments,
            {
              createdAt: "2026-08-29T10:00:00Z",
              id: "env-preprod",
              name: payload.name,
              updatedAt: "2026-08-29T10:00:00Z",
              variables: payload.variables,
            },
          ],
        };
        return clone(state);
      }
    );
    agentClientMock.updateEnvironment.mockImplementation(
      (_port: number, _token: string, environmentId: string, payload: { name?: string; variables?: Array<{ enabled: boolean; key: string; value: string }> }) => {
        state = {
          ...state,
          environments: state.environments.map((environment) =>
            environment.id === environmentId
              ? {
                  ...environment,
                  name: payload.name ?? environment.name,
                  updatedAt: "2026-08-29T11:00:00Z",
                  variables: payload.variables ?? environment.variables,
                }
              : environment
          ),
        };
        return clone(state);
      }
    );
    agentClientMock.setActiveEnvironment.mockImplementation(
      (_port: number, _token: string, environmentId: string | null) => {
        state = { ...state, activeId: environmentId };
        return clone(state);
      }
    );
    agentClientMock.deleteEnvironment.mockImplementation(
      (_port: number, _token: string, environmentId: string) => {
        state = {
          activeId: state.activeId === environmentId ? null : state.activeId,
          environments: state.environments.filter((environment) => environment.id !== environmentId),
        };
        return clone(state);
      }
    );

    renderWithProviders(<EnvironmentsPanel />);

    expect(await screen.findByRole("button", { name: "Edit" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "New environment" }));
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "preprod" } });
    fireEvent.change(screen.getByLabelText("Variable key 1"), { target: { value: "iamBase" } });
    fireEvent.change(screen.getByLabelText("Variable value 1"), { target: { value: "https://preprod.test" } });
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(agentClientMock.createEnvironment).toHaveBeenCalledWith(
        PORT,
        TOKEN,
        {
          name: "preprod",
          variables: [{ enabled: true, key: "iamBase", value: "https://preprod.test" }],
        }
      );
    });

    await user.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "staging renamed" } });
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(agentClientMock.updateEnvironment).toHaveBeenCalledWith(
        PORT,
        TOKEN,
        "env-staging",
        expect.objectContaining({ name: "staging renamed" })
      );
    });

    await user.click(screen.getByLabelText("Active environment", { selector: "input" }));
    await user.click(screen.getByRole("option", { name: "No environment" }));

    await waitFor(() => {
      expect(agentClientMock.setActiveEnvironment).toHaveBeenCalledWith(PORT, TOKEN, null);
    });

    await user.click(screen.getAllByRole("button", { name: "Delete" })[0]);

    await waitFor(() => {
      expect(agentClientMock.deleteEnvironment).toHaveBeenCalledWith(PORT, TOKEN, "env-staging");
      expect(agentClientMock.listEnvironments.mock.calls.length).toBeGreaterThan(1);
    });
  });
});
