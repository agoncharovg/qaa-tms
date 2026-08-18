import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { agentClient } from "@/api/agentClient";
import { backendClient } from "@/api/backendClient";
import type { JenkinsNode } from "@/api/types";
import { DEFAULT_JENKINS_TREE_REFETCH_MS, QueryKey } from "@/constants";

interface UseJenkinsTreeOptions {
  agentPort: number;
  enabled: boolean;
  isActive: boolean;
  token: string | null;
}

interface UseJenkinsTreeResult {
  error: unknown;
  fetchedAt: string | null;
  historyLimit: number | null;
  isLoading: boolean;
  isRefreshing: boolean;
  refetch: () => Promise<void>;
  roots: JenkinsNode[];
  signature: string | null;
}

interface RefreshTreePayload {
  refreshLease: string | null;
}

export function useJenkinsTree({
  agentPort,
  enabled,
  isActive,
  token,
}: UseJenkinsTreeOptions): UseJenkinsTreeResult {
  const queryClient = useQueryClient();
  const attemptedLeaseRef = useRef<string | null>(null);

  const scopeQuery = useQuery({
    enabled: Boolean(enabled && token),
    queryFn: ({ signal }) => agentClient.getJenkinsScope(agentPort, token ?? "", signal),
    queryKey: [QueryKey.JENKINS_SCOPE, agentPort, token],
    refetchOnWindowFocus: false,
    retry: false,
  });

  const signature = scopeQuery.data?.signature ?? null;
  const cacheQueryKey = [QueryKey.JENKINS_TREE_CACHE, token, signature];
  const cacheQuery = useQuery({
    enabled: Boolean(enabled && token && signature),
    queryFn: ({ signal }) => backendClient.getJenkinsTreeCache(token ?? "", signature ?? "", signal),
    queryKey: cacheQueryKey,
    refetchInterval: isActive ? DEFAULT_JENKINS_TREE_REFETCH_MS : false,
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: DEFAULT_JENKINS_TREE_REFETCH_MS,
  });

  const refreshMutation = useMutation({
    mutationFn: async ({ refreshLease }: RefreshTreePayload) => {
      if (!signature || !token) {
        return;
      }

      const response = await agentClient.getJenkinsTree(agentPort, token);
      await backendClient.putJenkinsTreeCache(token, {
        refreshLease,
        roots: response.roots,
        signature,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: cacheQueryKey });
    },
  });

  const stale = cacheQuery.data?.stale ?? false;
  const refreshLease = cacheQuery.data?.refreshLease ?? null;

  useEffect(() => {
    if (!stale || !refreshLease) {
      attemptedLeaseRef.current = null;
      return;
    }
    if (attemptedLeaseRef.current === refreshLease) {
      return;
    }

    attemptedLeaseRef.current = refreshLease;
    refreshMutation.mutate({ refreshLease });
  }, [refreshLease, refreshMutation, stale]);

  return {
    error:
      scopeQuery.error ??
      cacheQuery.error ??
      ((cacheQuery.data?.roots.length ?? 0) > 0 ? null : refreshMutation.error),
    fetchedAt: cacheQuery.data?.fetchedAt ?? null,
    historyLimit: scopeQuery.data?.historyLimit ?? null,
    isLoading: scopeQuery.isLoading || cacheQuery.isLoading,
    isRefreshing: cacheQuery.isFetching || refreshMutation.isPending,
    async refetch() {
      await refreshMutation.mutateAsync({ refreshLease: null });
    },
    roots: cacheQuery.data?.roots ?? [],
    signature,
  };
}
