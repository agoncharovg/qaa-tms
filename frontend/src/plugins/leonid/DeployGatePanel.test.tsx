import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";

const agentClientMock = vi.hoisted(() => ({
  getLeonidProducts: vi.fn(),
  getLeonidStatus: vi.fn(),
}));

const AgentRequestErrorMock = vi.hoisted(
  () =>
    class AgentRequestErrorMock extends Error {
      status: number;

      constructor(message: string, status: number) {
        super(message);
        this.name = "AgentRequestError";
        this.status = status;
      }
    }
);

vi.mock("@/api/agentClient", () => ({
  AgentRequestError: AgentRequestErrorMock,
  agentClient: agentClientMock,
}));

import { DeployGatePanel } from "@/plugins/leonid/DeployGatePanel";
import { renderWithProviders } from "@/test/render";
import { resetAuthStoreState, useAuthStore } from "@/store/authStore";

describe("DeployGatePanel", () => {
  beforeEach(() => {
    agentClientMock.getLeonidProducts.mockReset();
    agentClientMock.getLeonidStatus.mockReset();
    localStorage.clear();
    resetAuthStoreState();
    useAuthStore.setState({ token: "token-123" });
  });

  it("renders a loading state while products are loading", async () => {
    agentClientMock.getLeonidProducts.mockReturnValue(new Promise(() => undefined));

    renderWithProviders(<DeployGatePanel agentPort={47600} />);

    expect(await screen.findByText("Loading Leonid deploy gate.")).toBeInTheDocument();
  });

  it("renders an error state when the products request fails", async () => {
    agentClientMock.getLeonidProducts.mockRejectedValue(new Error("Leonid is down"));

    renderWithProviders(<DeployGatePanel agentPort={47600} />);

    expect(await screen.findByText("Leonid is down")).toBeInTheDocument();
  });

  it("renders an empty state when all products return 404", async () => {
    agentClientMock.getLeonidProducts.mockResolvedValue({
      configured: true,
      products: ["iam", "dns"],
    });
    agentClientMock.getLeonidStatus.mockRejectedValue(
      new AgentRequestErrorMock("No data", 404)
    );

    renderWithProviders(<DeployGatePanel agentPort={47600} />);

    expect(await screen.findByText("No Leonid products returned deploy gate data.")).toBeInTheDocument();
  });

  it("renders visible product cards and hides 404 products", async () => {
    agentClientMock.getLeonidProducts.mockResolvedValue({
      configured: true,
      products: ["iam", "dns"],
    });
    agentClientMock.getLeonidStatus.mockImplementation((_port: number, _token: string, product: string) => {
      if (product === "dns") {
        throw new AgentRequestErrorMock("No data", 404);
      }

      return {
        product: "iam",
        allow_to_deploy: false,
        reason: "2 failed UI tests",
        failed_tests: [
          {
            test_name: "billing smoke",
            steps: [
              {
                step_name: "checkout",
                error_message: "Button stayed disabled",
              },
            ],
          },
        ],
        last_build_date: "2026-08-21T10:15:00Z",
        build_link: "https://jenkins.example/build/77",
        force_deploy: false,
      };
    });

    renderWithProviders(<DeployGatePanel agentPort={47600} />);

    expect(await screen.findByText("IAM")).toBeInTheDocument();
    expect(screen.getByText("2 failed UI tests")).toBeInTheDocument();
    expect(screen.queryByText("DNS")).not.toBeInTheDocument();
  });
});
