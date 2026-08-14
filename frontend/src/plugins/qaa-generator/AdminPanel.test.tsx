import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell, MantineProvider } from "@mantine/core";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

const backendClientMock = vi.hoisted(() => ({
  createQaaServiceToken: vi.fn(),
  createQaaUser: vi.fn(),
  deleteQaaUser: vi.fn(),
  listQaaUsers: vi.fn(),
  regenerateQaaUserToken: vi.fn(),
  revokeQaaServiceToken: vi.fn(),
  updateQaaUser: vi.fn(),
}));

vi.mock("@/api/backendClient", () => ({
  backendClient: backendClientMock,
}));

import type { QaaUserListResponse, User } from "@/api/types";
import { Sidebar } from "@/app/layout/Sidebar";
import { PluginId, QaaSubjectKind, TabId } from "@/constants";
import { AdminPanel } from "@/plugins/qaa-generator/AdminPanel";
import qaaGeneratorPlugin from "@/plugins/qaa-generator/manifest";
import { resetAuthStoreState, useAuthStore } from "@/store/authStore";
import { resetUiStoreState } from "@/store/uiStore";
import { renderWithProviders } from "@/test/render";

const QAA_ENABLED_PLUGINS = [PluginId.QAA_GENERATOR];
const ADMIN_TOKEN = "token-123";
const QAA_USER_ID = "user-123";
const QAA_SERVICE_SUBJECT_ID = "service-user-1";
const QAA_SERVICE_TOKEN_ID = "svc-token-123";
const QAA_USER_TOKEN = "plain-user-token";
const QAA_SERVICE_TOKEN = "plain-service-token";
const QAA_USERS_DEFAULT_LIMIT = 50;
const QAA_USERS_DEFAULT_OFFSET = 0;

const adminUser: User = {
  auto_login: false,
  created_at: "2026-08-11T00:00:00Z",
  display_name: "Administrator",
  enabled_plugins: QAA_ENABLED_PLUGINS,
  id: 1,
  is_admin: true,
  updated_at: "2026-08-11T00:00:00Z",
  username: "admin@example.com",
};

const viewerUser: User = {
  auto_login: false,
  created_at: "2026-08-11T00:00:00Z",
  display_name: "Viewer",
  enabled_plugins: QAA_ENABLED_PLUGINS,
  id: 2,
  is_admin: false,
  updated_at: "2026-08-11T00:00:00Z",
  username: "viewer@example.com",
};

const qaaUserListResponse: QaaUserListResponse = {
  items: [
    {
      created_at: "2026-08-11T10:00:00Z",
      description: "Owns generator runs",
      email: "alice@example.com",
      id: QAA_USER_ID,
      kind: QaaSubjectKind.USER,
      name: "Alice Example",
      slack_user_id: "U123",
    },
  ],
  next_cursor: null,
};

const qaaServiceListResponse: QaaUserListResponse = {
  items: [
    {
      created_at: "2026-08-11T12:00:00Z",
      id: QAA_SERVICE_SUBJECT_ID,
      kind: QaaSubjectKind.SERVICE,
      name: "qaa-bot",
      token_id: QAA_SERVICE_TOKEN_ID,
    },
  ],
  next_cursor: null,
};

function renderQaaSidebar() {
  return renderWithProviders(
    <MantineProvider forceColorScheme="dark">
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <AppShell header={{ height: 76 }} navbar={{ breakpoint: "sm", width: 280 }}>
          <Sidebar activePluginId={PluginId.QAA_GENERATOR} />
        </AppShell>
      </MemoryRouter>
    </MantineProvider>
  );
}

function setAdminState(): void {
  useAuthStore.setState({
    currentUser: adminUser,
    token: ADMIN_TOKEN,
  });
  resetUiStoreState({
    enabled_plugins: QAA_ENABLED_PLUGINS,
    is_admin: true,
  });
}

function mockQaaLists({
  serviceResponse = qaaServiceListResponse,
  userResponse = qaaUserListResponse,
}: {
  serviceResponse?: QaaUserListResponse;
  userResponse?: QaaUserListResponse;
} = {}): void {
  backendClientMock.listQaaUsers.mockImplementation(
    (_token: string, params: { kind?: string }) =>
      params.kind === QaaSubjectKind.SERVICE ? serviceResponse : userResponse
  );
}

function countListCallsForKind(kind: string): number {
  return backendClientMock.listQaaUsers.mock.calls.filter((call) => {
    const params = call[1] as { kind?: string };
    return params.kind === kind;
  }).length;
}

