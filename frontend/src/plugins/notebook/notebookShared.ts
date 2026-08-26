import { useQuery } from "@tanstack/react-query";

import { AgentRequestError, getPreflight } from "@/api/agentClient";
import { QueryKey } from "@/constants";
import { useAuthStore } from "@/store/authStore";

export type NotebookNotice = {
  message: string;
  status: "error" | "success";
};

export function useNotebookAgent() {
  const token = useAuthStore((state) => state.token);
  const preflightQuery = useQuery({
    enabled: Boolean(token),
    queryFn: ({ signal }) => getPreflight(token ?? "", signal),
    queryKey: [QueryKey.AGENT_PREFLIGHT, token],
    refetchOnWindowFocus: false,
    retry: false,
  });

  const agentPort = preflightQuery.data?.detected ? preflightQuery.data.port : null;
  const probedPorts =
    preflightQuery.data && !preflightQuery.data.detected ? preflightQuery.data.ports.join(", ") : "";

  return {
    agentPort,
    companionUnavailable: !preflightQuery.data?.detected,
    preflightQuery,
    probedPorts,
    token,
  };
}

export function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof AgentRequestError) {
    return error.message;
  }

  return error instanceof Error ? error.message : fallback;
}

export function buildPreviewText(lines: string[]): string {
  return lines.length > 0 ? lines.join("\n") : "Empty note.";
}
