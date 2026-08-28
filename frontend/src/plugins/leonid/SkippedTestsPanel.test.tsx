import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const backendClientMock = vi.hoisted(() => ({
  cancelLeonidSkippedSuite: vi.fn(),
  createLeonidSkippedSuite: vi.fn(),
  listLeonidSkippedSuites: vi.fn(),
}));

const agentClientMock = vi.hoisted(() => ({
  getAllureSkipCandidates: vi.fn(),
}));

const discoverAgentMock = vi.hoisted(() => vi.fn());

vi.mock("@/api/backendClient", () => ({ backendClient: backendClientMock }));
vi.mock("@/api/agentClient", () => ({
  agentClient: agentClientMock,
  discoverAgent: discoverAgentMock,
}));

import { SkippedTestsPanel } from "@/plugins/leonid/SkippedTestsPanel";
import { resetAuthStoreState, useAuthStore } from "@/store/authStore";
import { renderWithProviders } from "@/test/render";

const TOKEN = "test-token";
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const AGENT_PORT = 47600;
const REPORT_URL = "https://jenkins.p.gc.onl/job/.QAA/job/E2E/job/PREPROD/job/Smoke/42/allure/";

function toLocalDateTimeInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

describe("SkippedTestsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    resetAuthStoreState();
    useAuthStore.setState({ token: TOKEN });
    const now = new Date();
    backendClientMock.listLeonidSkippedSuites.mockResolvedValue([
      {
        id: 3,
        author: "owner@example.com",
        reason:
          "A very long reason that should still render in the table and remain discoverable for hover details.",
        product: "Billing",
        created_at: new Date(now.getTime() - 30 * 60 * 1000).toISOString(),
        expires_at: new Date(now.getTime() + DAY_IN_MS).toISOString(),
        cancelled_at: null,
        cancelled_by: null,
        status: "active",
        tests: [
          { full_name: "tests.billing.test_payments#test_retry" },
          { full_name: "tests.billing.test_payments#test_refund" },
        ],
      },
      {
        id: 2,
        author: "old@example.com",
        reason: "Already expired",
        product: "IAM",
        created_at: new Date(now.getTime() - DAY_IN_MS).toISOString(),
        expires_at: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(),
        cancelled_at: null,
        cancelled_by: null,
        status: "expired",
        tests: [{ full_name: "tests.iam.test_auth#test_expired" }],
      },
      {
        id: 1,
        author: "another@example.com",
        reason: "Superseded by fix",
        product: "DNS",
        created_at: new Date(now.getTime() - 2 * DAY_IN_MS).toISOString(),
        expires_at: new Date(now.getTime() + 4 * DAY_IN_MS).toISOString(),
        cancelled_at: new Date(now.getTime() - 60 * 60 * 1000).toISOString(),
        cancelled_by: "closer@example.com",
        status: "cancelled",
        tests: [{ full_name: "tests.dns.test_zone#test_cancelled" }],
      },
    ]);
    backendClientMock.createLeonidSkippedSuite.mockResolvedValue({});
    backendClientMock.cancelLeonidSkippedSuite.mockResolvedValue({});
    discoverAgentMock.mockResolvedValue({
      agent: {
        app: "qaa-tms-agent",
        os: "linux",
        selfUpdateSupported: true,
        stagingsInstalled: false,
        stagingsSha: null,
        version: "0.2.0",
      },
      port: AGENT_PORT,
    });
    agentClientMock.getAllureSkipCandidates.mockResolvedValue({
      candidates: [
        {
          full_name: "tests.billing.test_payments#test_retry",
          name: "test_retry",
          product: "Billing",
        },
        {
          full_name: "tests.iam.test_auth#test_cross_product",
          name: "test_cross_product",
          product: "IAM",
        },
      ],
      errors: [
        {
          report_url: REPORT_URL,
          message: "Report does not expose Allure suites.json.",
        },
      ],
    });
  });

  it("renders suites with status metadata and expiring-soon highlight", async () => {
    renderWithProviders(<SkippedTestsPanel />);

    expect(await screen.findByText("owner@example.com")).toBeInTheDocument();
    const activeRow = screen.getByRole("button", { name: "Cancel skipped suite 3" }).closest("tr");
    const expiredRow = screen.getByRole("button", { name: "Cancel skipped suite 2" }).closest("tr");
    const cancelledRow = screen.getByRole("button", { name: "Cancel skipped suite 1" }).closest("tr");

    expect(activeRow).toHaveAttribute("data-suite-status", "active");
    expect(activeRow).toHaveAttribute("data-expiring-soon", "true");
    expect(within(activeRow as HTMLElement).getByText("Soon")).toBeInTheDocument();

    expect(expiredRow).toHaveAttribute("data-suite-status", "expired");
    expect(expiredRow).toHaveStyle({ opacity: "0.7" });

    expect(cancelledRow).toHaveAttribute("data-suite-status", "cancelled");
    expect(screen.getByText(/by closer@example.com at/i)).toBeInTheDocument();
  });

  it("filters suites by product", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SkippedTestsPanel />);
    expect(await screen.findByText("owner@example.com")).toBeInTheDocument();

    await user.click(screen.getAllByLabelText("Product")[0]);
    await user.click(await screen.findByRole("option", { name: "IAM" }));
    expect(screen.getByText("old@example.com")).toBeInTheDocument();
    expect(screen.queryByText("owner@example.com")).not.toBeInTheDocument();
  });

  it("filters suites by author and finished status", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SkippedTestsPanel />);
    expect(await screen.findByText("owner@example.com")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Author"), "another");
    expect(screen.getByText("another@example.com")).toBeInTheDocument();
    expect(screen.queryByText("owner@example.com")).not.toBeInTheDocument();

    await user.clear(screen.getByLabelText("Author"));
    await user.click(screen.getAllByLabelText("Status")[0]);
    await user.click(await screen.findByRole("option", { name: "Finished" }));
    expect(screen.getByText("old@example.com")).toBeInTheDocument();
    expect(screen.getByText("another@example.com")).toBeInTheDocument();
    expect(screen.queryByText("owner@example.com")).not.toBeInTheDocument();
  });

  it("renders a neutral unavailable state when skipped suites fail to load", async () => {
    backendClientMock.listLeonidSkippedSuites.mockRejectedValueOnce(new Error("Not Found"));

    renderWithProviders(<SkippedTestsPanel />);

    expect(await screen.findByText("Skipped suites are unavailable right now.")).toBeInTheDocument();
    expect(screen.queryByText("Leonid skipped tests failed")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add skipped suite" })).toBeInTheDocument();
  });

  it("creates a skipped suite with parsed tests and without author field", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SkippedTestsPanel />);
    await screen.findByText("owner@example.com");

    await user.click(screen.getByRole("button", { name: "Add skipped suite" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Reason"), "Temporary skip");
    await user.click(within(dialog).getByLabelText("Product"));
    await user.click(await screen.findByRole("option", { name: "Billing" }));
    await user.clear(within(dialog).getByLabelText("Tests"));
    await user.type(
      within(dialog).getByLabelText("Tests"),
      "tests.billing.test_payments#test_retry\n\n tests.billing.test_payments#test_refund \n tests.billing.test_payments#test_retry"
    );
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(backendClientMock.createLeonidSkippedSuite).toHaveBeenCalledTimes(1);
    expect(backendClientMock.createLeonidSkippedSuite).toHaveBeenCalledWith(
      TOKEN,
      expect.objectContaining({
        reason: "Temporary skip",
        product: "Billing",
        tests: [
          { full_name: "tests.billing.test_payments#test_retry" },
          { full_name: "tests.billing.test_payments#test_refund" },
        ],
      })
    );
    expect(backendClientMock.createLeonidSkippedSuite.mock.calls[0][1]).not.toHaveProperty("author");
  }, 10_000);

  it("loads imported Allure candidates, flags mismatches, and saves only checked tests plus manual ones", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SkippedTestsPanel />);
    await screen.findByText("owner@example.com");

    await user.click(screen.getByRole("button", { name: "Add skipped suite" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Reason"), "Imported skip");
    await user.click(within(dialog).getByLabelText("Product"));
    await user.click(await screen.findByRole("option", { name: "Billing" }));
    await user.click(within(dialog).getByText("From Allure"));
    await user.type(within(dialog).getByLabelText("Report URL 1"), REPORT_URL);
    await user.click(within(dialog).getByRole("button", { name: "Load tests" }));

    expect(discoverAgentMock).toHaveBeenCalledTimes(1);
    expect(agentClientMock.getAllureSkipCandidates).toHaveBeenCalledWith(
      AGENT_PORT,
      TOKEN,
      {
        product: "Billing",
        reportUrls: [REPORT_URL],
      }
    );

    expect(await within(dialog).findByText("tests.billing.test_payments#test_retry")).toBeInTheDocument();
    const importedCheckbox = within(dialog).getByRole("checkbox", {
      name: "Include test tests.billing.test_payments#test_retry",
    });
    expect(importedCheckbox).toBeChecked();

    const mismatchRow = within(dialog)
      .getByText("tests.iam.test_auth#test_cross_product")
      .closest("tr") as HTMLElement;
    expect(mismatchRow).toHaveAttribute("data-product-mismatch", "true");
    expect(within(mismatchRow).getByText("Mismatch")).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("checkbox", {
        name: "Include test tests.iam.test_auth#test_cross_product",
      })
    );

    expect(await within(dialog).findByText("Some reports could not be imported")).toBeInTheDocument();
    expect(within(dialog).getByText(`${REPORT_URL}: Report does not expose Allure suites.json.`)).toBeInTheDocument();

    await user.type(
      within(dialog).getByLabelText("Manual additions"),
      "tests.billing.test_payments#test_retry\ntests.billing.test_payments#test_manual"
    );
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(backendClientMock.createLeonidSkippedSuite).toHaveBeenCalledWith(
      TOKEN,
      expect.objectContaining({
        reason: "Imported skip",
        product: "Billing",
        tests: [
          { full_name: "tests.billing.test_payments#test_retry" },
          { full_name: "tests.billing.test_payments#test_manual" },
        ],
      })
    );
  });

  it("blocks creation when expiry exceeds the 7 day limit", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SkippedTestsPanel />);
    await screen.findByText("owner@example.com");

    await user.click(screen.getByRole("button", { name: "Add skipped suite" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Reason"), "Too long");
    await user.click(within(dialog).getByLabelText("Product"));
    await user.click(await screen.findByRole("option", { name: "Billing" }));
    await user.type(within(dialog).getByLabelText("Tests"), "tests.billing.test_payments#test_retry");
    await user.clear(within(dialog).getByLabelText("Expires at"));
    await user.type(
      within(dialog).getByLabelText("Expires at"),
      toLocalDateTimeInputValue(new Date(Date.now() + 7 * DAY_IN_MS + 60 * 1000))
    );

    expect(await within(dialog).findByText("Expiry cannot be more than 7 days ahead.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
    expect(backendClientMock.createLeonidSkippedSuite).not.toHaveBeenCalled();
  });

  it("cancels an active suite after confirmation", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SkippedTestsPanel />);
    await screen.findByText("owner@example.com");

    await user.click(screen.getByRole("button", { name: "Cancel skipped suite 3" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel suite" }));

    expect(backendClientMock.cancelLeonidSkippedSuite).toHaveBeenCalledWith(TOKEN, 3);
  });
});

