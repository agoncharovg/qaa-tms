import { agentClient } from "@/api/agentClient";
import { backendClient } from "@/api/backendClient";
import type { JenkinsBuild } from "@/api/types";
import { DEFAULT_JENKINS_BUILDS_REFETCH_MS, QueryKey } from "@/constants";
import { useCachedJenkinsResource } from "@/plugins/jenkins/useCachedJenkinsResource";

interface UseJenkinsBuildsOptions {
  agentPort: number | null;
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

export function useJenkinsBuilds({
  agentPort,
  enabled,
  path,
  signature,
  token,
}: UseJenkinsBuildsOptions): UseJenkinsBuildsResult {
  const cachedBuilds = useCachedJenkinsResource<JenkinsBuild>({
    canFetchLive: Boolean(enabled && token && signature && agentPort !== null),
    enabled: Boolean(enabled && token && signature),
    fetchLive: async () => {
      if (!signature || !token || agentPort === null) {
        return null;
      }
      const response = await agentClient.getJenkinsBuilds(agentPort, token, path);
      return response.builds;
    },
    queryKey: [QueryKey.JENKINS_BUILDS, token, signature, path],
    readCache: async (signal) => {
      const response = await backendClient.getJenkinsBuildsCache(
        token ?? "",
        signature ?? "",
        path,
        signal
      );
      return {
        data: response.builds,
        fetchedAt: response.fetchedAt,
        refreshLease: response.refreshLease,
        stale: response.stale,
      };
    },
    refetchInterval: enabled ? DEFAULT_JENKINS_BUILDS_REFETCH_MS : false,
    staleTime: DEFAULT_JENKINS_BUILDS_REFETCH_MS,
    writeCache: (builds, refreshLease) => {
      if (!signature || !token) {
        return Promise.resolve(undefined);
      }
      return backendClient.putJenkinsBuildsCache(token, { builds, path, refreshLease, signature });
    },
  });

  return {
    builds: cachedBuilds.data,
    error: cachedBuilds.error,
    fetchedAt: cachedBuilds.fetchedAt,
    isLoading: cachedBuilds.isLoading,
    isRefreshing: cachedBuilds.isRefreshing,
    refetch: cachedBuilds.refetch,
  };
}

