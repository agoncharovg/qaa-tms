import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";

const chatPanelSpy = vi.hoisted(() => vi.fn());

vi.mock("@/core/llm/ChatPanel", () => ({
  ChatPanel: (props: { agentPort: number }) => {
    chatPanelSpy(props);
    return <div>assistant chat</div>;
  },
}));

vi.mock("@/plugins/companion/CompanionGate", () => ({
  CompanionGate: ({
    children,
  }: {
    children: (args: { agentPort: number }) => ReactNode;
  }) => <>{children({ agentPort: 47600 })}</>,
}));

import { AssistantSection } from "@/plugins/assistant/AssistantSection";
import { renderWithProviders } from "@/test/render";
import { resetAuthStoreState, useAuthStore } from "@/store/authStore";

describe("AssistantSection", () => {
  it("renders the shared chat panel through the companion gate", () => {
    resetAuthStoreState();
    useAuthStore.setState({ token: "token-123" });

    renderWithProviders(<AssistantSection />);

    expect(screen.getByText("assistant chat")).toBeInTheDocument();
    expect(chatPanelSpy).toHaveBeenCalledWith({ agentPort: 47600 });
  });
});
