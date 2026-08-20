import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { agentClient, discoverAgent, requestAgentUpdate } from "@/api/agentClient";
import { backendClient } from "@/api/backendClient";
import type { AgentManifest, AgentPingResponse } from "@/api/types";
import { CompanionStatusKind, QueryKey, type CompanionStatusKind as CompanionStatusKindType } from "@/constants";
import { useAuthStore } from "@/store/authStore";
import { compareVersions } from "@/utils/compareVersions";

const UPDATE_POLL_INTERVAL_MS = 1000 as const;
const UPDATE_TIMEOUT_MS = 30000 as const;

type CompanionStateBase = {
  agent: AgentPingResponse | null;
  error: Error | null;
  isUpdating: boolean;
  manifest: AgentManifest | null;
  port: number | null;
  refresh: () => Promise<void>;
  retryLabel: string;
  update: () => Promise<void>;
  updateError: Error | null;
};

type CompanionState = CompanionStateBase & {
  kind: CompanionStatusKindType;
};

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
}

async function waitForUpdatedVersion(port: number, currentVersion: string): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < UPDATE_TIMEOUT_MS) {
    try {
      const nextPing = await agentClient.getPing(port);
      if (nextPing.version !== currentVersion) {
        return;
      }
    } catch {
      // The service can be briefly unavailable while the supervisor restarts it.
    }
    await sleep(UPDATE_POLL_INTERVAL_MS);
  }

  throw new Error("The companion did not report a new version before the update timeout.");
}

export function useCompanionStatus({ enabled = true }: { enabled?: boolean } = {}): CompanionState {
  const queryClient = useQueryClient();
  const token = useAuthStore((state) => state.token);

  const manifestQuery = useQuery({
    enabled,
    queryFn: ({ signal }) => backendClient.getAgentManifest(signal),
    queryKey: [QueryKey.AGENT_MANIFEST],
    refetchOnWindowFocus: false,
    retry: false,
  });

  const discoveryQuery = useQuery({
    enabled,
    queryFn: ({ signal }) => discoverAgent(signal),
    queryKey: [QueryKey.AGENT_DISCOVERY, token],
    refetchOnWindowFocus: false,
    retry: false,
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!token || !discoveryQuery.data) {
        throw new Error("Authentication is required.");
      }

      await requestAgentUpdate(discoveryQuery.data.port, token);
      await waitForUpdatedVersion(discoveryQuery.data.port, discoveryQuery.data.agent.version);
    },
    onSuccess: async () => {
      await Promise.all([
        discoveryQuery.refetch(),
        queryClient.invalidateQueries({ queryKey: [QueryKey.AGENT_DISCOVERY] }),
        queryClient.invalidateQueries({ queryKey: [QueryKey.AGENT_SETTINGS] }),
        queryClient.invalidateQueries({ queryKey: [QueryKey.AGENT_PREFLIGHT] }),
      ]);
    },
  });

  const refresh = async () => {
    await Promise.all([manifestQuery.refetch(), discoveryQuery.refetch()]);
  };

  if (!enabled || manifestQuery.isLoading || discoveryQuery.isLoading) {
    return {
      agent: null,
      error: null,
      isUpdating: updateMutation.isPending,
      kind: CompanionStatusKind.LOADING,
      manifest: null,
      port: null,
      refresh,
      retryLabel: "Retry",
      update: async () => {
        await updateMutation.mutateAsync();
      },
      updateError: updateMutation.error instanceof Error ? updateMutation.error : null,
    };
  }

  const manifestError = manifestQuery.error instanceof Error ? manifestQuery.error : null;
  const discoveryError = discoveryQuery.error instanceof Error ? discoveryQuery.error : null;
  if (manifestError || discoveryError || !manifestQuery.data) {
    return {
      agent: discoveryQuery.data?.agent ?? null,
      error: manifestError ?? discoveryError ?? new Error("Companion status failed to load."),
      isUpdating: updateMutation.isPending,
      kind: CompanionStatusKind.ERROR,
      manifest: manifestQuery.data ?? null,
      port: discoveryQuery.data?.port ?? null,
      refresh,
      retryLabel: "Retry",
      update: async () => {
        await updateMutation.mutateAsync();
      },
      updateError: updateMutation.error instanceof Error ? updateMutation.error : null,
    };
  }

  if (!discoveryQuery.data) {
    return {
      agent: null,
      error: null,
      isUpdating: updateMutation.isPending,
      kind: CompanionStatusKind.NOT_INSTALLED,
      manifest: manifestQuery.data,
      port: null,
      refresh,
      retryLabel: "Retry",
      update: async () => {
        await updateMutation.mutateAsync();
      },
      updateError: updateMutation.error instanceof Error ? updateMutation.error : null,
    };
  }

  const currentVersion = discoveryQuery.data.agent.version;
  const manifest = manifestQuery.data;
  if (compareVersions(currentVersion, manifest.minSupported) < 0) {
    return {
      agent: discoveryQuery.data.agent,
      error: null,
      isUpdating: updateMutation.isPending,
      kind: CompanionStatusKind.UPDATE_REQUIRED,
      manifest,
      port: discoveryQuery.data.port,
      refresh,
      retryLabel: "Retry",
      update: async () => {
        await updateMutation.mutateAsync();
      },
      updateError: updateMutation.error instanceof Error ? updateMutation.error : null,
    };
  }

  if (compareVersions(currentVersion, manifest.version) < 0) {
    return {
      agent: discoveryQuery.data.agent,
      error: null,
      isUpdating: updateMutation.isPending,
      kind: CompanionStatusKind.UPDATE_AVAILABLE,
      manifest,
      port: discoveryQuery.data.port,
      refresh,
      retryLabel: "Retry",
      update: async () => {
        await updateMutation.mutateAsync();
      },
      updateError: updateMutation.error instanceof Error ? updateMutation.error : null,
    };
  }

  return {
    agent: discoveryQuery.data.agent,
    error: null,
    isUpdating: updateMutation.isPending,
    kind: CompanionStatusKind.OK,
    manifest,
    port: discoveryQuery.data.port,
    refresh,
    retryLabel: "Retry",
    update: async () => {
      await updateMutation.mutateAsync();
    },
    updateError: updateMutation.error instanceof Error ? updateMutation.error : null,
  };
}
