import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell, MantineProvider } from "@mantine/core";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

const backendClientMock = vi.hoisted(() => ({
  createQaaUser: vi.fn(),
  deleteQaaUser: vi.fn(),
  listQaaUsers: vi.fn(),
  regenerateQaaUserToken: vi.fn(),
  updateQaaUser: vi.fn(),
}));

vi.mock("@/api/backendClient", () => ({
  backendClient: backendClientMock,
}));

import { Sidebar } from "@/app/layout/Sidebar";
import { PluginId, TabId } from "@/constants";
import { AdminPanel } from "@/plugins/qaa-generator/AdminPanel";
import qaaGeneratorPlugin from "@/plugins/qaa-generator/manifest";
import { renderWithProviders } from "@/test/render";
import { resetAuthStoreState, useAuthStore } from "@/store/authStore";
import { resetUiStoreState } from "@/store/uiStore";
import type { QaaUserListResponse, User } from "@/api/types";

const QAA_ENABLED_PLUGINS = [PluginId.QAA_GENERATOR];
const ADMIN_TOKEN = "token-123";
const QAA_USER_ID = "user-123";
const QAA_USER_TOKEN = "plain-user-token";

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
      name: "Alice Example",
      slack_user_id: "U123",
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

describe("QAA Generator AdminPanel", () => {
  beforeEach(() => {
    backendClientMock.createQaaUser.mockReset();
    backendClientMock.deleteQaaUser.mockReset();
    backendClientMock.listQaaUsers.mockReset();
    backendClientMock.regenerateQaaUserToken.mockReset();
    backendClientMock.updateQaaUser.mockReset();
    localStorage.clear();
    resetAuthStoreState();
    resetUiStoreState({
      enabled_plugins: QAA_ENABLED_PLUGINS,
      is_admin: false,
    });
    backendClientMock.listQaaUsers.mockResolvedValue(qaaUserListResponse);
  });

  it("keeps the admin tab last and visible to admins in the sidebar tree", async () => {
    const user = userEvent.setup();

    expect(qaaGeneratorPlugin.tabs.at(-1)?.id).toBe(TabId.QAA_ADMIN);
    expect(qaaGeneratorPlugin.tabs.at(-1)?.adminOnly).toBe(true);

    useAuthStore.setState({
      currentUser: adminUser,
      token: ADMIN_TOKEN,
    });
    resetUiStoreState({
      enabled_plugins: QAA_ENABLED_PLUGINS,
      is_admin: true,
    });

    renderQaaSidebar();

    await user.click(screen.getByRole("button", { name: "QAA Generator" }));

    expect(await screen.findByText("Admin")).toBeInTheDocument();
  });

  it("creates a qaa user and shows the plaintext token only in the copy-once modal", async () => {
    const user = userEvent.setup();
    backendClientMock.createQaaUser.mockResolvedValue({
      token: QAA_USER_TOKEN,
      user: qaaUserListResponse.items[0],
    });

    useAuthStore.setState({
      currentUser: adminUser,
      token: ADMIN_TOKEN,
    });
    resetUiStoreState({
      enabled_plugins: QAA_ENABLED_PLUGINS,
      is_admin: true,
    });

    renderWithProviders(<AdminPanel />);

    expect(await screen.findByText("Alice Example")).toBeInTheDocument();
    expect(screen.queryByText("Service tokens")).not.toBeInTheDocument();
    expect(screen.queryByText("Lookup")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Create user" }));
    await user.type(screen.getByLabelText("Email"), "alice@example.com");
    await user.type(screen.getByLabelText("Name"), "Alice Example");
    await user.type(screen.getByLabelText("Description"), "Owns generator runs");
    await user.click(screen.getAllByRole("button", { name: "Create user" })[1]);

    await waitFor(() => {
      expect(backendClientMock.createQaaUser).toHaveBeenCalledWith(
        ADMIN_TOKEN,
        {
          description: "Owns generator runs",
          email: "alice@example.com",
          name: "Alice Example",
          slack_user_id: undefined,
        }
      );
    });

    expect(await screen.findByText("Copy the new qaa-generator user token")).toBeInTheDocument();
    expect(screen.getByDisplayValue(QAA_USER_TOKEN)).toBeInTheDocument();
  });

  it("edits and deletes qaa-generator users from the shared table", async () => {
    const user = userEvent.setup();
    backendClientMock.updateQaaUser.mockResolvedValue({
      ...qaaUserListResponse.items[0],
      description: "Updated owner",
      name: "Alice Updated",
    });
    backendClientMock.deleteQaaUser.mockResolvedValue(undefined);

    useAuthStore.setState({
      currentUser: adminUser,
      token: ADMIN_TOKEN,
    });
    resetUiStoreState({
      enabled_plugins: QAA_ENABLED_PLUGINS,
      is_admin: true,
    });

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
      expect(backendClientMock.updateQaaUser).toHaveBeenCalledWith(
        ADMIN_TOKEN,
        QAA_USER_ID,
        {
          description: "Updated owner",
          email: "alice@example.com",
          name: "Alice Updated",
          slack_user_id: "U123",
        }
      );
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

    await user.click(screen.getByRole("button", { name: "QAA Generator" }));

    expect(screen.queryByText("Admin")).not.toBeInTheDocument();

    const panelRender = renderWithProviders(<AdminPanel />);
    expect(panelRender.queryByText("QAA Generator Admin")).not.toBeInTheDocument();
  });
});
