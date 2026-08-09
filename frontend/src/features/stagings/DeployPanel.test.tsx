import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const agentClientMock = vi.hoisted(() => ({
  cancelJob: vi.fn(),
  deploy: vi.fn(),
  getJob: vi.fn(),
  streamJob: vi.fn(),
}));

const getPreflightMock = vi.hoisted(() => vi.fn());

vi.mock("@/api/agentClient", () => ({
  agentClient: agentClientMock,
  getPreflight: getPreflightMock,
}));

import { DeployPanel } from "@/features/stagings/DeployPanel";
import { renderWithProviders } from "@/test/render";
import { resetAuthStoreState, useAuthStore } from "@/store/authStore";
import { resetStagingsStoreState } from "@/store/stagingsStore";
import { resetUiStoreState } from "@/store/uiStore";

describe("DeployPanel", () => {
  beforeEach(() => {
    agentClientMock.cancelJob.mockReset();
    agentClientMock.deploy.mockReset();
    agentClientMock.getJob.mockReset();
    agentClientMock.streamJob.mockReset();
    getPreflightMock.mockReset();
    localStorage.clear();
    resetAuthStoreState();
    resetStagingsStoreState();
    resetUiStoreState();

    useAuthStore.setState({
      currentUser: {
        auto_login: false,
        created_at: "2026-08-09T00:00:00Z",
        display_name: "Test User",
        id: 2,
        is_admin: false,
        updated_at: "2026-08-09T00:00:00Z",
        username: "test",
      },
      token: "token-123",
    });
  });

  it("builds the expected deploy request from the form", async () => {
    const user = userEvent.setup();
    getPreflightMock.mockResolvedValue({
      agent: {
        app: "qaa-tms-agent",
        os: "linux",
        stagingsInstalled: true,
        stagingsSha: "abc123",
        version: "0.1.0",
      },
      checklist: [],
      detected: true,
      port: 47600,
    });
    agentClientMock.deploy.mockResolvedValue({
      jobId: "job-123",
      opId: "00000000-0000-0000-0000-000000000123",
    });
    agentClientMock.getJob.mockResolvedValue({
      argv: [],
      createdAt: "2026-08-09T10:00:00Z",
      exitCode: null,
      finishedAt: null,
      jobId: "job-123",
      opId: "00000000-0000-0000-0000-000000000123",
      startedAt: "2026-08-09T10:00:01Z",
      status: "running",
    });
    agentClientMock.streamJob.mockResolvedValue(undefined);

    renderWithProviders(<DeployPanel />);

    await user.type(await screen.findByRole("textbox", { name: /Namespace/i }), "qa-demo");
    await user.type(screen.getByRole("textbox", { name: /Services/i }), "iam-api, billing-api");
    await user.type(screen.getByRole("textbox", { name: /^Service$/i }), "iam-api");
    await user.type(screen.getByRole("textbox", { name: /Tag/i }), "sha-123");
    await user.click(screen.getByRole("checkbox", { name: /Full/i }));
    await user.click(screen.getByRole("checkbox", { name: /Dry run/i }));
    await user.click(screen.getByRole("checkbox", { name: /No sync/i }));
    await user.type(screen.getByRole("spinbutton", { name: /Stage/i }), "4");
    await user.click(screen.getByRole("button", { name: "Deploy" }));

    await waitFor(() => {
      expect(agentClientMock.deploy).toHaveBeenCalledWith(47600, "token-123", {
        flags: {
          dryRun: true,
          full: true,
          noSync: true,
          stage: 4,
        },
        images: {
          "iam-api": "sha-123",
        },
        ns: "qa-demo",
        services: ["iam-api", "billing-api"],
      });
    });
  });

  it("shows the companion app state and disables deploy when the agent is absent", async () => {
    getPreflightMock.mockResolvedValue({
      detected: false,
      ports: [47600, 47601],
    });

    renderWithProviders(<DeployPanel />);

    expect(await screen.findByText("Companion app is not running")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deploy" })).toBeDisabled();
  });
});
