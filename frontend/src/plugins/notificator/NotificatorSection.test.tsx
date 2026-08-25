import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

vi.mock("@/plugins/companion/CompanionGate", () => ({
  CompanionGate: ({
    children,
  }: {
    children: ({ agentPort }: { agentPort: number }) => ReactNode;
  }) => <>{children({ agentPort: 47600 })}</>,
}));

vi.mock("@/plugins/notificator/CrudPanels", () => ({
  ProductsPanel: ({ agentPort }: { agentPort: number }) => <div>{`Products panel ${agentPort}`}</div>,
  SlackChannelsPanel: ({ agentPort }: { agentPort: number }) => (
    <div>{`Slack Channels panel ${agentPort}`}</div>
  ),
  SubProductsPanel: ({ agentPort }: { agentPort: number }) => <div>{`Sub-products panel ${agentPort}`}</div>,
}));

vi.mock("@/plugins/notificator/NotificationsPanel", () => ({
  NotificationsPanel: ({ agentPort }: { agentPort: number }) => (
    <div>{`Notifications panel ${agentPort}`}</div>
  ),
}));

vi.mock("@/plugins/notificator/ReadOnlyPanels", () => ({
  EventsPanel: ({ agentPort }: { agentPort: number }) => <div>{`Events panel ${agentPort}`}</div>,
  FailReasonsPanel: ({ agentPort }: { agentPort: number }) => (
    <div>{`Fail reasons panel ${agentPort}`}</div>
  ),
  FailureMentionRulesPanel: ({ agentPort }: { agentPort: number }) => (
    <div>{`Failure Mention Rules panel ${agentPort}`}</div>
  ),
  HistoryPanel: ({ agentPort }: { agentPort: number }) => <div>{`History panel ${agentPort}`}</div>,
  QaaMembersPanel: ({ agentPort }: { agentPort: number }) => <div>{`QAA Members panel ${agentPort}`}</div>,
  RecurrentFailsPanel: ({ agentPort }: { agentPort: number }) => (
    <div>{`Recurrent fail notifications panel ${agentPort}`}</div>
  ),
  TeamsPanel: ({ agentPort }: { agentPort: number }) => <div>{`Teams panel ${agentPort}`}</div>,
  UsersPanel: ({ agentPort }: { agentPort: number }) => <div>{`Users panel ${agentPort}`}</div>,
}));

import { ViewKey } from "@/constants";
import { NotificatorSection } from "@/plugins/notificator/NotificatorSection";
import { resetAuthStoreState, useAuthStore } from "@/store/authStore";
import { renderWithProviders } from "@/test/render";

const TOKEN = "test-token";

describe("NotificatorSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAuthStoreState();
    useAuthStore.setState({ token: TOKEN });
  });

  it("renders the Contract manager inner tabs in order and switches panels", async () => {
    const user = userEvent.setup();

    renderWithProviders(<NotificatorSection mode={ViewKey.NOTIFICATOR_CONTRACT_MANAGER} />);

    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Failure Mention Rules",
      "Notifications",
      "Products",
      "QAA Members",
      "Slack Channels",
      "Sub-products",
      "Teams",
      "Users",
    ]);
    expect(screen.getByText("Failure Mention Rules panel 47600")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Slack Channels" }));

    expect(screen.getByText("Slack Channels panel 47600")).toBeInTheDocument();
    expect(screen.queryByText("Failure Mention Rules panel 47600")).not.toBeInTheDocument();
  });

  it("renders the Notifications inner tabs in order and switches panels", async () => {
    const user = userEvent.setup();

    renderWithProviders(<NotificatorSection mode={ViewKey.NOTIFICATOR_NOTIFICATIONS} />);

    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Events",
      "Fail reasons",
      "History",
      "Recurrent fail notifications",
    ]);
    expect(screen.getByText("Events panel 47600")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Recurrent fail notifications" }));

    expect(screen.getByText("Recurrent fail notifications panel 47600")).toBeInTheDocument();
    expect(screen.queryByText("Events panel 47600")).not.toBeInTheDocument();
  });
});

