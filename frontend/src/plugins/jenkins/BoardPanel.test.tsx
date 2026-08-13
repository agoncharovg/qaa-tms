import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const agentClientMock = vi.hoisted(() => ({
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

import { BoardPanel } from "@/plugins/jenkins/BoardPanel";
import { resetAuthStoreState, useAuthStore } from "@/store/authStore";
import { resetJenkinsStoreState, useJenkinsStore } from "@/plugins/jenkins/jenkinsStore";
import { renderWithProviders } from "@/test/render";
import { resetUiStoreState } from "@/store/uiStore";

const openMock = vi.fn();

describe("BoardPanel", () => {
  beforeEach(() => {
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
        id: 2,
        is_admin: false,
        updated_at: "2026-08-12T00:00:00Z",
        username: "test",
      },
      token: "token-123",
    });
  });

  it("renders recursive status counts and opens the folder on double click", async () => {
    const user = userEvent.setup();

    useJenkinsStore.setState({
      pinnedPaths: ["job/.QAA/job/E2E/job/PREPROD"],
    });

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
            {
              children: [
                {
                  children: [],
                  color: "red",
                  kind: "pipeline",
                  name: "Nested failure",
                  path: "job/.QAA/job/E2E/job/PREPROD/job/Nested/job/Failure",
                  status: "failed",
                  url: "https://jenkins.p.gc.onl/job/.QAA/job/E2E/job/PREPROD/job/Nested/job/Failure/",
                },
                {
                  children: [],
                  color: "yellow",
                  kind: "pipeline",
                  name: "Nested stuck",
                  path: "job/.QAA/job/E2E/job/PREPROD/job/Nested/job/Stuck",
                  status: "stuck",
                  url: "https://jenkins.p.gc.onl/job/.QAA/job/E2E/job/PREPROD/job/Nested/job/Stuck/",
                },
                {
                  children: [],
                  color: "notbuilt",
                  kind: "pipeline",
                  name: "Nested gray",
                  path: "job/.QAA/job/E2E/job/PREPROD/job/Nested/job/Gray",
                  status: "notbuilt",
                  url: "https://jenkins.p.gc.onl/job/.QAA/job/E2E/job/PREPROD/job/Nested/job/Gray/",
                },
                {
                  children: [],
                  color: "blue_anime",
                  kind: "pipeline",
                  name: "Nested running",
                  path: "job/.QAA/job/E2E/job/PREPROD/job/Nested/job/Running",
                  status: "running",
                  url: "https://jenkins.p.gc.onl/job/.QAA/job/E2E/job/PREPROD/job/Nested/job/Running/",
                },
              ],
              color: null,
              kind: "folder",
              name: "Nested",
              path: "job/.QAA/job/E2E/job/PREPROD/job/Nested",
              status: null,
              url: "https://jenkins.p.gc.onl/job/.QAA/job/E2E/job/PREPROD/job/Nested/",
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

    renderWithProviders(<BoardPanel agentPort={47600} />);

    expect(await screen.findByText("PREPROD")).toBeInTheDocument();
    expect(screen.getByText("Passed 1")).toBeInTheDocument();
    expect(screen.getByText("Failed 1")).toBeInTheDocument();
    expect(screen.getByText("Gray 1")).toBeInTheDocument();
    expect(screen.getByText("Stuck 1")).toBeInTheDocument();
    expect(screen.getByText("Running 1")).toBeInTheDocument();

    await user.click(screen.getByText("PREPROD"));
    expect(await screen.findByText("Nested failure")).toBeInTheDocument();
    expect(screen.getByText("Nested running")).toBeInTheDocument();

    await user.dblClick(screen.getByText("PREPROD"));
    expect(openMock).toHaveBeenCalledWith(
      "https://jenkins.p.gc.onl/job/.QAA/job/E2E/job/PREPROD/",
      "_blank",
      "noopener"
    );
  });

  it("renders a pinned pipeline as a single-item widget", async () => {
    useJenkinsStore.setState({
      pinnedPaths: ["job/.QAA/job/E2E/job/PREPROD/job/Smoke"],
    });

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

    renderWithProviders(<BoardPanel agentPort={47600} />);

    expect(await screen.findByText("Smoke")).toBeInTheDocument();
    expect(screen.getByText("Passed 1")).toBeInTheDocument();
    expect(screen.getByText("Failed 0")).toBeInTheDocument();
    expect(screen.getByText("Gray 0")).toBeInTheDocument();
    expect(screen.getByText("Stuck 0")).toBeInTheDocument();
    expect(screen.getByText("Running 0")).toBeInTheDocument();
  });
});
