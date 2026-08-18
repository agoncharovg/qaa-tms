import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { agentClient } from "@/api/agentClient";
import { backendClient } from "@/api/backendClient";
import type { JenkinsFreezeRead, JenkinsResumeRunRead } from "@/api/types";
import {
  DEFAULT_JENKINS_TREE_REFETCH_MS,
  JENKINS_RESUME_RUN_REFETCH_MS,
  JenkinsFreezeStatus,
  JenkinsResumeRunStatus,
  QueryKey,
} from "@/constants";

const SNAPSHOT_PUT_MAX_ATTEMPTS = 3;

async function putSnapshotWithRetry(
  token: string,
  freezeId: string,
  body: Parameters<typeof backendClient.putJenkinsFreezeSnapshot>[2]
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= SNAPSHOT_PUT_MAX_ATTEMPTS; attempt += 1) {
    try {
      await backendClient.putJenkinsFreezeSnapshot(token, freezeId, body);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

const FreezeErrorMessage = {
  AUTH: "Authentication is required.",
  SIGNATURE: "Jenkins scope is unavailable.",
} as const;

interface FreezeFolderArgs {
  folderName: string;
  folderPath: string;
  killBuilds: boolean;
  mergeFreezeIds: string[];
  reason: string;
}

interface UseJenkinsFreezesOptions {
  agentPort: number;
  enabled: boolean;
  isActive: boolean;
  signature: string | null;
  token: string | null;
}

interface UseJenkinsFreezesResult {
  absorbableActiveFreezes: (path: string) => JenkinsFreezeRead[];
  activeFreezeForPath: (path: string) => JenkinsFreezeRead | null;
  activeFreezes: JenkinsFreezeRead[];
  activeResumeRun: JenkinsResumeRunRead | null;
  cancelResumeRun: () => Promise<void>;
  closeResumeRunSummary: () => void;
  coveringActiveFreezes: (path: string) => JenkinsFreezeRead[];
  error: unknown;
  freezeFolder: (args: FreezeFolderArgs) => Promise<void>;
  freezesByFolderPath: Map<string, JenkinsFreezeRead>;
  intersectingActiveFreezes: (path: string) => JenkinsFreezeRead[];
  isLoading: boolean;
  isLocked: boolean;
  isMutatingPath: (path: string) => boolean;
  startResumeCampaign: (freeze: JenkinsFreezeRead) => Promise<void>;
  visibleResumeRun: JenkinsResumeRunRead | null;
}

export function useJenkinsFreezes({
  agentPort,
  enabled,
  isActive,
  signature,
  token,
}: UseJenkinsFreezesOptions): UseJenkinsFreezesResult {
  const queryClient = useQueryClient();
  const freezesQueryKey = [QueryKey.JENKINS_FREEZES, token, signature];
  const resumeRunListQueryKey = [QueryKey.JENKINS_RESUME_RUN, "list", token, signature];
  const [trackedResumeRunId, setTrackedResumeRunId] = useState<string | null>(null);

  const freezesQuery = useQuery({
    enabled: Boolean(enabled && token && signature),
    queryFn: ({ signal }) =>
      backendClient.getJenkinsFreezes(
        token ?? "",
        signature ?? "",
        JenkinsFreezeStatus.ACTIVE,
        signal
      ),
    queryKey: freezesQueryKey,
    refetchInterval: isActive ? DEFAULT_JENKINS_TREE_REFETCH_MS : false,
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: DEFAULT_JENKINS_TREE_REFETCH_MS,
  });

  const resumeRunQuery = useQuery({
    enabled: Boolean(enabled && token && signature),
    queryFn: ({ signal }) =>
      backendClient.getJenkinsResumeRuns(
        token ?? "",
        signature ?? "",
        JenkinsResumeRunStatus.RUNNING,
        signal
      ),
    queryKey: resumeRunListQueryKey,
    refetchInterval: isActive ? JENKINS_RESUME_RUN_REFETCH_MS : false,
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: 0,
  });

  const activeResumeRun = (resumeRunQuery.data ?? [])[0] ?? null;

  useEffect(() => {
    if (!activeResumeRun) {
      return;
    }
    setTrackedResumeRunId(activeResumeRun.id);
  }, [activeResumeRun]);

  const trackedResumeRunQuery = useQuery({
    enabled: Boolean(enabled && token && trackedResumeRunId),
    queryFn: ({ signal }) =>
      backendClient.getJenkinsResumeRun(token ?? "", trackedResumeRunId ?? "", signal),
    queryKey: [QueryKey.JENKINS_RESUME_RUN, "detail", token, trackedResumeRunId],
    refetchInterval: (query) => {
      const run = query.state.data;
      return isActive && run?.status === JenkinsResumeRunStatus.RUNNING
        ? JENKINS_RESUME_RUN_REFETCH_MS
        : false;
    },
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: 0,
  });

  const freezeMutation = useMutation({
    mutationFn: async ({
      folderName,
      folderPath,
      killBuilds,
      mergeFreezeIds,
      reason,
    }: FreezeFolderArgs) => {
      if (!token) {
        throw new Error(FreezeErrorMessage.AUTH);
      }
      if (!signature) {
        throw new Error(FreezeErrorMessage.SIGNATURE);
      }

      const reservedFreeze = await backendClient.createJenkinsFreeze(token, {
        folderName,
        folderPath,
        killBuilds,
        reason,
        signature,
      });

      let snapshotResponse;
      try {
        snapshotResponse = await agentClient.freezeJenkinsFolder(agentPort, token, {
          folderPath,
          killBuilds,
        });
      } catch (error) {
        try {
          await backendClient.deleteJenkinsFreeze(token, reservedFreeze.id);
        } catch {
          // Preserve the original agent failure.
        }
        throw error;
      }

      await putSnapshotWithRetry(token, reservedFreeze.id, {
        mergeFreezeIds,
        snapshot: snapshotResponse.snapshot,
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: freezesQueryKey }),
        queryClient.invalidateQueries({ queryKey: [QueryKey.JENKINS_TREE_CACHE] }),
      ]);
    },
  });

  const startResumeCampaignMutation = useMutation({
    mutationFn: async (freeze: JenkinsFreezeRead) => {
      if (!token) {
        throw new Error(FreezeErrorMessage.AUTH);
      }

      const run = await backendClient.createJenkinsResumeRun(token, { freezeId: freeze.id });
      try {
        if (run.status === JenkinsResumeRunStatus.RUNNING) {
          await agentClient.startJenkinsResumeRun(agentPort, token, {
            runId: run.id,
            snapshot: freeze.snapshot,
          });
        }
      } catch (error) {
        try {
          if (run.status === JenkinsResumeRunStatus.RUNNING) {
            await backendClient.cancelJenkinsResumeRun(token, run.id);
          }
        } catch {
          // Preserve the original agent failure.
        }
        throw error;
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: freezesQueryKey }),
        queryClient.invalidateQueries({ queryKey: resumeRunListQueryKey }),
        queryClient.invalidateQueries({ queryKey: [QueryKey.JENKINS_TREE_CACHE] }),
      ]);
    },
  });

  const cancelResumeRunMutation = useMutation({
    mutationFn: async (runId: string) => {
      if (!token) {
        throw new Error(FreezeErrorMessage.AUTH);
      }
      await backendClient.cancelJenkinsResumeRun(token, runId);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: resumeRunListQueryKey }),
        queryClient.invalidateQueries({ queryKey: freezesQueryKey }),
        queryClient.invalidateQueries({ queryKey: [QueryKey.JENKINS_TREE_CACHE] }),
      ]);
    },
  });

  const activeFreezes = (freezesQuery.data ?? []).filter((freeze) => freeze.applied);
  const freezesByFolderPath = new Map<string, JenkinsFreezeRead>();
  for (const freeze of activeFreezes) {
    if (!freezesByFolderPath.has(freeze.folderPath)) {
      freezesByFolderPath.set(freeze.folderPath, freeze);
    }
  }

  const visibleResumeRun = activeResumeRun ?? trackedResumeRunQuery.data ?? null;
  const isLocked = activeResumeRun !== null;

  function coveringActiveFreezes(path: string): JenkinsFreezeRead[] {
    return activeFreezes.filter(
      (freeze) => freeze.folderPath === path || path.startsWith(`${freeze.folderPath}/`)
    );
  }

  function activeFreezeForPath(path: string): JenkinsFreezeRead | null {
    const exactFreeze = freezesByFolderPath.get(path);
    if (exactFreeze) {
      return exactFreeze;
    }

    const coveringFreezes = coveringActiveFreezes(path);
    if (coveringFreezes.length === 0) {
      return null;
    }

    return (
      coveringFreezes.sort((left, right) => right.folderPath.length - left.folderPath.length)[0] ??
      null
    );
  }

  function intersectingActiveFreezes(path: string): JenkinsFreezeRead[] {
    return activeFreezes.filter(
      (freeze) =>
        freeze.folderPath === path ||
        freeze.folderPath.startsWith(`${path}/`) ||
        path.startsWith(`${freeze.folderPath}/`)
    );
  }

  function absorbableActiveFreezes(path: string): JenkinsFreezeRead[] {
    return activeFreezes.filter(
      (freeze) => freeze.folderPath === path || freeze.folderPath.startsWith(`${path}/`)
    );
  }

  function isMutatingPath(path: string): boolean {
    return (
      (freezeMutation.isPending && freezeMutation.variables?.folderPath === path) ||
      (startResumeCampaignMutation.isPending &&
        startResumeCampaignMutation.variables?.folderPath === path)
    );
  }

  return {
    absorbableActiveFreezes,
    activeFreezeForPath,
    activeFreezes,
    activeResumeRun,
    cancelResumeRun: async () => {
      if (activeResumeRun) {
        await cancelResumeRunMutation.mutateAsync(activeResumeRun.id);
      }
    },
    closeResumeRunSummary: () => {
      setTrackedResumeRunId(null);
    },
    coveringActiveFreezes,
    error:
      freezesQuery.error ??
      freezeMutation.error ??
      startResumeCampaignMutation.error ??
      cancelResumeRunMutation.error ??
      resumeRunQuery.error ??
      trackedResumeRunQuery.error,
    freezeFolder: freezeMutation.mutateAsync,
    freezesByFolderPath,
    intersectingActiveFreezes,
    isLoading: freezesQuery.isLoading || resumeRunQuery.isLoading,
    isLocked,
    isMutatingPath,
    startResumeCampaign: async (freeze) => {
      await startResumeCampaignMutation.mutateAsync(freeze);
    },
    visibleResumeRun,
  };
}