describe("QAA generator AdminPanel", () => {
  beforeEach(() => {
    backendClientMock.createQaaServiceToken.mockReset();
    backendClientMock.createQaaUser.mockReset();
    backendClientMock.deleteQaaUser.mockReset();
    backendClientMock.listQaaUsers.mockReset();
    backendClientMock.regenerateQaaUserToken.mockReset();
    backendClientMock.revokeQaaServiceToken.mockReset();
    backendClientMock.updateQaaUser.mockReset();
    localStorage.clear();
    resetAuthStoreState();
    resetUiStoreState({
      enabled_plugins: QAA_ENABLED_PLUGINS,
      is_admin: false,
    });
    mockQaaLists();
  });

  it("keeps the admin tab last and visible to admins in the sidebar tree", async () => {
    const user = userEvent.setup();

    expect(qaaGeneratorPlugin.tabs.at(-1)?.id).toBe(TabId.QAA_ADMIN);
    expect(qaaGeneratorPlugin.tabs.at(-1)?.adminOnly).toBe(true);

    setAdminState();
    renderQaaSidebar();

    await user.click(screen.getByRole("button", { name: "QAA generator" }));

    expect(await screen.findByText("Admin")).toBeInTheDocument();
  });

  it("requests kind=user on the Users tab and shows the copy-once user token modal", async () => {
    const user = userEvent.setup();
    backendClientMock.createQaaUser.mockResolvedValue({
      token: QAA_USER_TOKEN,
      user: qaaUserListResponse.items[0],
    });

    setAdminState();
    renderWithProviders(<AdminPanel />);

    expect(await screen.findByText("Alice Example")).toBeInTheDocument();

    await waitFor(() => {
      expect(backendClientMock.listQaaUsers).toHaveBeenCalledWith(
        ADMIN_TOKEN,
        {
          kind: QaaSubjectKind.USER,
          limit: QAA_USERS_DEFAULT_LIMIT,
          offset: QAA_USERS_DEFAULT_OFFSET,
        },
        expect.any(AbortSignal)
      );
    });

    await user.click(screen.getByRole("button", { name: "Create user" }));
    await user.type(screen.getByLabelText("Email"), "alice@example.com");
    await user.type(screen.getByLabelText("Name"), "Alice Example");
    await user.type(screen.getByLabelText("Description"), "Owns generator runs");
    await user.click(screen.getAllByRole("button", { name: "Create user" })[1]);

    await waitFor(() => {
      expect(backendClientMock.createQaaUser).toHaveBeenCalledWith(ADMIN_TOKEN, {
        description: "Owns generator runs",
        email: "alice@example.com",
        name: "Alice Example",
        slack_user_id: undefined,
      });
    });

    expect(await screen.findByText("Copy the new QAA generator user token")).toBeInTheDocument();
    expect(screen.getByDisplayValue(QAA_USER_TOKEN)).toBeInTheDocument();
  });

  it("requests kind=service on the Services tab and renders the token id column", async () => {
    const user = userEvent.setup();

    setAdminState();
    renderWithProviders(<AdminPanel />);

    await screen.findByText("Alice Example");
    await user.click(screen.getByRole("tab", { name: "Services" }));

    expect(await screen.findByText("qaa-bot")).toBeInTheDocument();
    expect(screen.getByText(QAA_SERVICE_TOKEN_ID)).toBeInTheDocument();

    await waitFor(() => {
      expect(backendClientMock.listQaaUsers).toHaveBeenCalledWith(
        ADMIN_TOKEN,
        {
          kind: QaaSubjectKind.SERVICE,
          limit: QAA_USERS_DEFAULT_LIMIT,
          offset: QAA_USERS_DEFAULT_OFFSET,
        },
        expect.any(AbortSignal)
      );
    });
  });


  it("creates a service from the Services tab and refetches the filtered list", async () => {
    const user = userEvent.setup();
    backendClientMock.createQaaServiceToken.mockResolvedValue({
      token: QAA_SERVICE_TOKEN,
      user: {
        id: QAA_SERVICE_SUBJECT_ID,
        name: "qaa-bot",
      },
    });
    mockQaaLists({
      serviceResponse: {
        items: [],
        next_cursor: null,
      },
    });

    setAdminState();
    renderWithProviders(<AdminPanel />);

    await screen.findByText("Alice Example");
    await user.click(screen.getByRole("tab", { name: "Services" }));
    await screen.findByText("No QAA generator services were returned.");

    expect(countListCallsForKind(QaaSubjectKind.SERVICE)).toBe(1);

    await user.click(screen.getByRole("button", { name: "Create service" }));
    await user.type(screen.getByLabelText("Service name"), "qaa-bot");
    await user.click(screen.getAllByRole("button", { name: "Create service" })[1]);

    await waitFor(() => {
      expect(backendClientMock.createQaaServiceToken).toHaveBeenCalledWith(ADMIN_TOKEN, {
        name: "qaa-bot",
      });
    });
    await waitFor(() => {
      expect(countListCallsForKind(QaaSubjectKind.SERVICE)).toBe(2);
    });

    expect(await screen.findByText("Copy the new QAA generator service token")).toBeInTheDocument();
    expect(screen.getByDisplayValue(QAA_SERVICE_TOKEN)).toBeInTheDocument();
  });

  it("revokes a service by token_id and refetches the filtered list", async () => {
    const user = userEvent.setup();
    backendClientMock.revokeQaaServiceToken.mockResolvedValue({ revoked: true });

    setAdminState();
    renderWithProviders(<AdminPanel />);

    await screen.findByText("Alice Example");
    await user.click(screen.getByRole("tab", { name: "Services" }));
    await screen.findByText("qaa-bot");

    expect(countListCallsForKind(QaaSubjectKind.SERVICE)).toBe(1);

    await user.click(screen.getByRole("button", { name: `Revoke ${QAA_SERVICE_SUBJECT_ID}` }));
    await user.click(screen.getByRole("button", { name: "Revoke token" }));

    await waitFor(() => {
      expect(backendClientMock.revokeQaaServiceToken).toHaveBeenCalledWith(
        ADMIN_TOKEN,
        QAA_SERVICE_TOKEN_ID
      );
    });
    expect(backendClientMock.revokeQaaServiceToken).not.toHaveBeenCalledWith(
      ADMIN_TOKEN,
      QAA_SERVICE_SUBJECT_ID
    );
    await waitFor(() => {
      expect(countListCallsForKind(QaaSubjectKind.SERVICE)).toBe(2);
    });
  });

  it("edits and deletes qaa-generator users from the shared table", async () => {
    const user = userEvent.setup();
    backendClientMock.updateQaaUser.mockResolvedValue({
      ...qaaUserListResponse.items[0],
      description: "Updated owner",
      name: "Alice Updated",
    });
    backendClientMock.deleteQaaUser.mockResolvedValue(undefined);

    setAdminState();
    renderWithProviders(<AdminPanel />);
    await screen.findByText("Alice Example");

    await user.click(screen.getByRole("button", { name: `Edit ${QAA_USER_ID}` }));
    const nameInput = await screen.findByLabelText("Name");
    await user.clear(nameInput);
    await user.type(nameInput, "Alice Updated");
    const descriptionInput = screen.getByLabelText("Description");
    await user.clear(descriptionInput);
    await user.type(descriptionInput, "Updated owner");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(backendClientMock.updateQaaUser).toHaveBeenCalledWith(ADMIN_TOKEN, QAA_USER_ID, {
        description: "Updated owner",
        email: "alice@example.com",
        name: "Alice Updated",
        slack_user_id: "U123",
      });
    });

    await user.click(screen.getByRole("button", { name: `Delete ${QAA_USER_ID}` }));
    const deleteButton = await screen.findByRole("button", { name: "Delete user" });
    expect(deleteButton).toBeDisabled();
    await user.type(screen.getByLabelText("Confirmation"), "alice@example.com");
    expect(deleteButton).toBeEnabled();
    await user.click(deleteButton);

    await waitFor(() => {
      expect(backendClientMock.deleteQaaUser).toHaveBeenCalledWith(ADMIN_TOKEN, QAA_USER_ID);
    });
  });

  it("hides the admin tab from non-admins and does not render the panel", async () => {
    const user = userEvent.setup();

    useAuthStore.setState({
      currentUser: viewerUser,
      token: ADMIN_TOKEN,
    });
    resetUiStoreState({
      enabled_plugins: QAA_ENABLED_PLUGINS,
      is_admin: false,
    });

    renderQaaSidebar();

    await user.click(screen.getByRole("button", { name: "QAA generator" }));

    expect(screen.queryByText("Admin")).not.toBeInTheDocument();

    const panelRender = renderWithProviders(<AdminPanel />);
    expect(panelRender.queryByRole("heading", { name: "QAA generator" })).not.toBeInTheDocument();
  });
});
