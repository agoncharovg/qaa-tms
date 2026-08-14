import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const agentClientMock = vi.hoisted(() => ({
  getKubeContexts: vi.fn(),
  useKubeContext: vi.fn(),
}));

vi.mock("@/api/agentClient", () => ({
  agentClient: agentClientMock,
}));

import { ClustersPanel } from "@/plugins/kuber/ClustersPanel";
import { renderWithProviders } from "@/test/render";
import { resetAuthStoreState, useAuthStore } from "@/store/authStore";
import { resetKuberStoreState, useKuberStore } from "@/plugins/kuber/kuberStore";

describe("ClustersPanel", () => {
  beforeEach(() => {
    agentClientMock.getKubeContexts.mockReset();
    agentClientMock.useKubeContext.mockReset();
    localStorage.clear();
    resetAuthStoreState();
    resetKuberStoreState();

    useAuthStore.setState({
      currentUser: {
        auto_login: false,
        created_at: "2026-08-11T00:00:00Z",
        display_name: "Test User",
        enabled_plugins: ["stagings", "kuber", "qaa-generator"],
        qaa_generator_token_set: false,
        id: 2,
        is_admin: false,
        updated_at: "2026-08-11T00:00:00Z",
        username: "test",
      },
      token: "token-123",
    });
  });

  it("renders contexts and runs the set-active client action", async () => {
    const user = userEvent.setup();

    agentClientMock.getKubeContexts.mockResolvedValue({
      contexts: [
        {
          cluster: "dev-cluster",
          current: true,
          name: "team/dev",
          namespace: "qa-demo",
          user: "dev-user",
        },
        {
          cluster: "prod-cluster",
          current: false,
          name: "team/prod",
          namespace: null,
          user: "prod-user",
        },
      ],
      currentContext: "team/dev",
      exitCode: 0,
    });
    agentClientMock.useKubeContext.mockResolvedValue({
      raw: "ok\n",
      exitCode: 0,
    });

    renderWithProviders(<ClustersPanel agentPort={47600} />);

    expect(await screen.findByText("team/dev")).toBeInTheDocument();
    expect(screen.getAllByText("Current")).toHaveLength(2);

    await user.click(screen.getAllByRole("button", { name: "Set as active" })[1]);

    await waitFor(() => {
      expect(agentClientMock.useKubeContext).toHaveBeenCalledWith(47600, "token-123", "team/prod");
    });

    await user.click(screen.getByText("team/prod"));
    expect(useKuberStore.getState().selectedContext).toBe("team/prod");
  });
});
