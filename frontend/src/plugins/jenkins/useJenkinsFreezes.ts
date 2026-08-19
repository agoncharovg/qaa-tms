import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { agentClient } from "@/api/agentClient";
import { backendClient } from "@/api/backendClient";
import type { JenkinsFreezeRead, JenkinsFreezeSnapshotItem, JenkinsResumeRunRead } from "@/api/types";
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

interface StartResumeCampaignArgs {
  folderPath: string;
  freeze: JenkinsFreezeRead;
  restartPipelines: boolean;
  snapshot: JenkinsFreezeSnapshotItem[];
}

function normalizeJenkinsPath(path: string): string {
  return decodeURIComponent(path).replace(/^\/+|\/+$/g, "");
}

function isSameOrNestedPath(path: string, prefix: string): boolean {
  const normalizedPath = normalizeJenkinsPath(path);
  const normalizedPrefix = normalizeJenkinsPath(prefix);
  return normalizedPath === normalizedPrefix || normalizedPath.startsWith(`${normalizedPrefix}/`);
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
  startResumeCampaign: (
    freeze: JenkinsFreezeRead,
    snapshot: JenkinsFreezeSnapshotItem[],
    restartPipelines?: boolean,
    folderPath?: string
  ) => Promise<void>;
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
  const freezesQueryKey = useMemo(() => [QueryKey.JENKINS_FREEZES, token, signature], [signature, token]);
  const resumeRunListQueryKey = useMemo(
    () => [QueryKey.JENKINS_RESUME_RUN, "list", token, signature],
    [signature, token]
  );
  const treeCacheQueryKey = useMemo(() => [QueryKey.JENKINS_TREE_CACHE], []);
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

  const trackedResumeRunQueryKey = useMemo(
    () => [QueryKey.JENKINS_RESUME_RUN, "detail", token, trackedResumeRunId],
    [token, trackedResumeRunId]
  );
  const trackedResumeRunQuery = useQuery({
    enabled: Boolean(enabled && token && trackedResumeRunId),
    queryFn: ({ signal }) =>
      backendClient.getJenkinsResumeRun(token ?? "", trackedResumeRunId ?? "", signal),
    queryKey: trackedResumeRunQueryKey,
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
    mutationFn: async ({ folderPath, freeze, restartPipelines, snapshot }: StartResumeCampaignArgs) => {
      if (!token) {
        throw new Error(FreezeErrorMessage.AUTH);
      }

      const run = await backendClient.createJenkinsResumeRun(token, {
        freezeId: freeze.id,
        restartPipelines,
        folderPath,
      });
      try {
        if (run.status === JenkinsResumeRunStatus.RUNNING) {
          await agentClient.startJenkinsResumeRun(agentPort, token, {
            runId: run.id,
            snapshot,
            restartPipelines,
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
      return run;
    },
    onSuccess: async (run) => {
      setTrackedResumeRunId(run.id);
      queryClient.setQueryData([QueryKey.JENKINS_RESUME_RUN, "detail", token, run.id], run);
      if (run.status === JenkinsResumeRunStatus.RUNNING) {
        queryClient.setQueryData<JenkinsResumeRunRead[]>(resumeRunListQueryKey, (current) => [
          run,
          ...(current ?? []).filter((candidate) => candidate.id !== run.id),
        ]);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: freezesQueryKey }),
        queryClient.invalidateQueries({ queryKey: resumeRunListQueryKey }),
        queryClient.invalidateQueries({ queryKey: treeCacheQueryKey }),
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

  const activeFreezes = useMemo(
    () => (freezesQuery.data ?? []).filter((freeze) => freeze.applied),
    [freezesQuery.data]
  );
  const freezesByFolderPath = useMemo(() => {
    const nextMap = new Map<string, JenkinsFreezeRead>();
    for (const freeze of activeFreezes) {
      const normalizedPath = normalizeJenkinsPath(freeze.folderPath);
      if (!nextMap.has(normalizedPath)) {
        nextMap.set(normalizedPath, freeze);
      }
    }
    return nextMap;
  }, [activeFreezes]);

  const visibleResumeRun = activeResumeRun ?? trackedResumeRunQuery.data ?? null;
  const isLocked = activeResumeRun !== null;
  const completedTrackedResumeRunId =
    trackedResumeRunQuery.data && trackedResumeRunQuery.data.status !== JenkinsResumeRunStatus.RUNNING
      ? trackedResumeRunQuery.data.id
      : null;

  useEffect(() => {
    if (!completedTrackedResumeRunId) {
      return;
    }
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: freezesQueryKey }),
      queryClient.invalidateQueries({ queryKey: resumeRunListQueryKey }),
      queryClient.invalidateQueries({ queryKey: treeCacheQueryKey }),
    ]);
  }, [completedTrackedResumeRunId, freezesQueryKey, queryClient, resumeRunListQueryKey, treeCacheQueryKey]);

  const coveringActiveFreezes = useCallback(
    (path: string): JenkinsFreezeRead[] =>
      activeFreezes.filter((freeze) => isSameOrNestedPath(path, freeze.folderPath)),
    [activeFreezes]
  );

  const activeFreezeForPath = useCallback(
    (path: string): JenkinsFreezeRead | null => {
      const exactFreeze = freezesByFolderPath.get(normalizeJenkinsPath(path));
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
    },
    [coveringActiveFreezes, freezesByFolderPath]
  );

  const intersectingActiveFreezes = useCallback(
    (path: string): JenkinsFreezeRead[] =>
      activeFreezes.filter(
        (freeze) =>
          isSameOrNestedPath(freeze.folderPath, path) || isSameOrNestedPath(path, freeze.folderPath)
      ),
    [activeFreezes]
  );

  const absorbableActiveFreezes = useCallback(
    (path: string): JenkinsFreezeRead[] =>
      activeFreezes.filter((freeze) => isSameOrNestedPath(freeze.folderPath, path)),
    [activeFreezes]
  );

  const isMutatingPath = useCallback(
    (path: string): boolean =>
      (freezeMutation.isPending && isSameOrNestedPath(freezeMutation.variables?.folderPath ?? "", path)) ||
      (startResumeCampaignMutation.isPending &&
        isSameOrNestedPath(startResumeCampaignMutation.variables?.folderPath ?? "", path)),
    [
      freezeMutation.isPending,
      freezeMutation.variables?.folderPath,
      startResumeCampaignMutation.isPending,
      startResumeCampaignMutation.variables?.folderPath,
    ]
  );

  const cancelResumeRun = useCallback(async () => {
    if (activeResumeRun) {
      await cancelResumeRunMutation.mutateAsync(activeResumeRun.id);
    }
  }, [activeResumeRun, cancelResumeRunMutation]);

  const closeResumeRunSummary = useCallback(() => {
    setTrackedResumeRunId(null);
  }, []);

  const freezeFolder = useCallback(
    async (args: FreezeFolderArgs) => {
      await freezeMutation.mutateAsync(args);
    },
    [freezeMutation]
  );

  const startResumeCampaign = useCallback(
    async (
      freeze: JenkinsFreezeRead,
      snapshot: JenkinsFreezeSnapshotItem[],
      restartPipelines = true,
      folderPath = freeze.folderPath
    ) => {
      await startResumeCampaignMutation.mutateAsync({
        folderPath,
        freeze,
        restartPipelines,
        snapshot,
      });
    },
    [startResumeCampaignMutation]
  );

  return {
    absorbableActiveFreezes,
    activeFreezeForPath,
    activeFreezes,
    activeResumeRun,
    cancelResumeRun,
    closeResumeRunSummary,
    coveringActiveFreezes,
    error:
      freezesQuery.error ??
      freezeMutation.error ??
      startResumeCampaignMutation.error ??
      cancelResumeRunMutation.error ??
      resumeRunQuery.error ??
      trackedResumeRunQuery.error,
    freezeFolder,
    freezesByFolderPath,
    intersectingActiveFreezes,
    isLoading: freezesQuery.isLoading || resumeRunQuery.isLoading,
    isLocked,
    isMutatingPath,
    startResumeCampaign,
    visibleResumeRun,
  };
}
