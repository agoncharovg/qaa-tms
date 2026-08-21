import { useCallback, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

interface CachedResourceRead<TItem> {
  data: TItem[];
  fetchedAt: string | null;
  refreshLease: string | null;
  stale: boolean;
}

interface UseCachedJenkinsResourceOptions<TItem> {
  canFetchLive: boolean;
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
  stale: boolean;
}

/**
 * Read-through cache with single-flight refresh lease, shared by every Jenkins
 * surface backed by the shared backend cache: read the shared backend snapshot,
 * let the backend fill stale leases server-side, and optionally use the agent
 * as a personal fast-path when it is already available.
 */
export function useCachedJenkinsResource<TItem>({
  canFetchLive,
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
  const lastAttemptKeyRef = useRef<string | null>(null);

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
        return false;
      }
      await writeCache(data, refreshLease);
      return true;
    },
    onSuccess: async (didWrite, lease) => {
      if (!didWrite) {
        return;
      }
      if (lease) {
        attemptedLeaseRef.current = lease;
      }
      await queryClient.invalidateQueries({ queryKey });
    },
  });

  const stale = cacheQuery.data?.stale ?? false;
  const refreshLease = cacheQuery.data?.refreshLease ?? null;

  useEffect(() => {
    if (!stale || !refreshLease) {
      attemptedLeaseRef.current = null;
      lastAttemptKeyRef.current = null;
      return;
    }
    if (attemptedLeaseRef.current === refreshLease) {
      return;
    }

    const attemptKey = `${refreshLease}:${canFetchLive ? "ready" : "blocked"}`;
    if (lastAttemptKeyRef.current === attemptKey) {
      return;
    }

    lastAttemptKeyRef.current = attemptKey;
    refreshMutation.mutate(refreshLease);
  }, [canFetchLive, refreshLease, refreshMutation, stale]);

  // Stable identity so callers can depend on it in effects without re-running
  // every render. Forces a fresh agent fetch, bypassing the stale cache.
  const refetch = useCallback(async () => {
    await refreshMutation.mutateAsync(null);
  }, [refreshMutation]);

  return {
    data: cacheQuery.data?.data ?? [],
    error:
      cacheQuery.error ?? ((cacheQuery.data?.data.length ?? 0) > 0 ? null : refreshMutation.error),
    fetchedAt: cacheQuery.data?.fetchedAt ?? null,
    isLoading: cacheQuery.isLoading,
    isRefreshing: cacheQuery.isFetching || refreshMutation.isPending,
    refetch,
    stale,
  };
}

