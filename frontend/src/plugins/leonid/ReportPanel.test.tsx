import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const agentClientMock = vi.hoisted(() => ({
  getLeonidProducts: vi.fn(),
  getLeonidReport: vi.fn(),
}));

vi.mock("@/api/agentClient", () => ({
  agentClient: agentClientMock,
}));

import { ReportPanel } from "@/plugins/leonid/ReportPanel";
import { renderWithProviders } from "@/test/render";
import { resetAuthStoreState, useAuthStore } from "@/store/authStore";

describe("ReportPanel", () => {
  beforeEach(() => {
    agentClientMock.getLeonidProducts.mockReset();
    agentClientMock.getLeonidReport.mockReset();
    localStorage.clear();
    resetAuthStoreState();
    useAuthStore.setState({ token: "token-123" });
  });

  it("renders a loading state while products are loading", async () => {
    agentClientMock.getLeonidProducts.mockReturnValue(new Promise(() => undefined));

    renderWithProviders(<ReportPanel agentPort={47600} />);

    expect(await screen.findByText("Loading Leonid report.")).toBeInTheDocument();
  });

  it("renders an error state when the products request fails", async () => {
    agentClientMock.getLeonidProducts.mockRejectedValue(new Error("Report failed"));

    renderWithProviders(<ReportPanel agentPort={47600} />);

    expect(await screen.findByText("Report failed")).toBeInTheDocument();
  });

  it("renders an empty state when there are no report products", async () => {
    agentClientMock.getLeonidProducts.mockResolvedValue({
      configured: true,
      products: [],
    });

    renderWithProviders(<ReportPanel agentPort={47600} />);

    expect(await screen.findByText("No Leonid products are available for reporting.")).toBeInTheDocument();
  });

  it("submits filters and renders the summary payload", async () => {
    const user = userEvent.setup();
    agentClientMock.getLeonidProducts.mockResolvedValue({
      configured: true,
      products: ["iam", "billing"],
    });
    agentClientMock.getLeonidReport.mockResolvedValue({
      failed_total: 5,
      success_total: 21,
      top_failed_tests: [
        { name: "checkout smoke", count: 3 },
        { name: "refund smoke", count: 1 },
      ],
      test_added: 2,
    });

    renderWithProviders(<ReportPanel agentPort={47600} />);

    await user.selectOptions(await screen.findByLabelText("Product"), "billing");
    await user.selectOptions(screen.getByLabelText("Environment"), "PROD");
    await user.clear(screen.getByLabelText("Start date"));
    await user.type(screen.getByLabelText("Start date"), "2026-08-01");
    await user.clear(screen.getByLabelText("End date"));
    await user.type(screen.getByLabelText("End date"), "2026-08-21");
    await user.selectOptions(screen.getByLabelText("Test type"), "UI");
    await user.click(screen.getByRole("button", { name: "Load report" }));

    await waitFor(() => {
      expect(agentClientMock.getLeonidReport).toHaveBeenLastCalledWith(
        47600,
        "token-123",
        "billing",
        {
          endDate: "2026-08-21",
          environment: "PROD",
          startDate: "2026-08-01",
          testType: "UI",
        },
        expect.anything()
      );
    });

    expect(await screen.findByText("checkout smoke")).toBeInTheDocument();
    expect(screen.getByText("refund smoke")).toBeInTheDocument();
    expect(screen.getByText("21")).toBeInTheDocument();
  });
});
