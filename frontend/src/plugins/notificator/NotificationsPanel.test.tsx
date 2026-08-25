import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const backendClientMock = vi.hoisted(() => ({
  createNotificatorNotificationConfig: vi.fn(),
  getNotificatorChoices: vi.fn(),
  listNotificatorNotificationConfigs: vi.fn(),
  listNotificatorSlackChannels: vi.fn(),
  listNotificatorTeams: vi.fn(),
  listNotificatorUsers: vi.fn(),
}));

vi.mock("@/api/backendClient", () => ({ backendClient: backendClientMock }));

import { NotificationsPanel } from "@/plugins/notificator/NotificationsPanel";
import { resetAuthStoreState, useAuthStore } from "@/store/authStore";
import { renderWithProviders } from "@/test/render";

const TOKEN = "test-token";

describe("NotificationsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAuthStoreState();
    useAuthStore.setState({ token: TOKEN });
    backendClientMock.createNotificatorNotificationConfig.mockResolvedValue({});
    backendClientMock.getNotificatorChoices.mockResolvedValue({
      notification_types: [
        {
          code: "NEW_JIRA_TICKET",
          label: "Notify about new JIRA ticket creation",
        },
        {
          code: "FAILED_PIPELINE",
          label: "Notify about failed pipelines",
        },
        {
          code: "FAILED_TEST",
          label: "Notify about failed tests",
        },
      ],
    });
    backendClientMock.listNotificatorTeams.mockResolvedValue([
      { id: 10, name: "qaa-team" },
      { id: 5, name: "platform" },
    ]);
    backendClientMock.listNotificatorSlackChannels.mockResolvedValue([
      { id: 1, channel_id: "C1", description: "alerts" },
      { id: 2, channel_id: "C2", description: "ops" },
    ]);
    backendClientMock.listNotificatorUsers.mockResolvedValue([
      {
        id: 1,
        username: "jdoe",
        display_name: "John Doe",
        sam_account_name: "jdoe",
        user_principal_name: "jdoe@gcore.com",
        slack_id: null,
        department: null,
        company: null,
        title: null,
        notifications_enabled: true,
        teams: [],
        events_subscriptions: [],
        manager: null,
      },
    ]);
    backendClientMock.listNotificatorNotificationConfigs.mockResolvedValue([
      {
        id: 1,
        product_team_id: 10,
        product_team: "qaa-team",
        notification_type: "NEW_JIRA_TICKET",
        notification_type_label: "Notify about new JIRA ticket creation",
        enabled: true,
        channels: [{ id: 1, channel_id: "C1", description: "alerts" }],
        users: [{ id: 1, sam_account_name: "jdoe", user_principal_name: "jdoe@gcore.com" }],
      },
      {
        id: 2,
        product_team_id: 10,
        product_team: "qaa-team",
        notification_type: "FAILED_PIPELINE",
        notification_type_label: "Notify about failed pipelines",
        enabled: false,
        channels: [{ id: 2, channel_id: "C2", description: "ops" }],
        users: [],
      },
      {
        id: 3,
        product_team_id: 5,
        product_team: "platform",
        notification_type: "FAILED_TEST",
        notification_type_label: "Notify about failed tests",
        enabled: true,
        channels: [],
        users: [],
      },
    ]);
  });

  it("renders grouped team rows", async () => {
    renderWithProviders(<NotificationsPanel />);

    const teamButton = await screen.findByRole("button", { name: "Open qaa-team notifications" });
    const row = teamButton.closest("tr");
    expect(row).not.toBeNull();
    expect(within(row as HTMLTableRowElement).getByText("1/2")).toBeInTheDocument();
    expect(within(row as HTMLTableRowElement).getAllByText("2")).toHaveLength(2);
    expect(backendClientMock.listNotificatorNotificationConfigs).toHaveBeenCalledWith(
      TOKEN,
      undefined,
      expect.any(AbortSignal)
    );
  });

  it("opens the modal with the selected team notifications", async () => {
    const user = userEvent.setup();
    renderWithProviders(<NotificationsPanel />);

    await user.click(await screen.findByRole("button", { name: "Open qaa-team notifications" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Notify about new JIRA ticket creation")).toBeInTheDocument();
    expect(within(dialog).getByText("Notify about failed pipelines")).toBeInTheDocument();
    expect(within(dialog).getAllByText(/Users DM:/)).toHaveLength(2);
  });
});
