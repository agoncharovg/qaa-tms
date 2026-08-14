import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const agentClientMock = vi.hoisted(() => ({
  getJenkinsBuilds: vi.fn(),
  getJenkinsTree: vi.fn(),
}));

vi.mock("@/api/agentClient", () => ({
  AgentRequestError: class AgentRequestError extends Error {
    status: number;

    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
  agentClient: agentClientMock,
}));

import { TreePanel } from "@/plugins/jenkins/TreePanel";
import { resetAuthStoreState, useAuthStore } from "@/store/authStore";
import { resetJenkinsStoreState, useJenkinsStore } from "@/plugins/jenkins/jenkinsStore";
import { renderWithProviders } from "@/test/render";
import { resetUiStoreState } from "@/store/uiStore";

const openMock = vi.fn();

describe("TreePanel", () => {
  beforeEach(() => {
    agentClientMock.getJenkinsBuilds.mockReset();
    agentClientMock.getJenkinsTree.mockReset();
    openMock.mockReset();
    localStorage.clear();
    resetAuthStoreState();
    resetJenkinsStoreState();
    resetUiStoreState();
    Object.defineProperty(window, "open", {
      configurable: true,
      value: openMock,
    });

    useAuthStore.setState({
      currentUser: {
        auto_login: false,
        created_at: "2026-08-12T00:00:00Z",
        display_name: "Test User",
        enabled_plugins: ["jenkins"],
        qaa_generator_token_set: false,
        id: 2,
        is_admin: false,
        updated_at: "2026-08-12T00:00:00Z",
        username: "test",
      },
      token: "token-123",
    });
  });

  it("expands pipelines lazily, pins folders and pipelines, and opens Jenkins pages and Allure reports", async () => {
    const user = userEvent.setup();

    agentClientMock.getJenkinsTree.mockResolvedValue({
      roots: [
        {
          children: [
            {
              children: [],
              color: "blue",
              kind: "pipeline",
              name: "Smoke",
              path: "job/.QAA/job/E2E/job/PREPROD/job/Smoke",
              status: "passed",
              url: "https://jenkins.p.gc.onl/job/.QAA/job/E2E/job/PREPROD/job/Smoke/",
            },
          ],
          color: null,
          kind: "folder",
          name: "PREPROD",
          path: "job/.QAA/job/E2E/job/PREPROD",
          status: null,
          url: "https://jenkins.p.gc.onl/job/.QAA/job/E2E/job/PREPROD/",
        },
      ],
    });
    agentClientMock.getJenkinsBuilds.mockResolvedValue({
      builds: [
        {
          allureUrl: "https://jenkins.p.gc.onl/job/.QAA/job/E2E/job/PREPROD/job/Smoke/42/allure/",
          building: false,
          durationMs: 120000,
          number: 42,
          result: "SUCCESS",
          timestamp: Date.now() - 60000,
          url: "https://jenkins.p.gc.onl/job/.QAA/job/E2E/job/PREPROD/job/Smoke/42/",
        },
      ],
    });

    renderWithProviders(<TreePanel agentPort={47600} />);

    expect(await screen.findByText("PREPROD")).toBeInTheDocument();

    await user.click(screen.getByText("Smoke"));

    await waitFor(() => {
      expect(agentClientMock.getJenkinsBuilds).toHaveBeenCalledWith(
        47600,
        "token-123",
        "job/.QAA/job/E2E/job/PREPROD/job/Smoke",
        expect.anything()
      );
    });

    const [folderPinButton, pipelinePinButton] = screen.getAllByRole("button", { name: "Pin to board" });

    await user.click(folderPinButton);
    expect(useJenkinsStore.getState().pinnedPaths).toEqual(["job/.QAA/job/E2E/job/PREPROD"]);
    expect(folderPinButton).toHaveAttribute("aria-label", "Unpin from board");

    await user.click(pipelinePinButton);
    expect(useJenkinsStore.getState().pinnedPaths).toEqual([
      "job/.QAA/job/E2E/job/PREPROD",
      "job/.QAA/job/E2E/job/PREPROD/job/Smoke",
    ]);
    expect(pipelinePinButton).toHaveAttribute("aria-label", "Unpin from board");

    await user.dblClick(screen.getByText("Smoke"));
    expect(openMock).toHaveBeenCalledWith(
      "https://jenkins.p.gc.onl/job/.QAA/job/E2E/job/PREPROD/job/Smoke/",
      "_blank",
      "noopener"
    );

    await user.dblClick(await screen.findByText("#42"));
    expect(openMock).toHaveBeenCalledWith(
      "https://jenkins.p.gc.onl/job/.QAA/job/E2E/job/PREPROD/job/Smoke/42/allure/",
      "_blank",
      "noopener"
    );
  });
});
