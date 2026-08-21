import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const agentClientMock = vi.hoisted(() => ({
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

vi.mock("@/api/agentClient", () => ({ agentClient: agentClientMock }));

import { ObjectsPanel } from "@/plugins/leonid/ObjectsPanel";
import { resetAuthStoreState, useAuthStore } from "@/store/authStore";
import { renderWithProviders } from "@/test/render";

const PORT = 47600;
const TOKEN = "test-token";

describe("ObjectsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAuthStoreState();
    useAuthStore.setState({ token: TOKEN });
    agentClientMock.listLeonidObjectDefinitions.mockResolvedValue([
      { id: 1, object_name: "origins", comment: null, enabled: true },
    ]);
    agentClientMock.listLeonidObjectValues.mockResolvedValue([]);
    agentClientMock.createLeonidObjectDefinition.mockResolvedValue({});
    agentClientMock.deleteLeonidObjectDefinition.mockResolvedValue(undefined);
    agentClientMock.toggleLeonidObjectDefinition.mockResolvedValue({});
  });

  it("renders object definitions from the agent", async () => {
    renderWithProviders(<ObjectsPanel agentPort={PORT} />);
    expect(await screen.findByText("origins")).toBeInTheDocument();
  });

  it("creates an object definition through the modal", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ObjectsPanel agentPort={PORT} />);
    await screen.findByText("origins");

    await user.click(screen.getByRole("button", { name: "Add object definition" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Object name"), "buckets");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(agentClientMock.createLeonidObjectDefinition).toHaveBeenCalledWith(PORT, TOKEN, {
      object_name: "buckets",
      comment: null,
      enabled: true,
    });
  });

  it("toggles an object definition", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ObjectsPanel agentPort={PORT} />);
    await screen.findByText("origins");

    await user.click(screen.getByRole("button", { name: "Toggle object definition origins" }));
    expect(agentClientMock.toggleLeonidObjectDefinition).toHaveBeenCalledWith(PORT, TOKEN, 1);
  });

  it("deletes an object definition after confirmation", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ObjectsPanel agentPort={PORT} />);
    await screen.findByText("origins");

    await user.click(screen.getByRole("button", { name: "Delete object definition origins" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    expect(agentClientMock.deleteLeonidObjectDefinition).toHaveBeenCalledWith(PORT, TOKEN, 1);
  });

  it("shows an error alert when the list request fails", async () => {
    agentClientMock.listLeonidObjectDefinitions.mockRejectedValue(new Error("boom"));
    renderWithProviders(<ObjectsPanel agentPort={PORT} />);
    expect(await screen.findByText("Leonid objects failed")).toBeInTheDocument();
    expect(screen.getByText("boom")).toBeInTheDocument();
  });
});
