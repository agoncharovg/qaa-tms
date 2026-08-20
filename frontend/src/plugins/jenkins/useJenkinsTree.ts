import { agentClient } from "@/api/agentClient";
import { backendClient } from "@/api/backendClient";
import type { JenkinsNode, JenkinsRootGroup } from "@/api/types";
import { DEFAULT_JENKINS_TREE_REFETCH_MS, QueryKey } from "@/constants";
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
  refetch: () => Promise<void>;
  rootFolders: string[];
  rootGroups: JenkinsRootGroup[];
  roots: JenkinsNode[];
  signature: string | null;
}

export function useJenkinsTree({
  agentPort,
  enabled,
  isActive,
  token,
}: UseJenkinsTreeOptions): UseJenkinsTreeResult {
  const scopeQuery = useJenkinsScope(token, enabled);

  const signature = scopeQuery.data?.signature ?? null;

  const cachedTree = useCachedJenkinsResource<JenkinsNode>({
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
    refetchInterval: isActive ? DEFAULT_JENKINS_TREE_REFETCH_MS : false,
    staleTime: DEFAULT_JENKINS_TREE_REFETCH_MS,
    writeCache: (roots, refreshLease) => {
      if (!signature || !token) {
        return Promise.resolve(undefined);
      }
      return backendClient.putJenkinsTreeCache(token, { refreshLease, roots, signature });
    },
  });

  return {
    error: scopeQuery.error ?? cachedTree.error,
    fetchedAt: cachedTree.fetchedAt,
    historyLimit: scopeQuery.data?.historyLimit ?? null,
    isLoading: scopeQuery.isLoading || cachedTree.isLoading,
    isRefreshing: cachedTree.isRefreshing,
    refetch: cachedTree.refetch,
    rootFolders: scopeQuery.data?.rootFolders ?? [],
    rootGroups: scopeQuery.data?.rootGroups ?? [],
    roots: cachedTree.data,
    signature,
  };
}
