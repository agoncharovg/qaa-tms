import { useCallback, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

interface CachedResourceRead<TItem> {
  data: TItem[];
  fetchedAt: string | null;
  refreshLease: string | null;
  stale: boolean;
}

interface UseCachedJenkinsResourceOptions<TItem> {
  enabled: boolean;
  fetchLive: () => Promise<TItem[] | null>;
  queryKey: unknown[];
  readCache: (signal?: AbortSignal) => Promise<CachedResourceRead<TItem>>;
  refetchInterval: number | false;
  staleTime: number;
  writeCache: (data: TItem[], refreshLease: string | null) => Promise<unknown>;
}

interface UseCachedJenkinsResourceResult<TItem> {
  data: TItem[];
  error: unknown;
  fetchedAt: string | null;
  isLoading: boolean;
  isRefreshing: boolean;
  refetch: () => Promise<void>;
}

/**
 * Read-through cache with single-flight refresh lease, shared by every Jenkins
 * surface backed by the agent-fetch/backend-cache pattern: read the shared
 * backend snapshot, and when it reports itself stale and hands back a lease,
 * fetch live via the agent and PUT the result back before the next read.
 */
export function useCachedJenkinsResource<TItem>({
  enabled,
  fetchLive,
  queryKey,
  readCache,
  refetchInterval,
  staleTime,
  writeCache,
}: UseCachedJenkinsResourceOptions<TItem>): UseCachedJenkinsResourceResult<TItem> {
  const queryClient = useQueryClient();
  const attemptedLeaseRef = useRef<string | null>(null);

  const cacheQuery = useQuery({
    enabled,
    queryFn: ({ signal }) => readCache(signal),
    queryKey,
    refetchInterval,
    refetchOnWindowFocus: false,
    retry: false,
    staleTime,
  });

  const refreshMutation = useMutation({
    mutationFn: async (refreshLease: string | null) => {
      const data = await fetchLive();
      if (data === null) {
        return;
      }
      await writeCache(data, refreshLease);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey });
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
    refreshMutation.mutate(refreshLease);
  }, [refreshLease, refreshMutation, stale]);

  // Stable identity so callers can depend on it in effects without re-running
  // every render. Forces a fresh agent fetch, bypassing the stale cache.
  const refetch = useCallback(async () => {
    await refreshMutation.mutateAsync(null);
  }, [refreshMutation.mutateAsync]);

  return {
    data: cacheQuery.data?.data ?? [],
    error:
      cacheQuery.error ?? ((cacheQuery.data?.data.length ?? 0) > 0 ? null : refreshMutation.error),
    fetchedAt: cacheQuery.data?.fetchedAt ?? null,
    isLoading: cacheQuery.isLoading,
    isRefreshing: cacheQuery.isFetching || refreshMutation.isPending,
    refetch,
  };
}
