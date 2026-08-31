import { useEffect, useRef, useState } from "react";

import { agentClient } from "@/api/agentClient";
import { backendClient } from "@/api/backendClient";
import type { JenkinsNode, JenkinsRootGroup } from "@/api/types";
import {
  DEFAULT_JENKINS_TREE_REFETCH_MS,
  DEFAULT_JENKINS_TREE_WARMING_REFETCH_MS,
  DEFAULT_JENKINS_TREE_WARMING_WINDOW_MS,
  QueryKey,
} from "@/constants";
import { useCachedJenkinsResource } from "@/plugins/jenkins/useCachedJenkinsResource";
import { useJenkinsScope } from "@/plugins/jenkins/useJenkinsScope";

interface UseJenkinsTreeOptions {
  agentPort: number | null;
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
  isWarming: boolean;
  refetch: () => Promise<void>;
  rootFolders: string[];
  rootGroups: JenkinsRootGroup[];
  roots: JenkinsNode[];
  signature: string | null;
  stale: boolean;
}

export function useJenkinsTree({
  agentPort,
  enabled,
  isActive,
  token,
}: UseJenkinsTreeOptions): UseJenkinsTreeResult {
  const scopeQuery = useJenkinsScope(token, enabled);

  const signature = scopeQuery.data?.signature ?? null;

  // A cold/stale cache with no rows is expected to be filled server-side by the
  // backend common token (briefs/26) via a background task we cannot observe.
  // Open a bounded warming window on the first cold read so we poll the backend
  // cache quickly (picking the fill up in seconds instead of a full 15-minute
  // refetch) and surface a "warming" state before falling back to the companion
  // prompt when nothing fills it.
  const [isWarming, setIsWarming] = useState(false);

  const cachedTree = useCachedJenkinsResource<JenkinsNode>({
    canFetchLive: Boolean(signature && token && agentPort !== null),
    enabled: Boolean(enabled && token && signature),
    fetchLive: async () => {
      if (!signature || !token || agentPort === null) {
        return null;
      }
      const response = await agentClient.getJenkinsTree(agentPort, token);
      return response.roots;
    },
    queryKey: [QueryKey.JENKINS_TREE_CACHE, token, signature],
    readCache: async (signal) => {
      const response = await backendClient.getJenkinsTreeCache(
        token ?? "",
        signature ?? "",
        signal
      );
      return {
        data: response.roots,
        fetchedAt: response.fetchedAt,
        refreshLease: response.refreshLease,
        stale: response.stale,
      };
    },
    refetchInterval: isActive
      ? isWarming
        ? DEFAULT_JENKINS_TREE_WARMING_REFETCH_MS
        : DEFAULT_JENKINS_TREE_REFETCH_MS
      : false,
    staleTime: DEFAULT_JENKINS_TREE_REFETCH_MS,
    writeCache: (roots, refreshLease) => {
      if (!signature || !token) {
        return Promise.resolve(undefined);
      }
      return backendClient.putJenkinsTreeCache(token, { refreshLease, roots, signature });
    },
  });

  const isCold = cachedTree.stale && cachedTree.data.length === 0;
  const wasColdRef = useRef(false);
  useEffect(() => {
    if (!isCold) {
      wasColdRef.current = false;
      setIsWarming(false);
      return undefined;
    }
    if (wasColdRef.current) {
      return undefined;
    }
    // First cold read of this episode: open the warming window, then close it so
    // the panel can fall back to the companion prompt if the fill never lands.
    wasColdRef.current = true;
    setIsWarming(true);
    const timer = setTimeout(() => setIsWarming(false), DEFAULT_JENKINS_TREE_WARMING_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [isCold]);

  return {
    error: scopeQuery.error ?? cachedTree.error,
    fetchedAt: cachedTree.fetchedAt,
    historyLimit: scopeQuery.data?.historyLimit ?? null,
    isLoading: scopeQuery.isLoading || cachedTree.isLoading,
    isRefreshing: cachedTree.isRefreshing,
    isWarming: isWarming && isCold,
    refetch: cachedTree.refetch,
    rootFolders: scopeQuery.data?.rootFolders ?? [],
    rootGroups: scopeQuery.data?.rootGroups ?? [],
    roots: cachedTree.data,
    signature,
    stale: cachedTree.stale,
  };
}

