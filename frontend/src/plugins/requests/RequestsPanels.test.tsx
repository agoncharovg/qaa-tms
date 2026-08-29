import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const agentClientMock = vi.hoisted(() => ({
  clearHistory: vi.fn(),
  createCredential: vi.fn(),
  createFolder: vi.fn(),
  createRequestItem: vi.fn(),
  deleteCredential: vi.fn(),
  deleteFolder: vi.fn(),
  deleteHistoryEntry: vi.fn(),
  deleteRequestItem: vi.fn(),
  executeRequest: vi.fn(),
  listCollections: vi.fn(),
  listCredentials: vi.fn(),
  listHistory: vi.fn(),
  listRequestItems: vi.fn(),
  readRequestItem: vi.fn(),
  reorderCollections: vi.fn(),
  resolveCredential: vi.fn(),
  updateCredential: vi.fn(),
  updateRequestItem: vi.fn(),
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

import { PluginId } from "@/constants";
import { CredentialsPanel } from "@/plugins/requests/CredentialsPanel";
import { RequestsBuilderPanel } from "@/plugins/requests/RequestsBuilderPanel";
import { RequestsHistoryPanel } from "@/plugins/requests/RequestsHistoryPanel";
import { clearRequestsDrafts } from "@/plugins/requests/requestsDrafts";
import { renderWithProviders } from "@/test/render";
import { resetAuthStoreState, useAuthStore } from "@/store/authStore";

const TOKEN = "token-123" as const;
const PORT = 47600 as const;
const FOLDER = "Alpha" as const;
const REQUEST_NAME = "Saved request" as const;

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

function seedPreflight(detected = true) {
  getPreflightMock.mockResolvedValue(
    detected
      ? {
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
        }
      : {
          detected: false,
          ports: [PORT],
        }
  );
}

function seedBuilderData() {
  agentClientMock.listCollections.mockResolvedValue({
    folders: [{ children: [], flags: {}, itemCount: 1, name: FOLDER }],
  });
  agentClientMock.listRequestItems.mockResolvedValue({
    folder: FOLDER,
    items: [
      {
        createdAt: "2026-08-29T08:00:00Z",
        credentialId: "cred-1",
        method: "GET",
        name: REQUEST_NAME,
        updatedAt: "2026-08-29T09:00:00Z",
        url: "https://svc.test/items",
      },
    ],
  });
  agentClientMock.readRequestItem.mockResolvedValue({
    body: { content: "", mode: "none" },
    createdAt: "2026-08-29T08:00:00Z",
    credentialId: "cred-1",
    folder: FOLDER,
    headers: [{ enabled: true, name: "Authorization", value: "Bearer draft" }],
    method: "GET",
    name: REQUEST_NAME,
    queryParams: [{ enabled: true, name: "page", value: "1" }],
    updatedAt: "2026-08-29T09:00:00Z",
    url: "https://svc.test/items",
  });
  agentClientMock.listCredentials.mockResolvedValue({
    credentials: [
      {
        config: { hasToken: true },
        createdAt: "2026-08-29T08:00:00Z",
        id: "cred-1",
        name: "Main bearer",
        type: "bearer",
        updatedAt: "2026-08-29T09:00:00Z",
      },
    ],
  });
}

describe("Requests plugin panels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearRequestsDrafts();
    localStorage.clear();
    resetAuthStoreState();
    seedAuth(["requests.read", "requests.write"]);
    seedPreflight(true);
    seedBuilderData();
    agentClientMock.createFolder.mockResolvedValue({ folders: [] });
    agentClientMock.deleteFolder.mockResolvedValue({ folders: [] });
    agentClientMock.reorderCollections.mockResolvedValue({ folders: [] });
    agentClientMock.createRequestItem.mockResolvedValue({
      body: { content: "", mode: "none" },
      createdAt: "2026-08-29T10:00:00Z",
      credentialId: null,
      folder: FOLDER,
      headers: [],
      method: "POST",
      name: "Created request",
      queryParams: [],
      updatedAt: "2026-08-29T10:00:00Z",
      url: "https://svc.test/new",
    });
    agentClientMock.updateRequestItem.mockResolvedValue({
      body: { content: "", mode: "none" },
      createdAt: "2026-08-29T08:00:00Z",
      credentialId: "cred-1",
      folder: FOLDER,
      headers: [{ enabled: true, name: "Authorization", value: "Bearer draft" }],
      method: "GET",
      name: REQUEST_NAME,
      queryParams: [{ enabled: true, name: "page", value: "1" }],
      updatedAt: "2026-08-29T10:00:00Z",
      url: "https://svc.test/items/updated",
    });
    agentClientMock.deleteRequestItem.mockResolvedValue({ folder: FOLDER, items: [] });
    agentClientMock.executeRequest
      .mockResolvedValueOnce({
        bodyText: "{\"ok\":true}",
        elapsedMs: 42,
        error: null,
        headers: [{ name: "content-type", value: "application/json" }],
        reasonPhrase: "OK",
        requestSummary: {
          headers: [{ name: "Authorization", value: "***" }],
          method: "GET",
          queryParams: [{ name: "page", value: "1" }],
          url: "https://svc.test/items",
        },
        sizeBytes: 512,
        statusCode: 200,
        truncated: false,
      })
      .mockResolvedValueOnce({
        bodyText: "",
        elapsedMs: null,
        error: "timeout",
        headers: [],
        reasonPhrase: null,
        requestSummary: {
          headers: [{ name: "Authorization", value: "***" }],
          method: "GET",
          queryParams: [{ name: "page", value: "1" }],
          url: "https://svc.test/items",
        },
        sizeBytes: 0,
        statusCode: null,
        truncated: false,
      });
    agentClientMock.listHistory.mockResolvedValue({
      entries: [
        {
          at: "2026-08-29T10:15:00Z",
          id: "hist-1",
          requestSummary: {
            headers: [{ name: "Authorization", value: "***" }],
            method: "GET",
            queryParams: [],
            url: "https://svc.test/items",
          },
          responseSummary: { elapsedMs: 20, error: null, sizeBytes: 64, statusCode: 200 },
        },
      ],
    });
    agentClientMock.clearHistory.mockResolvedValue({ entries: [] });
    agentClientMock.deleteHistoryEntry.mockResolvedValue({ entries: [] });
    agentClientMock.createCredential.mockResolvedValue({
      config: { hasToken: true },
      createdAt: "2026-08-29T08:00:00Z",
      id: "created",
      name: "Created",
      type: "bearer",
      updatedAt: "2026-08-29T08:00:00Z",
    });
    agentClientMock.updateCredential.mockResolvedValue({
      config: { hasPassword: true, loginUrl: "https://iam.test/login", referer: "https://iam.test", username: "user" },
      createdAt: "2026-08-29T08:00:00Z",
      id: "cred-login",
      name: "Login updated",
      type: "login_password",
      updatedAt: "2026-08-29T09:00:00Z",
    });
    agentClientMock.resolveCredential
      .mockResolvedValueOnce({ error: null, expiresAt: "2026-08-30T00:00:00Z", ok: true })
      .mockResolvedValueOnce({ error: "Denied", expiresAt: null, ok: false });
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("renders the tree, loads a request into the editor, and calls create save delete methods", async () => {
    const user = userEvent.setup();
    renderWithProviders(<RequestsBuilderPanel />);

    const savedRequestRow = await screen.findByText(REQUEST_NAME);
    expect(savedRequestRow).toBeInTheDocument();
    await user.click(savedRequestRow);
    const requestUrlInput = await screen.findByLabelText("Request URL");
    await waitFor(() => expect(requestUrlInput).toHaveValue("https://svc.test/items"));

    fireEvent.change(requestUrlInput, { target: { value: "https://svc.test/items/updated" } });
    await user.click(screen.getByRole("button", { name: "Save request" }));

    await waitFor(() => {
      expect(agentClientMock.updateRequestItem).toHaveBeenCalledWith(
        PORT,
        TOKEN,
        FOLDER,
        REQUEST_NAME,
        expect.objectContaining({
          folder: FOLDER,
          url: "https://svc.test/items/updated",
        })
      );
    });

    await user.click(screen.getByRole("button", { name: "New request" }));
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Created request" } });
    fireEvent.change(screen.getByLabelText("Request URL"), { target: { value: "https://svc.test/new" } });
    await user.click(screen.getByRole("button", { name: "Save request" }));

    await waitFor(() => {
      expect(agentClientMock.createRequestItem).toHaveBeenCalledWith(
        PORT,
        TOKEN,
        expect.objectContaining({
          name: "Created request",
          url: "https://svc.test/new",
        })
      );
    });

    await user.click(screen.getByText(REQUEST_NAME));
    await user.click(screen.getByRole("button", { name: "Delete request" }));

    await waitFor(() => {
      expect(agentClientMock.deleteRequestItem).toHaveBeenCalledWith(PORT, TOKEN, FOLDER, REQUEST_NAME);
      expect(agentClientMock.listRequestItems.mock.calls.length).toBeGreaterThan(1);
    });
  }, 10_000);

  it("executes the current editor state and renders both success and error responses", async () => {
    const user = userEvent.setup();
    renderWithProviders(<RequestsBuilderPanel />);

    await user.click(await screen.findByText(REQUEST_NAME));
    const sendUrlInput = await screen.findByLabelText("Request URL");
    await waitFor(() => expect(sendUrlInput).toHaveValue("https://svc.test/items"));
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(agentClientMock.executeRequest).toHaveBeenCalledWith(
        PORT,
        TOKEN,
        expect.objectContaining({
          method: "GET",
          url: "https://svc.test/items",
        })
      );
    });

    expect(await screen.findByText("42 ms")).toBeInTheDocument();
    expect(await screen.findByText("512 B")).toBeInTheDocument();
    expect(await screen.findByText("***")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("timeout")).toBeInTheDocument();
  });

  it("creates all credential types, omits blank edit secrets, and surfaces test results", async () => {
    const user = userEvent.setup();
    agentClientMock.listCredentials.mockResolvedValue({
      credentials: [
        {
          config: { hasToken: true },
          createdAt: "2026-08-29T08:00:00Z",
          id: "cred-bearer",
          name: "Main bearer",
          type: "bearer",
          updatedAt: "2026-08-29T09:00:00Z",
        },
        {
          config: { hasPassword: true, loginUrl: "https://iam.test/login", referer: "https://iam.test", username: "user" },
          createdAt: "2026-08-29T08:00:00Z",
          id: "cred-login",
          name: "Login flow",
          type: "login_password",
          updatedAt: "2026-08-29T09:00:00Z",
        },
      ],
    });

    renderWithProviders(<CredentialsPanel />);
    await screen.findByText("Main bearer");

    await user.click(screen.getByRole("button", { name: "New credential" }));
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Bearer create" } });
    fireEvent.change(screen.getByLabelText("Token"), { target: { value: "secret-token" } });
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(agentClientMock.createCredential).toHaveBeenCalledWith(
        PORT,
        TOKEN,
        expect.objectContaining({ config: { token: "secret-token" }, type: "bearer" })
      );
    });

    await user.click(screen.getByRole("button", { name: "New credential" }));
    await user.click(screen.getAllByLabelText("Type")[0]);
    await user.click(screen.getByRole("option", { name: "API key permanent" }));
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "API key create" } });
    fireEvent.change(screen.getByLabelText("Permanent token"), { target: { value: "perm-secret" } });
    fireEvent.change(screen.getByLabelText("Verify URL"), { target: { value: "https://iam.test/verify" } });
    fireEvent.change(screen.getByLabelText("Scheme"), { target: { value: "APIKey" } });
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(agentClientMock.createCredential).toHaveBeenCalledWith(
        PORT,
        TOKEN,
        expect.objectContaining({
          config: { permanentToken: "perm-secret", scheme: "APIKey", verifyUrl: "https://iam.test/verify" },
          type: "api_key_permanent",
        })
      );
    });

    await user.click(screen.getByRole("button", { name: "New credential" }));
    await user.click(screen.getAllByLabelText("Type")[0]);
    await user.click(screen.getByRole("option", { name: "Login password" }));
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Login create" } });
    fireEvent.change(screen.getByLabelText("Login URL"), { target: { value: "https://iam.test/login" } });
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "engineer" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw-123" } });
    fireEvent.change(screen.getByLabelText("Referer"), { target: { value: "https://iam.test" } });
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(agentClientMock.createCredential).toHaveBeenCalledWith(
        PORT,
        TOKEN,
        expect.objectContaining({
          config: {
            loginUrl: "https://iam.test/login",
            password: "pw-123",
            referer: "https://iam.test",
            username: "engineer",
          },
          type: "login_password",
        })
      );
    });

    await user.click(screen.getByRole("button", { name: "New credential" }));
    await user.click(screen.getAllByLabelText("Type")[0]);
    await user.click(screen.getByRole("option", { name: "Client admin" }));
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Client admin create" } });
    await user.click(screen.getAllByLabelText("Admin credential")[0]);
    await user.click(screen.getByRole("option", { name: "Main bearer" }));
    fireEvent.change(screen.getByLabelText("Admin token URL"), { target: { value: "https://iam.test/token/{client_id}" } });
    fireEvent.change(screen.getByLabelText("Client ID"), { target: { value: "42" } });
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(agentClientMock.createCredential).toHaveBeenCalledWith(
        PORT,
        TOKEN,
        expect.objectContaining({
          config: {
            adminCredentialId: "cred-bearer",
            adminTokenUrl: "https://iam.test/token/{client_id}",
            clientId: 42,
            issueByCurrentUser: true,
          },
          type: "client_admin",
        })
      );
    });

    await user.click(screen.getAllByRole("button", { name: "Edit" })[1]);
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Login updated" } });
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(agentClientMock.updateCredential).toHaveBeenCalled();
      const updateCall = agentClientMock.updateCredential.mock.calls.at(-1);
      const updatePayload = updateCall?.[3] as { config?: Record<string, unknown>; type?: string } | undefined;
      expect(updateCall?.[0]).toBe(PORT);
      expect(updateCall?.[1]).toBe(TOKEN);
      expect(updateCall?.[2]).toBe("cred-login");
      expect(updatePayload?.type).toBe("login_password");
      expect(updatePayload?.config).not.toHaveProperty("password");
    });

    await user.click(screen.getAllByRole("button", { name: "Test" })[0]);
    expect(await screen.findByText(/expires 2026-08-30T00:00:00Z/)).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "Test" })[1]);
    expect(await screen.findByText(/Denied/)).toBeInTheDocument();
  }, 10_000);

  it("lists history entries and supports delete one and clear all", async () => {
    const user = userEvent.setup();
    renderWithProviders(<RequestsHistoryPanel />);

    expect(await screen.findByText("https://svc.test/items")).toBeInTheDocument();
    await user.click(screen.getByLabelText("Expand https://svc.test/items"));
    expect(await screen.findByText("Authorization: ***")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(agentClientMock.deleteHistoryEntry).toHaveBeenCalledWith(PORT, TOKEN, "hist-1");
    });

    await user.click(screen.getByRole("button", { name: "Clear all" }));
    await waitFor(() => {
      expect(agentClientMock.clearHistory).toHaveBeenCalledWith(PORT, TOKEN);
    });
  });

  it("renders companion unavailable and read-only states while hiding write controls", async () => {
    seedPreflight(false);
    const unavailable = renderWithProviders(<RequestsBuilderPanel />);
    expect(await screen.findByText(/Companion app is not running/i)).toBeInTheDocument();
    unavailable.unmount();

    seedPreflight(true);
    seedAuth(["requests.read"]);

    const builder = renderWithProviders(<RequestsBuilderPanel />);
    await screen.findByText(REQUEST_NAME);
    expect(screen.queryByRole("button", { name: "Create folder" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send" })).not.toBeInTheDocument();
    builder.unmount();

    const credentials = renderWithProviders(<CredentialsPanel />);
    await screen.findByText("Main bearer");
    expect(screen.queryByRole("button", { name: "New credential" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Test" })).not.toBeInTheDocument();
    credentials.unmount();

    const history = renderWithProviders(<RequestsHistoryPanel />);
    await screen.findByText("https://svc.test/items");
    expect(screen.queryByRole("button", { name: "Clear all" })).not.toBeInTheDocument();
    history.unmount();
  });
});

