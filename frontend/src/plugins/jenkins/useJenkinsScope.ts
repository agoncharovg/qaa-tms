import { useQuery } from "@tanstack/react-query";

import { backendClient } from "@/api/backendClient";
import { QueryKey } from "@/constants";

export function useJenkinsScope(token: string | null, enabled: boolean) {
  return useQuery({
    enabled: Boolean(enabled && token),
    queryFn: ({ signal }) => backendClient.getJenkinsScope(token ?? "", signal),
    queryKey: [QueryKey.JENKINS_SCOPE, token],
    refetchOnWindowFocus: false,
    retry: false,
  });
}
