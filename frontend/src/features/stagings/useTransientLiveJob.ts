import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { agentClient } from "@/api/agentClient";
import { DEFAULT_JOB_POLL_INTERVAL_MS, JobStreamEvent, QueryKey } from "@/constants";
import {
  createLiveJobState,
  isTerminalJobStatus,
  reduceLiveJobState,
  type LiveJobAction,
  type LiveJobState,
} from "@/features/stagings/liveJobState";

export function useTransientLiveJob(agentPort: number | null, token: string | null) {
  const queryClient = useQueryClient();
  const [liveJob, setLiveJob] = useState<LiveJobState | null>(null);
  const streamAbortControllerRef = useRef<AbortController | null>(null);
  const currentJobStatusRef = useRef(liveJob?.status);
  const logViewportRef = useRef<HTMLDivElement | null>(null);
  const isJobRunning = liveJob ? !isTerminalJobStatus(liveJob.status) : false;

  function reduceLiveJob(action: LiveJobAction): void {
    setLiveJob((currentJob) => (currentJob ? reduceLiveJobState(currentJob, action) : currentJob));
  }

  function startLiveJob(jobId: string, opId: string): void {
    setLiveJob(createLiveJobState(jobId, opId));
  }

  function clearLiveJob(): void {
    streamAbortControllerRef.current?.abort();
    streamAbortControllerRef.current = null;
    setLiveJob(null);
  }

  const jobQuery = useQuery({
    enabled: Boolean(token && agentPort !== null && liveJob?.jobId),
    queryFn: ({ signal }) => agentClient.getJob(agentPort ?? 0, token ?? "", liveJob?.jobId ?? "", signal),
    queryKey: [QueryKey.AGENT_JOB, agentPort, liveJob?.jobId],
    refetchInterval: (query) => {
      const status = query.state.data?.status ?? liveJob?.status;
      return status && isTerminalJobStatus(status) ? false : DEFAULT_JOB_POLL_INTERVAL_MS;
    },
  });

  useEffect(() => {
    if (jobQuery.data) {
      reduceLiveJob({
        job: jobQuery.data,
        type: "hydrate",
      });

      if (isTerminalJobStatus(jobQuery.data.status)) {
        void queryClient.invalidateQueries({
          queryKey: [QueryKey.OPERATIONS],
        });
      }
    }
  }, [jobQuery.data, queryClient]);

  useEffect(() => {
    currentJobStatusRef.current = liveJob?.status;
  }, [liveJob?.status]);

  useEffect(() => {
    const jobId = liveJob?.jobId;
    const currentStatus = currentJobStatusRef.current;
    if (!token || agentPort === null || !jobId || !currentStatus || isTerminalJobStatus(currentStatus)) {
      return;
    }

    const controller = new AbortController();
    streamAbortControllerRef.current?.abort();
    streamAbortControllerRef.current = controller;

    void agentClient
      .streamJob(
        agentPort,
        token,
        jobId,
        (message) => {
          if (message.event === JobStreamEvent.LOG) {
            reduceLiveJob({
              line: message.data.line,
              type: "append-line",
            });
            return;
          }

          reduceLiveJob({
            terminal: message.data,
            type: "terminal",
          });
          void queryClient.invalidateQueries({
            queryKey: [QueryKey.OPERATIONS],
          });
        },
        controller.signal
      )
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        reduceLiveJob({
          message: error instanceof Error ? error.message : "Live log stream failed.",
          type: "set-stream-error",
        });
      });

    return () => {
      controller.abort();
      if (streamAbortControllerRef.current === controller) {
        streamAbortControllerRef.current = null;
      }
    };
  }, [agentPort, liveJob?.jobId, queryClient, token]);

  useEffect(() => {
    if (liveJob && isTerminalJobStatus(liveJob.status)) {
      streamAbortControllerRef.current?.abort();
    }
  }, [liveJob]);

  useEffect(() => {
    if (logViewportRef.current) {
      logViewportRef.current.scrollTop = logViewportRef.current.scrollHeight;
    }
  }, [liveJob?.lines.length]);

  useEffect(() => {
    return () => {
      streamAbortControllerRef.current?.abort();
    };
  }, []);

  const cancelMutation = useMutation({
    mutationFn: async () => {
      if (!token || agentPort === null || !liveJob) {
        throw new Error("No running job is available.");
      }

      return agentClient.cancelJob(agentPort, token, liveJob.jobId);
    },
    onMutate: () => {
      reduceLiveJob({
        type: "request-cancel",
      });
      streamAbortControllerRef.current?.abort();
    },
    onSuccess: (job) => {
      reduceLiveJob({
        job,
        type: "hydrate",
      });
    },
  });

  return {
    cancelMutation,
    clearLiveJob,
    isJobRunning,
    jobQuery,
    liveJob,
    logViewportRef,
    reduceLiveJob,
    startLiveJob,
  };
}
