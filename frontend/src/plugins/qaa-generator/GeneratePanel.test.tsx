import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const createQaaRunMock = vi.hoisted(() => vi.fn());
const startRunMock = vi.hoisted(() => vi.fn());
const BackendHttpErrorMock = vi.hoisted(
  () =>
    class BackendHttpErrorMock extends Error {
      payload: unknown;
      status: number;

      constructor(message: string, status: number, payload: unknown) {
        super(message);
        this.name = "BackendHttpError";
        this.payload = payload;
        this.status = status;
      }
    }
);

vi.mock("@/api/backendClient", () => ({
  BackendHttpError: BackendHttpErrorMock,
  backendClient: {
    createQaaRun: createQaaRunMock,
  },
}));

vi.mock("@/plugins/qaa-generator/useQaaRunLive", () => ({
  useQaaRunLive: () => ({
    startRun: startRunMock,
  }),
}));

import { GeneratePanel } from "@/plugins/qaa-generator/GeneratePanel";
import { PluginId, TabId } from "@/constants";
import { renderWithProviders } from "@/test/render";
import { resetAuthStoreState, useAuthStore } from "@/store/authStore";
import { resetUiStoreState, useUiStore } from "@/store/uiStore";

const QAA_ENABLED_PLUGINS = [PluginId.QAA_GENERATOR];

describe("GeneratePanel", () => {
  beforeEach(() => {
    createQaaRunMock.mockReset();
    startRunMock.mockReset();
    localStorage.clear();
    resetAuthStoreState();
    resetUiStoreState();

    useAuthStore.setState({
      currentUser: {
        auto_login: false,
        created_at: "2026-08-11T00:00:00Z",
        display_name: "QAA User",
        enabled_plugins: QAA_ENABLED_PLUGINS,
        id: 3,
        is_admin: false,
        updated_at: "2026-08-11T00:00:00Z",
        username: "user@example.com",
      },
      token: "token-123",
    });
  });

  it("submits the expected qaa-generator create payload", async () => {
    const user = userEvent.setup();
    createQaaRunMock.mockResolvedValue({
      branch: "feature/qaa-generator",
      created_at: "2026-08-11T10:00:00Z",
      dry_run: true,
      jira_key: "QAA-123",
      profile: "balanced",
      run_id: "run-123",
      skip_exec: false,
      skip_pr: true,
      status: "queued",
      updated_at: "2026-08-11T10:00:00Z",
    });

    renderWithProviders(<GeneratePanel />);

    await user.type(screen.getByRole("textbox", { name: /Jira key/i }), "QAA-123");
    await user.type(screen.getByRole("textbox", { name: /Branch/i }), "feature/qaa-generator");
    await user.click(screen.getByRole("switch", { name: /Dry run/i }));
    await user.click(screen.getByRole("switch", { name: /Skip PR/i }));
    await user.click(screen.getByRole("button", { name: "Generate" }));

    await waitFor(() => {
      expect(createQaaRunMock).toHaveBeenCalledWith("token-123", {
        branch: "feature/qaa-generator",
        dry_run: true,
        jira_key: "QAA-123",
        profile: "balanced",
        skip_exec: false,
        skip_pr: true,
      });
    });
    expect(startRunMock).toHaveBeenCalledWith("run-123");
  });

  it("offers to open the existing run after a duplicate 409", async () => {
    const user = userEvent.setup();
    createQaaRunMock.mockRejectedValue(
      new BackendHttpErrorMock("already active", 409, {
        error: "already active",
        run_id: "run-existing",
      })
    );

    renderWithProviders(<GeneratePanel />);

    await user.type(screen.getByRole("textbox", { name: /Jira key/i }), "QAA-123");
    await user.click(screen.getByRole("button", { name: "Generate" }));

    const openExistingRunButton = await screen.findByRole("button", {
      name: "Open existing run",
    });
    await user.click(openExistingRunButton);

    expect(startRunMock).toHaveBeenCalledWith("run-existing");
    expect(useUiStore.getState().tabsByPlugin[PluginId.QAA_GENERATOR].activeTabId).toBe(
      TabId.QAA_LIVE
    );
  });
});
