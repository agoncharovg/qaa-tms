import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const agentClientMock = vi.hoisted(() => ({
  createLeonidPipelineParam: vi.fn(),
  deleteLeonidPipelineParam: vi.fn(),
  listLeonidPipelineParams: vi.fn(),
  updateLeonidPipelineParam: vi.fn(),
}));

vi.mock("@/api/agentClient", () => ({ agentClient: agentClientMock }));

import { PipelineConfigsPanel } from "@/plugins/leonid/PipelineConfigsPanel";
import { resetAuthStoreState, useAuthStore } from "@/store/authStore";
import { renderWithProviders } from "@/test/render";

const PORT = 47600;
const TOKEN = "test-token";

describe("PipelineConfigsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAuthStoreState();
    useAuthStore.setState({ token: TOKEN });
    agentClientMock.listLeonidPipelineParams.mockResolvedValue([
      { id: 7, name: "nightly", job_path: "job/nightly", params: ["--smoke"] },
    ]);
    agentClientMock.createLeonidPipelineParam.mockResolvedValue({});
    agentClientMock.deleteLeonidPipelineParam.mockResolvedValue(undefined);
  });

  it("renders pipeline configs from the agent", async () => {
    renderWithProviders(<PipelineConfigsPanel agentPort={PORT} />);
    expect(await screen.findByText("nightly")).toBeInTheDocument();
    expect(screen.getByText("job/nightly")).toBeInTheDocument();
  });

  it("creates a pipeline config with parsed params", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PipelineConfigsPanel agentPort={PORT} />);
    await screen.findByText("nightly");

    await user.click(screen.getByRole("button", { name: "Add pipeline config" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "weekly");
    await user.type(within(dialog).getByLabelText("Job path"), "job/weekly");
    const params = within(dialog).getByLabelText("Params (JSON)");
    fireEvent.change(params, { target: { value: '{"THREADS": 4}' } });
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(agentClientMock.createLeonidPipelineParam).toHaveBeenCalledWith(PORT, TOKEN, {
      name: "weekly",
      job_path: "job/weekly",
      params: { THREADS: 4 },
    });
  });

  it("blocks submit when params is not valid JSON", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PipelineConfigsPanel agentPort={PORT} />);
    await screen.findByText("nightly");

    await user.click(screen.getByRole("button", { name: "Add pipeline config" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "broken");
    await user.type(within(dialog).getByLabelText("Job path"), "job/broken");
    const params = within(dialog).getByLabelText("Params (JSON)");
    fireEvent.change(params, { target: { value: "nope" } });

    expect(within(dialog).getByText("Params must be valid JSON")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
    expect(agentClientMock.createLeonidPipelineParam).not.toHaveBeenCalled();
  });

  it("deletes a pipeline config after confirmation", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PipelineConfigsPanel agentPort={PORT} />);
    await screen.findByText("nightly");

    await user.click(screen.getByRole("button", { name: "Delete pipeline config nightly" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    expect(agentClientMock.deleteLeonidPipelineParam).toHaveBeenCalledWith(PORT, TOKEN, 7);
  });

  it("shows an error alert when the list request fails", async () => {
    agentClientMock.listLeonidPipelineParams.mockRejectedValue(new Error("boom"));
    renderWithProviders(<PipelineConfigsPanel agentPort={PORT} />);
    expect(await screen.findByText("Leonid pipeline configs failed")).toBeInTheDocument();
  });
});
