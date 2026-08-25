import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const backendClientMock = vi.hoisted(() => ({
  createLeonidObjectDefinition: vi.fn(),
  createLeonidObjectValue: vi.fn(),
  deleteLeonidObjectDefinition: vi.fn(),
  deleteLeonidObjectValue: vi.fn(),
  listLeonidObjectDefinitions: vi.fn(),
  listLeonidObjectValues: vi.fn(),
  toggleLeonidObjectDefinition: vi.fn(),
  toggleLeonidObjectValue: vi.fn(),
  updateLeonidObjectDefinition: vi.fn(),
  updateLeonidObjectValue: vi.fn(),
}));

vi.mock("@/api/backendClient", () => ({ backendClient: backendClientMock }));

import { ObjectsPanel } from "@/plugins/leonid/ObjectsPanel";
import { resetAuthStoreState, useAuthStore } from "@/store/authStore";
import { renderWithProviders } from "@/test/render";

const TOKEN = "test-token";

describe("ObjectsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAuthStoreState();
    useAuthStore.setState({ token: TOKEN });
    backendClientMock.listLeonidObjectDefinitions.mockResolvedValue([
      { id: 1, object_name: "origins", comment: null, enabled: true },
    ]);
    backendClientMock.listLeonidObjectValues.mockResolvedValue([]);
    backendClientMock.createLeonidObjectDefinition.mockResolvedValue({});
    backendClientMock.deleteLeonidObjectDefinition.mockResolvedValue(undefined);
    backendClientMock.toggleLeonidObjectDefinition.mockResolvedValue({});
  });

  it("renders object definitions from the agent", async () => {
    renderWithProviders(<ObjectsPanel />);
    expect(await screen.findByText("origins")).toBeInTheDocument();
  });

  it("creates an object definition through the modal", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ObjectsPanel />);
    await screen.findByText("origins");

    await user.click(screen.getByRole("button", { name: "Add object definition" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Object name"), "buckets");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(backendClientMock.createLeonidObjectDefinition).toHaveBeenCalledWith(TOKEN, {
      object_name: "buckets",
      comment: null,
      enabled: true,
    });
  });

  it("toggles an object definition", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ObjectsPanel />);
    await screen.findByText("origins");

    await user.click(screen.getByRole("button", { name: "Toggle object definition origins" }));
    expect(backendClientMock.toggleLeonidObjectDefinition).toHaveBeenCalledWith(TOKEN, 1);
  });

  it("deletes an object definition after confirmation", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ObjectsPanel />);
    await screen.findByText("origins");

    await user.click(screen.getByRole("button", { name: "Delete object definition origins" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    expect(backendClientMock.deleteLeonidObjectDefinition).toHaveBeenCalledWith(TOKEN, 1);
  });

  it("shows an error alert when the list request fails", async () => {
    backendClientMock.listLeonidObjectDefinitions.mockRejectedValue(new Error("boom"));
    renderWithProviders(<ObjectsPanel />);
    expect(await screen.findByText("Leonid objects failed")).toBeInTheDocument();
    expect(screen.getByText("boom")).toBeInTheDocument();
  });
});
