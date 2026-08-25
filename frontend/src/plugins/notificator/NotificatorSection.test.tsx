import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/plugins/notificator/CrudPanels", () => ({
  ProductsPanel: () => <div>Products panel</div>,
  SlackChannelsPanel: () => <div>Slack Channels panel</div>,
  SubProductsPanel: () => <div>Sub-products panel</div>,
}));

vi.mock("@/plugins/notificator/NotificationsPanel", () => ({
  NotificationsPanel: () => <div>Notifications panel</div>,
}));

vi.mock("@/plugins/notificator/ReadOnlyPanels", () => ({
  EventsPanel: () => <div>Events panel</div>,
  FailReasonsPanel: () => <div>Fail reasons panel</div>,
  FailureMentionRulesPanel: () => <div>Failure Mention Rules panel</div>,
  HistoryPanel: () => <div>History panel</div>,
  QaaMembersPanel: () => <div>QAA Members panel</div>,
  RecurrentFailsPanel: () => <div>Recurrent fail notifications panel</div>,
  TeamsPanel: () => <div>Teams panel</div>,
  UsersPanel: () => <div>Users panel</div>,
}));

import { ViewKey } from "@/constants";
import { NotificatorSection } from "@/plugins/notificator/NotificatorSection";
import { renderWithProviders } from "@/test/render";

describe("NotificatorSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    expect(screen.getByText("Failure Mention Rules panel")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Slack Channels" }));

    expect(screen.getByText("Slack Channels panel")).toBeInTheDocument();
    expect(screen.queryByText("Failure Mention Rules panel")).not.toBeInTheDocument();
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
    expect(screen.getByText("Events panel")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Recurrent fail notifications" }));

    expect(screen.getByText("Recurrent fail notifications panel")).toBeInTheDocument();
    expect(screen.queryByText("Events panel")).not.toBeInTheDocument();
  });
});
