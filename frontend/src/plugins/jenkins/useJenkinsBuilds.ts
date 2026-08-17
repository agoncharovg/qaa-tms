import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { agentClient } from "@/api/agentClient";
import { backendClient } from "@/api/backendClient";
import type { JenkinsBuild } from "@/api/types";
import { DEFAULT_JENKINS_BUILDS_REFETCH_MS, QueryKey } from "@/constants";

interface UseJenkinsBuildsOptions {
  agentPort: number;
  enabled: boolean;
  path: string;
  signature: string | null;
  token: string | null;
}

interface UseJenkinsBuildsResult {
  builds: JenkinsBuild[];
  error: unknown;
  fetchedAt: string | null;
  isLoading: boolean;
  isRefreshing: boolean;
  refetch: () => Promise<void>;
}

interface RefreshBuildsPayload {
  refreshLease: string | null;
}

export function useJenkinsBuilds({
  agentPort,
  enabled,
  path,
  signature,
  token,
}: UseJenkinsBuildsOptions): UseJenkinsBuildsResult {
  const queryClient = useQueryClient();
  const attemptedLeaseRef = useRef<string | null>(null);
  const cacheQueryKey = [QueryKey.JENKINS_BUILDS, token, signature, path];

  const cacheQuery = useQuery({
    enabled: Boolean(enabled && token && signature),
    queryFn: ({ signal }) =>
      backendClient.getJenkinsBuildsCache(token ?? "", signature ?? "", path, signal),
    queryKey: cacheQueryKey,
    refetchInterval: enabled ? DEFAULT_JENKINS_BUILDS_REFETCH_MS : false,
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: DEFAULT_JENKINS_BUILDS_REFETCH_MS,
  });

  const refreshMutation = useMutation({
    mutationFn: async ({ refreshLease }: RefreshBuildsPayload) => {
      if (!signature || !token) {
        return;
      }

      const response = await agentClient.getJenkinsBuilds(agentPort, token, path);
      await backendClient.putJenkinsBuildsCache(token, {
        builds: response.builds,
        path,
        refreshLease,
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
    builds: cacheQuery.data?.builds ?? [],
    error:
      cacheQuery.error ?? ((cacheQuery.data?.builds.length ?? 0) > 0 ? null : refreshMutation.error),
    fetchedAt: cacheQuery.data?.fetchedAt ?? null,
    isLoading: cacheQuery.isLoading,
    isRefreshing: cacheQuery.isFetching || refreshMutation.isPending,
    async refetch() {
      await refreshMutation.mutateAsync({ refreshLease: null });
    },
  };
}
