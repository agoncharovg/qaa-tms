import { agentClient } from "@/api/agentClient";
import { backendClient } from "@/api/backendClient";
import type { JenkinsNode } from "@/api/types";
import { QueryKey } from "@/constants";
import { useCachedJenkinsResource } from "@/plugins/jenkins/useCachedJenkinsResource";
import { useJenkinsScope } from "@/plugins/jenkins/useJenkinsScope";

interface UseSmokeFolderOptions {
  agentPort: number | null;
  enabled: boolean;
  folderPath: string;
  refreshMs: number;
  token: string | null;
}

interface UseSmokeFolderResult {
  error: unknown;
  isLoading: boolean;
  isRefreshing: boolean;
  refetch: () => Promise<void>;
  roots: JenkinsNode[];
}

export function useSmokeFolder({
  agentPort,
  enabled,
  folderPath,
  refreshMs,
  token,
}: UseSmokeFolderOptions): UseSmokeFolderResult {
  const scopeQuery = useJenkinsScope(token, enabled);

  const signature = scopeQuery.data?.signature ?? null;
  const ttlSeconds = Math.round(refreshMs / 1000);

  const cachedFolder = useCachedJenkinsResource<JenkinsNode>({
    enabled: Boolean(enabled && token && signature),
    fetchLive: async () => {
      if (!signature || !token || agentPort === null) {
        return null;
      }
      const response = await agentClient.getJenkinsFolder(agentPort, token, folderPath);
      return response.roots;
    },
    queryKey: [QueryKey.JENKINS_FOLDER_CACHE, token, signature, folderPath],
    readCache: async (signal) => {
      const response = await backendClient.getJenkinsFolderCache(
        token ?? "",
        signature ?? "",
        folderPath,
        ttlSeconds,
        signal
      );
      return {
        data: response.roots,
        fetchedAt: response.fetchedAt,
        refreshLease: response.refreshLease,
        stale: response.stale,
      };
    },
    refetchInterval: enabled ? refreshMs : false,
    staleTime: refreshMs,
    writeCache: (roots, refreshLease) => {
      if (!signature || !token) {
        return Promise.resolve(undefined);
      }
      return backendClient.putJenkinsFolderCache(token, {
        path: folderPath,
        refreshLease,
        roots,
        signature,
      });
    },
  });

  return {
    error: scopeQuery.error ?? cachedFolder.error,
    isLoading: scopeQuery.isLoading || cachedFolder.isLoading,
    isRefreshing: cachedFolder.isRefreshing,
    refetch: cachedFolder.refetch,
    roots: cachedFolder.data,
  };
}
