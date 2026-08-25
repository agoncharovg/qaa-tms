import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const backendClientMock = vi.hoisted(() => ({
  createLeonidPipelineParam: vi.fn(),
  deleteLeonidPipelineParam: vi.fn(),
  listLeonidPipelineParams: vi.fn(),
  updateLeonidPipelineParam: vi.fn(),
}));

vi.mock("@/api/backendClient", () => ({ backendClient: backendClientMock }));

import { PipelineConfigsPanel } from "@/plugins/leonid/PipelineConfigsPanel";
import { resetAuthStoreState, useAuthStore } from "@/store/authStore";
import { renderWithProviders } from "@/test/render";

const TOKEN = "test-token";

describe("PipelineConfigsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAuthStoreState();
    useAuthStore.setState({ token: TOKEN });
    backendClientMock.listLeonidPipelineParams.mockResolvedValue([
      { id: 7, name: "nightly", job_path: "job/nightly", params: ["--smoke"] },
    ]);
    backendClientMock.createLeonidPipelineParam.mockResolvedValue({});
    backendClientMock.deleteLeonidPipelineParam.mockResolvedValue(undefined);
  });

  it("renders pipeline configs from the agent", async () => {
    renderWithProviders(<PipelineConfigsPanel />);
    expect(await screen.findByText("nightly")).toBeInTheDocument();
    expect(screen.getByText("job/nightly")).toBeInTheDocument();
  });

  it("creates a pipeline config with parsed params", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PipelineConfigsPanel />);
    await screen.findByText("nightly");

    await user.click(screen.getByRole("button", { name: "Add pipeline config" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "weekly");
    await user.type(within(dialog).getByLabelText("Job path"), "job/weekly");
    const params = within(dialog).getByLabelText("Params (JSON)");
    fireEvent.change(params, { target: { value: '{"THREADS": 4}' } });
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(backendClientMock.createLeonidPipelineParam).toHaveBeenCalledWith(TOKEN, {
      name: "weekly",
      job_path: "job/weekly",
      params: { THREADS: 4 },
    });
  });

  it("blocks submit when params is not valid JSON", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PipelineConfigsPanel />);
    await screen.findByText("nightly");

    await user.click(screen.getByRole("button", { name: "Add pipeline config" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "broken");
    await user.type(within(dialog).getByLabelText("Job path"), "job/broken");
    const params = within(dialog).getByLabelText("Params (JSON)");
    fireEvent.change(params, { target: { value: "nope" } });

    expect(within(dialog).getByText("Params must be valid JSON")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
    expect(backendClientMock.createLeonidPipelineParam).not.toHaveBeenCalled();
  });

  it("deletes a pipeline config after confirmation", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PipelineConfigsPanel />);
    await screen.findByText("nightly");

    await user.click(screen.getByRole("button", { name: "Delete pipeline config nightly" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    expect(backendClientMock.deleteLeonidPipelineParam).toHaveBeenCalledWith(TOKEN, 7);
  });

  it("shows an error alert when the list request fails", async () => {
    backendClientMock.listLeonidPipelineParams.mockRejectedValue(new Error("boom"));
    renderWithProviders(<PipelineConfigsPanel />);
    expect(await screen.findByText("Leonid pipeline configs failed")).toBeInTheDocument();
  });
});
