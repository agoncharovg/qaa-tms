import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const agentClientMock = vi.hoisted(() => ({
  createLeonidSharedResource: vi.fn(),
  createLeonidSharedResourceLimit: vi.fn(),
  deleteLeonidSharedResource: vi.fn(),
  deleteLeonidSharedResourceLimit: vi.fn(),
  listLeonidSharedResourceLimitTypes: vi.fn(),
  listLeonidSharedResourceLimits: vi.fn(),
  listLeonidSharedResources: vi.fn(),
  toggleLeonidSharedResource: vi.fn(),
  updateLeonidSharedResource: vi.fn(),
  updateLeonidSharedResourceLimit: vi.fn(),
}));

vi.mock("@/api/agentClient", () => ({ agentClient: agentClientMock }));

import { SharedResourcesPanel } from "@/plugins/leonid/SharedResourcesPanel";
import { resetAuthStoreState, useAuthStore } from "@/store/authStore";
import { renderWithProviders } from "@/test/render";

const PORT = 47600;
const TOKEN = "test-token";

describe("SharedResourcesPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAuthStoreState();
    useAuthStore.setState({ token: TOKEN });
    agentClientMock.listLeonidSharedResourceLimitTypes.mockResolvedValue([{ id: 1, name: "day" }]);
    agentClientMock.listLeonidSharedResourceLimits.mockResolvedValue([
      { id: 10, resource_name: "cdn-ip-pool", limit_type: 1, limit_value: 5, reset_date: null },
    ]);
    agentClientMock.listLeonidSharedResources.mockResolvedValue([
      { id: 20, resource_limit: 10, value: "1.2.3.4", count: 3, enabled: true },
    ]);
    agentClientMock.createLeonidSharedResourceLimit.mockResolvedValue({});
    agentClientMock.deleteLeonidSharedResourceLimit.mockResolvedValue(undefined);
    agentClientMock.toggleLeonidSharedResource.mockResolvedValue({});
  });

  it("renders limits and resources from the agent", async () => {
    renderWithProviders(<SharedResourcesPanel agentPort={PORT} />);
    expect(await screen.findByText("1.2.3.4")).toBeInTheDocument();
    expect(screen.getAllByText("cdn-ip-pool").length).toBeGreaterThan(0);
  });

  it("creates a limit through the modal", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SharedResourcesPanel agentPort={PORT} />);
    await screen.findByText("1.2.3.4");

    await user.click(screen.getByRole("button", { name: "Add limit" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Resource name"), "gpu-pool");
    await user.click(within(dialog).getByLabelText("Limit type"));
    await user.click(await screen.findByRole("option", { name: "day" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(agentClientMock.createLeonidSharedResourceLimit).toHaveBeenCalledWith(PORT, TOKEN, {
      resource_name: "gpu-pool",
      limit_type: 1,
      limit_value: 0,
      reset_date: null,
    });
  });

  it("toggles a resource", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SharedResourcesPanel agentPort={PORT} />);
    await screen.findByText("1.2.3.4");

    await user.click(screen.getByRole("button", { name: "Toggle resource 1.2.3.4" }));
    expect(agentClientMock.toggleLeonidSharedResource).toHaveBeenCalledWith(PORT, TOKEN, 20);
  });

  it("deletes a limit after confirmation", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SharedResourcesPanel agentPort={PORT} />);
    await screen.findByText("1.2.3.4");

    await user.click(screen.getByRole("button", { name: "Delete limit cdn-ip-pool" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    expect(agentClientMock.deleteLeonidSharedResourceLimit).toHaveBeenCalledWith(PORT, TOKEN, 10);
  });

  it("shows an error alert when a list request fails", async () => {
    agentClientMock.listLeonidSharedResourceLimits.mockRejectedValue(new Error("boom"));
    renderWithProviders(<SharedResourcesPanel agentPort={PORT} />);
    expect(await screen.findByText("Leonid shared resources failed")).toBeInTheDocument();
  });
});
