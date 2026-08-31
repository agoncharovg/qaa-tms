import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const agentClientMock = vi.hoisted(() => ({
  createEnvironment: vi.fn(),
  createVariable: vi.fn(),
  deleteEnvironment: vi.fn(),
  deleteVariable: vi.fn(),
  getRequestsState: vi.fn(),
  updateEnvironment: vi.fn(),
  updateVariable: vi.fn(),
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

import type { RequestsEnvironmentsState, RequestsVariableRow } from "@/api/types";
import { PluginId } from "@/constants";
import { EnvironmentsPanel } from "@/plugins/requests/EnvironmentsPanel";
import { isVariableRowDirty } from "@/plugins/requests/EnvironmentsPanelState";
import { renderWithProviders } from "@/test/render";
import { resetAuthStoreState, useAuthStore } from "@/store/authStore";

const TOKEN = "token-123" as const;
const PORT = 47600 as const;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function buildVariableRow(
  overrides: Partial<RequestsVariableRow> = {}
): RequestsVariableRow {
  return {
    createdAt: "2026-08-29T08:00:00Z",
    enabled: true,
    id: "var-base",
    key: "base",
    secret: false,
    updatedAt: "2026-08-29T09:00:00Z",
    values: { "env-staging": "https://stg.test", "env-prod": "https://prod.test" },
    ...overrides,
  };
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

  it("detects row dirtiness per saved row and new draft rules", () => {
    const savedRow = buildVariableRow();

    expect(
      isVariableRowDirty(
        {
          ...savedRow,
          key: "  base  ",
          values: {
            "env-prod": "https://prod.test",
            "env-staging": "https://stg.test",
            "env-empty": "",
          },
        },
        savedRow
      )
    ).toBe(false);
    expect(
      isVariableRowDirty(
        {
          ...savedRow,
          enabled: false,
        },
        savedRow
      )
    ).toBe(true);
    expect(isVariableRowDirty({ ...savedRow, isNew: true, key: "   " }, undefined)).toBe(false);
    expect(isVariableRowDirty({ ...savedRow, isNew: true, key: " host " }, undefined)).toBe(true);
    expect(isVariableRowDirty({ ...savedRow }, undefined)).toBe(true);
  });

  it("manages environments and variable rows through the matrix state", async () => {
    const user = userEvent.setup();
    const promptMock = vi.spyOn(window, "prompt");
    let state: RequestsEnvironmentsState = {
      activeId: null as string | null,
      environments: [
        {
          createdAt: "2026-08-29T08:00:00Z",
          id: "env-staging",
          name: "staging",
          updatedAt: "2026-08-29T09:00:00Z",
        },
      ],
      variables: [
        {
          createdAt: "2026-08-29T08:00:00Z",
          enabled: true,
          id: "var-iam-base",
          key: "iamBase",
          secret: false,
          updatedAt: "2026-08-29T09:00:00Z",
          values: { "env-staging": "https://stg.test" },
        },
        {
          createdAt: "2026-08-29T08:00:00Z",
          enabled: true,
          id: "var-secret",
          key: "token",
          secret: true,
          updatedAt: "2026-08-29T09:00:00Z",
          values: { "env-staging": "plain-secret" },
        },
      ],
    };

    agentClientMock.getRequestsState.mockImplementation(() => clone(state));
    agentClientMock.createEnvironment.mockImplementation((_port: number, _token: string, payload: { name: string }) => {
      state = {
        ...state,
        environments: [
          ...state.environments,
          {
            createdAt: "2026-08-29T10:00:00Z",
            id: "env-preprod",
            name: payload.name,
            updatedAt: "2026-08-29T10:00:00Z",
          },
        ],
      };
      return clone(state);
    });
    agentClientMock.updateEnvironment.mockImplementation(
      (_port: number, _token: string, environmentId: string, payload: { name?: string }) => {
        state = {
          ...state,
          environments: state.environments.map((environment) =>
            environment.id === environmentId
              ? {
                  ...environment,
                  name: payload.name ?? environment.name,
                  updatedAt: "2026-08-29T11:00:00Z",
                }
              : environment
          ),
        };
        return clone(state);
      }
    );
    agentClientMock.createVariable.mockImplementation(
      (_port: number, _token: string, payload: { enabled: boolean; key: string; secret: boolean; values: Record<string, string> }) => {
        state = {
          ...state,
          variables: [
            ...state.variables,
            {
              createdAt: "2026-08-29T12:00:00Z",
              enabled: payload.enabled,
              id: `var-${payload.key}`,
              key: payload.key,
              secret: payload.secret,
              updatedAt: "2026-08-29T12:00:00Z",
              values: payload.values,
            },
          ],
        };
        return clone(state);
      }
    );
    agentClientMock.deleteVariable.mockImplementation((_port: number, _token: string, variableId: string) => {
      state = {
        ...state,
        variables: state.variables.filter((variable) => variable.id !== variableId),
      };
      return clone(state);
    });
    agentClientMock.deleteEnvironment.mockImplementation((_port: number, _token: string, environmentId: string) => {
      state = {
        ...state,
        environments: state.environments.filter((environment) => environment.id !== environmentId),
        variables: state.variables.map((variable) => ({
          ...variable,
          values: Object.fromEntries(
            Object.entries(variable.values).filter(([key]) => key !== environmentId)
          ),
        })),
      };
      return clone(state);
    });

    promptMock
      .mockReturnValueOnce("preprod")
      .mockReturnValueOnce("staging renamed");

    renderWithProviders(<EnvironmentsPanel />);

    expect(await screen.findByText("Requests / Environments")).toBeInTheDocument();
    expect(screen.queryByLabelText("Active environment", { selector: "input" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add environment" }));

    await waitFor(() => {
      expect(agentClientMock.createEnvironment).toHaveBeenCalledWith(PORT, TOKEN, { name: "preprod" });
    });

    await user.click(screen.getByRole("button", { name: "Add variable" }));
    fireEvent.change(screen.getAllByLabelText("Variable key 2")[0], { target: { value: "verifyBase" } });
    fireEvent.change(screen.getAllByLabelText("staging value 2")[0], { target: { value: "https://verify.stg" } });
    fireEvent.change(screen.getAllByLabelText("preprod value 2")[0], { target: { value: "https://verify.preprod" } });
    await user.click(screen.getAllByRole("button", { name: "Save" })[1]);

    await waitFor(() => {
      expect(agentClientMock.createVariable).toHaveBeenCalledWith(PORT, TOKEN, {
        enabled: true,
        key: "verifyBase",
        secret: false,
        values: {
          "env-preprod": "https://verify.preprod",
          "env-staging": "https://verify.stg",
        },
      });
    });

    await user.click(screen.getByRole("tab", { name: "Secrets" }));
    expect((await screen.findAllByDisplayValue("plain-secret"))[0]).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "Rename" })[0]);

    await waitFor(() => {
      expect(agentClientMock.updateEnvironment).toHaveBeenCalledWith(PORT, TOKEN, "env-staging", {
        name: "staging renamed",
      });
    });

    await user.click(screen.getByRole("tab", { name: "Variables" }));
    await user.click(screen.getAllByLabelText("Delete variable 1")[0]);

    await waitFor(() => {
      expect(agentClientMock.deleteVariable).toHaveBeenCalledWith(PORT, TOKEN, "var-iam-base");
    });

    await user.click(screen.getAllByRole("button", { name: "Delete" })[0]);

    await waitFor(() => {
      expect(agentClientMock.deleteEnvironment).toHaveBeenCalledWith(PORT, TOKEN, "env-staging");
      expect(agentClientMock.getRequestsState.mock.calls.length).toBeGreaterThan(0);
    });
  });
  it("preserves unsaved draft rows after saving another variable", async () => {
    const user = userEvent.setup();
    let state: RequestsEnvironmentsState = {
      activeId: null as string | null,
      environments: [
        {
          createdAt: "2026-08-29T08:00:00Z",
          id: "env-staging",
          name: "staging",
          updatedAt: "2026-08-29T09:00:00Z",
        },
      ],
      variables: [],
    };

    agentClientMock.getRequestsState.mockImplementation(() => clone(state));
    agentClientMock.createVariable.mockImplementation(
      (_port: number, _token: string, payload: { enabled: boolean; key: string; secret: boolean; values: Record<string, string> }) => {
        state = {
          ...state,
          variables: [
            ...state.variables,
            {
              createdAt: "2026-08-29T12:00:00Z",
              enabled: payload.enabled,
              id: `var-${payload.key}`,
              key: payload.key,
              secret: payload.secret,
              updatedAt: "2026-08-29T12:00:00Z",
              values: payload.values,
            },
          ],
        };
        return clone(state);
      }
    );

    renderWithProviders(<EnvironmentsPanel />);

    expect(await screen.findByText("Requests / Environments")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add variable" }));
    await user.click(screen.getByRole("button", { name: "Add variable" }));

    fireEvent.change(screen.getAllByLabelText("Variable key 1")[0], { target: { value: "iamBase" } });
    fireEvent.change(screen.getAllByLabelText("staging value 1")[0], { target: { value: "https://stg.test" } });
    fireEvent.change(screen.getAllByLabelText("Variable key 2")[0], { target: { value: "verifyBase" } });
    fireEvent.change(screen.getAllByLabelText("staging value 2")[0], { target: { value: "https://verify.test" } });

    await user.click(screen.getAllByRole("button", { name: "Save" })[0]);

    await waitFor(() => {
      expect(agentClientMock.createVariable).toHaveBeenCalledWith(PORT, TOKEN, {
        enabled: true,
        key: "iamBase",
        secret: false,
        values: {
          "env-staging": "https://stg.test",
        },
      });
    });

    await waitFor(() => {
      expect(screen.getAllByLabelText("Variable key 2")[0]).toHaveValue("verifyBase");
    });
    expect(screen.getAllByLabelText("staging value 2")[0]).toHaveValue("https://verify.test");
  });

  it("enables Save only for the edited row and shows rename notices when references were rewritten", async () => {
    const user = userEvent.setup();
    let state: RequestsEnvironmentsState = {
      activeId: null,
      environments: [
        {
          createdAt: "2026-08-29T08:00:00Z",
          id: "env-staging",
          name: "staging",
          updatedAt: "2026-08-29T09:00:00Z",
        },
      ],
      variables: [buildVariableRow({ values: { "env-staging": "https://stg.test" } })],
    };

    agentClientMock.getRequestsState.mockImplementation(() => clone(state));
    agentClientMock.updateVariable.mockImplementation(
      (
        _port: number,
        _token: string,
        variableId: string,
        payload: { enabled: boolean; key: string; secret: boolean; values: Record<string, string> }
      ) => {
        state = {
          ...state,
          renamedReferences: 2,
          variables: state.variables.map((variable) =>
            variable.id === variableId
              ? {
                  ...variable,
                  enabled: payload.enabled,
                  key: payload.key,
                  secret: payload.secret,
                  updatedAt: "2026-08-29T10:00:00Z",
                  values: payload.values,
                }
              : variable
          ),
        };
        return clone(state);
      }
    );

    renderWithProviders(<EnvironmentsPanel />);

    expect(await screen.findByText("Requests / Environments")).toBeInTheDocument();
    const saveButton = screen.getByRole("button", { name: "Save" });
    expect(saveButton).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Add variable" }));
    const saveButtons = screen.getAllByRole("button", { name: "Save" });
    expect(saveButtons[0]).toBeDisabled();
    expect(saveButtons[1]).toBeDisabled();

    fireEvent.change(screen.getAllByLabelText("Variable key 2")[0], {
      target: { value: "draftOnly" },
    });
    const afterDraftEdit = screen.getAllByRole("button", { name: "Save" });
    expect(afterDraftEdit[0]).toBeDisabled();
    expect(afterDraftEdit[1]).toBeEnabled();

    fireEvent.change(screen.getAllByLabelText("Variable key 1")[0], {
      target: { value: " host " },
    });
    const afterRenameEdit = screen.getAllByRole("button", { name: "Save" });
    expect(afterRenameEdit[0]).toBeEnabled();
    expect(afterRenameEdit[1]).toBeEnabled();

    await user.click(afterRenameEdit[0]);

    await waitFor(() => {
      expect(agentClientMock.updateVariable).toHaveBeenCalledWith(PORT, TOKEN, "var-base", {
        enabled: true,
        key: "host",
        secret: false,
        values: { "env-staging": "https://stg.test" },
      });
    });

    expect(await screen.findByText("Renamed {{base}} → {{host}} in 2 places.")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "Save" })[0]).toBeDisabled();
    });
  });

});
