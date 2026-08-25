import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const backendClientMock = vi.hoisted(() => ({
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

vi.mock("@/api/backendClient", () => ({ backendClient: backendClientMock }));

import { SharedResourcesPanel } from "@/plugins/leonid/SharedResourcesPanel";
import { resetAuthStoreState, useAuthStore } from "@/store/authStore";
import { renderWithProviders } from "@/test/render";

const TOKEN = "test-token";

describe("SharedResourcesPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAuthStoreState();
    useAuthStore.setState({ token: TOKEN });
    backendClientMock.listLeonidSharedResourceLimitTypes.mockResolvedValue([{ id: 1, name: "day" }]);
    backendClientMock.listLeonidSharedResourceLimits.mockResolvedValue([
      { id: 10, resource_name: "cdn-ip-pool", limit_type: 1, limit_value: 5, reset_date: null },
    ]);
    backendClientMock.listLeonidSharedResources.mockResolvedValue([
      { id: 20, resource_limit: 10, value: "1.2.3.4", count: 3, enabled: true },
    ]);
    backendClientMock.createLeonidSharedResourceLimit.mockResolvedValue({});
    backendClientMock.deleteLeonidSharedResourceLimit.mockResolvedValue(undefined);
    backendClientMock.toggleLeonidSharedResource.mockResolvedValue({});
  });

  it("renders limits and resources on separate tabs", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SharedResourcesPanel />);
    expect(await screen.findByRole("button", { name: "Edit limit cdn-ip-pool" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Resources" }));
    expect(await screen.findByRole("button", { name: "Edit resource 1.2.3.4" })).toBeInTheDocument();
  });

  it("creates a limit through the modal", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SharedResourcesPanel />);
    await screen.findByRole("button", { name: "Edit limit cdn-ip-pool" });

    await user.click(screen.getByRole("button", { name: "Add limit" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Resource name"), "gpu-pool");
    await user.click(within(dialog).getByLabelText("Limit type"));
    await user.click(await screen.findByRole("option", { name: "day" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(backendClientMock.createLeonidSharedResourceLimit).toHaveBeenCalledWith(TOKEN, {
      resource_name: "gpu-pool",
      limit_type: 1,
      limit_value: 0,
      reset_date: null,
    });
  });

  it("toggles a resource", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SharedResourcesPanel />);
    await screen.findByRole("button", { name: "Edit limit cdn-ip-pool" });

    await user.click(screen.getByRole("tab", { name: "Resources" }));
    await user.click(await screen.findByRole("button", { name: "Toggle resource 1.2.3.4" }));
    expect(backendClientMock.toggleLeonidSharedResource).toHaveBeenCalledWith(TOKEN, 20);
  });

  it("deletes a limit after confirmation", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SharedResourcesPanel />);
    await screen.findByRole("button", { name: "Edit limit cdn-ip-pool" });

    await user.click(screen.getByRole("button", { name: "Delete limit cdn-ip-pool" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    expect(backendClientMock.deleteLeonidSharedResourceLimit).toHaveBeenCalledWith(TOKEN, 10);
  });

  it("shows an error alert when a list request fails", async () => {
    backendClientMock.listLeonidSharedResourceLimits.mockRejectedValue(new Error("boom"));
    renderWithProviders(<SharedResourcesPanel />);
    expect(await screen.findByText("Leonid shared resources failed")).toBeInTheDocument();
  });
});
