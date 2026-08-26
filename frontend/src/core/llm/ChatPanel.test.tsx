import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const agentClientMock = vi.hoisted(() => ({
  getLlmModels: vi.fn(),
  streamLlmChat: vi.fn(),
}));

vi.mock("@/api/agentClient", () => ({
  agentClient: agentClientMock,
}));

import { ChatPanel } from "@/core/llm/ChatPanel";
import { renderWithProviders } from "@/test/render";
import { resetAuthStoreState, useAuthStore } from "@/store/authStore";

describe("ChatPanel", () => {
  beforeEach(() => {
    agentClientMock.getLlmModels.mockReset();
    agentClientMock.streamLlmChat.mockReset();
    resetAuthStoreState();
    useAuthStore.setState({ token: "token-123" });
  });

  it("streams assistant text and usage into the shared chat UI", async () => {
    const user = userEvent.setup();

    agentClientMock.getLlmModels.mockResolvedValue([
      {
        label: "Claude Sonnet",
        modelId: "claude-sonnet-4",
        params: { max_tokens: 1024 },
        provider: "anthropic",
      },
    ]);
    agentClientMock.streamLlmChat.mockImplementation(
      (
        _port: number,
        _token: string,
        body: {
          messages: Array<{ content: string; role: string }>;
          model: string;
          seedContext?: { context?: string | null };
        },
        onMessage: (message: {
          data: Record<string, unknown>;
          event: string;
        }) => void
      ) => {
        expect(body.model).toBe("Claude Sonnet");
        expect(body.seedContext).toEqual({ context: "team/dev" });
        expect(body.messages).toEqual([{ content: "Explain the issue", role: "user" }]);
        onMessage({
          data: { delta: "Assistant reply" },
          event: "text_delta",
        });
        onMessage({
          data: { inputTokens: 12, outputTokens: 18, totalTokens: 30 },
          event: "usage",
        });
        onMessage({
          data: { done: true },
          event: "done",
        });
        return Promise.resolve();
      }
    );

    renderWithProviders(<ChatPanel agentPort={47600} seedContext={{ context: "team/dev" }} />);

    expect(await screen.findByText("context: team/dev")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Message"), "Explain the issue");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("Assistant reply")).toBeInTheDocument();
    expect(screen.getByText("Usage: input 12, output 18, total 30")).toBeInTheDocument();
  });

  it("shows provider errors emitted over the SSE stream", async () => {
    const user = userEvent.setup();

    agentClientMock.getLlmModels.mockResolvedValue([
      {
        label: "Codex",
        modelId: "gpt-5",
        params: {},
        provider: "openai",
      },
    ]);
    agentClientMock.streamLlmChat.mockImplementation(
      (
        _port: number,
        _token: string,
        _body: unknown,
        onMessage: (message: {
          data: Record<string, unknown>;
          event: string;
        }) => void
      ) => {
        onMessage({
          data: { message: "Upstream rejected the request." },
          event: "error",
        });
        return Promise.resolve();
      }
    );

    renderWithProviders(<ChatPanel agentPort={47600} />);

    await user.type(await screen.findByLabelText("Message"), "Hello");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(screen.getByText("Upstream rejected the request.")).toBeInTheDocument();
    });
  });
});
