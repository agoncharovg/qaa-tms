import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const agentClientMock = vi.hoisted(() => ({
  sync: vi.fn(),
}));
const getPreflightMock = vi.hoisted(() => vi.fn());
const useTransientLiveJobMock = vi.hoisted(() => vi.fn());

vi.mock("@/api/agentClient", () => ({
  agentClient: agentClientMock,
  getPreflight: getPreflightMock,
}));

vi.mock("@/plugins/stagings/useTransientLiveJob", () => ({
  useTransientLiveJob: useTransientLiveJobMock,
}));

import { SyncPanel } from "@/plugins/stagings/SyncPanel";
import { renderWithProviders } from "@/test/render";
import { resetAuthStoreState, useAuthStore } from "@/store/authStore";

describe("SyncPanel", () => {
  beforeEach(() => {
    agentClientMock.sync.mockReset();
    getPreflightMock.mockReset();
    useTransientLiveJobMock.mockReset();
    localStorage.clear();
    resetAuthStoreState();

    useAuthStore.setState({
      currentUser: {
        auto_login: false,
        created_at: "2026-08-09T00:00:00Z",
        display_name: "Test User",
        enabled_plugins: ["stagings"],
        id: 2,
        is_admin: false,
        updated_at: "2026-08-09T00:00:00Z",
        username: "test",
      },
      token: "token-123",
    });

    useTransientLiveJobMock.mockReturnValue({
      cancelMutation: { isPending: false, mutateAsync: vi.fn() },
      clearLiveJob: vi.fn(),
      isJobRunning: false,
      jobQuery: null,
      liveJob: null,
      logViewportRef: { current: null },
      reduceLiveJob: vi.fn(),
      startLiveJob: vi.fn(),
    });

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

    agentClientMock.sync.mockResolvedValue({
      jobId: "job-123",
      opId: "00000000-0000-0000-0000-000000000123",
    });
  });

  it("builds the exact SyncRequest from the form", async () => {
    const user = userEvent.setup();

    renderWithProviders(<SyncPanel />);

    await user.type(await screen.findByLabelText("Service"), "iam-api");
    await user.click(screen.getByRole("checkbox", { name: "Verbose" }));
    await user.click(screen.getByRole("checkbox", { name: "Apply" }));
    await user.click(screen.getByRole("button", { name: "Run sync" }));

    await waitFor(() => {
      expect(agentClientMock.sync).toHaveBeenCalledWith(47600, "token-123", {
        flags: {
          apply: true,
          pull: false,
          service: "iam-api",
          verbose: true,
        },
      });
    });
  });
});
