import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const agentClientMock = vi.hoisted(() => ({
  discoverAgent: vi.fn(),
  getPing: vi.fn(),
  requestUpdate: vi.fn(),
}));

const backendClientMock = vi.hoisted(() => ({
  getAgentManifest: vi.fn(),
}));

vi.mock("@/api/agentClient", () => ({
  agentClient: {
    getPing: agentClientMock.getPing,
    requestUpdate: agentClientMock.requestUpdate,
  },
  discoverAgent: agentClientMock.discoverAgent,
  requestAgentUpdate: agentClientMock.requestUpdate,
}));

vi.mock("@/api/backendClient", () => ({
  backendClient: {
    getAgentManifest: backendClientMock.getAgentManifest,
  },
}));

import { CompanionGate } from "@/plugins/companion/CompanionGate";
import { useCompanionStatus } from "@/plugins/companion/useCompanionStatus";
import { renderWithProviders } from "@/test/render";
import { resetAuthStoreState, useAuthStore } from "@/store/authStore";

function HookProbe() {
  const status = useCompanionStatus();
  return <div>{status.kind}</div>;
}

describe("CompanionGate", () => {
  beforeEach(() => {
    agentClientMock.discoverAgent.mockReset();
    agentClientMock.getPing.mockReset();
    agentClientMock.requestUpdate.mockReset();
    backendClientMock.getAgentManifest.mockReset();
    resetAuthStoreState();
    useAuthStore.setState({ token: "token-123" });
  });

  it("reports not-installed status and renders download guidance", async () => {
    backendClientMock.getAgentManifest.mockResolvedValue({
      downloadUrl: "/api/v1/agent/download",
      minSupported: "0.1.0",
      os: null,
      sha256: "abc",
      version: "0.2.0",
    });
    agentClientMock.discoverAgent.mockResolvedValue(null);

    renderWithProviders(
      <>
        <HookProbe />
        <CompanionGate loadingMessage="Checking the local companion.">content</CompanionGate>
      </>
    );

    expect(await screen.findByText("not-installed")).toBeInTheDocument();
    expect(await screen.findByText("Companion is not installed")).toBeInTheDocument();
    expect(screen.getByText(/curl -fsSL .*\/api\/v1\/agent\/install\.sh \| bash/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy command" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download" })).toHaveAttribute(
      "href",
      "/api/v1/agent/download"
    );
  });

  it("blocks plugin content when the installed version is below minSupported", async () => {
    backendClientMock.getAgentManifest.mockResolvedValue({
      downloadUrl: "/api/v1/agent/download",
      minSupported: "0.2.0",
      os: null,
      sha256: "abc",
      version: "0.3.0",
    });
    agentClientMock.discoverAgent.mockResolvedValue({
      agent: {
        app: "qaa-tms-agent",
        os: "linux",
        stagingsInstalled: true,
        stagingsSha: "abc123",
        selfUpdateSupported: true,
        version: "0.1.0",
      },
      port: 47600,
    });

    renderWithProviders(
      <CompanionGate loadingMessage="Checking the local companion.">protected content</CompanionGate>
    );

    expect(await screen.findByText("Update required")).toBeInTheDocument();
    expect(screen.queryByText("protected content")).not.toBeInTheDocument();
  });

  it("renders plugin content with a non-blocking update banner when a newer version exists", async () => {
    backendClientMock.getAgentManifest.mockResolvedValue({
      downloadUrl: "/api/v1/agent/download",
      minSupported: "0.1.0",
      os: null,
      sha256: "abc",
      version: "0.2.0",
    });
    agentClientMock.discoverAgent.mockResolvedValue({
      agent: {
        app: "qaa-tms-agent",
        os: "linux",
        stagingsInstalled: true,
        stagingsSha: "abc123",
        selfUpdateSupported: true,
        version: "0.1.0",
      },
      port: 47600,
    });

    renderWithProviders(
      <CompanionGate loadingMessage="Checking the local companion.">usable content</CompanionGate>
    );

    expect(await screen.findByText("Update available")).toBeInTheDocument();
    expect(screen.getByText("usable content")).toBeInTheDocument();
  });

  it("suppresses the update-available banner for source-run agents", async () => {
    backendClientMock.getAgentManifest.mockResolvedValue({
      downloadUrl: "/api/v1/agent/download",
      minSupported: "0.1.0",
      os: null,
      sha256: "abc",
      version: "0.2.0",
    });
    agentClientMock.discoverAgent.mockResolvedValue({
      agent: {
        app: "qaa-tms-agent",
        os: "linux",
        stagingsInstalled: true,
        stagingsSha: "abc123",
        selfUpdateSupported: false,
        version: "0.1.0",
      },
      port: 47600,
    });

    renderWithProviders(
      <CompanionGate loadingMessage="Checking the local companion.">usable content</CompanionGate>
    );

    expect(await screen.findByText("usable content")).toBeInTheDocument();
    expect(screen.queryByText("Update available")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Update" })).not.toBeInTheDocument();
  });

  it("runs the update action and reaches the ok state after the version changes", async () => {
    const user = userEvent.setup();

    backendClientMock.getAgentManifest.mockResolvedValue({
      downloadUrl: "/api/v1/agent/download",
      minSupported: "0.1.0",
      os: null,
      sha256: "abc",
      version: "0.2.0",
    });
    agentClientMock.discoverAgent
      .mockResolvedValueOnce({
        agent: {
          app: "qaa-tms-agent",
          os: "linux",
          stagingsInstalled: true,
          stagingsSha: "abc123",
          selfUpdateSupported: true,
          version: "0.1.0",
        },
        port: 47600,
      })
      .mockResolvedValue({
        agent: {
          app: "qaa-tms-agent",
          os: "linux",
          stagingsInstalled: true,
          stagingsSha: "abc123",
          selfUpdateSupported: true,
          version: "0.2.0",
        },
        port: 47600,
      });
    agentClientMock.requestUpdate.mockResolvedValue({ status: "accepted" });
    agentClientMock.getPing.mockResolvedValue({
      app: "qaa-tms-agent",
      os: "linux",
      stagingsInstalled: true,
      stagingsSha: "abc123",
      version: "0.2.0",
    });

    renderWithProviders(
      <CompanionGate loadingMessage="Checking the local companion.">updated content</CompanionGate>
    );

    await user.click(await screen.findByRole("button", { name: "Update" }));

    await waitFor(() => {
      expect(agentClientMock.requestUpdate).toHaveBeenCalledWith(47600, "token-123");
    });
    expect(await screen.findByText("updated content")).toBeInTheDocument();
  });
});
