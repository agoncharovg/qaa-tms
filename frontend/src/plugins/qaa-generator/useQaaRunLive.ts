import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { qaaAgentClient } from "@/api/qaaAgentClient";
import { useAuthStore } from "@/store/authStore";
import { useQaaGeneratorStore } from "@/plugins/qaa-generator/qaaStore";
import { isTerminalQaaRunStatus } from "@/plugins/qaa-generator/runState";
import { DEFAULT_JOB_POLL_INTERVAL_MS, QueryKey } from "@/constants";

const QAA_LIVE_COPY = {
  RUN_REQUIRED: "A QAA run is required.",
  STREAM_FAILED: "Live QAA run stream failed.",
  TOKEN_REQUIRED: "Set your personal qaa-generator token in Profile / Settings.",
} as const;

const QAA_STREAM_RECONNECT_DELAY_MS = 1000;

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const onAbort = () => {
      clearTimeout(timeout);
      resolve();
    };
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function invalidateQaaRunQueries(queryClient: ReturnType<typeof useQueryClient>): Promise<unknown> {
  return queryClient.invalidateQueries({
    queryKey: [QueryKey.QAA_RUNS],
  });
}

export function useQaaRunLive(agentPort: number, hasPersonalToken: boolean) {
  const queryClient = useQueryClient();
  const token = useAuthStore((state) => state.token);
  const clearLiveRun = useQaaGeneratorStore((state) => state.clearLiveRun);
  const liveRun = useQaaGeneratorStore((state) => state.liveRun);
  const reduceLiveRun = useQaaGeneratorStore((state) => state.reduceLiveRun);
  const startRun = useQaaGeneratorStore((state) => state.startRun);
  const streamAbortControllerRef = useRef<AbortController | null>(null);
  const lastEventIdRef = useRef<string | null>(null);
  const logViewportRef = useRef<HTMLDivElement | null>(null);
  const currentRunStatus = liveRun?.run?.status;
  const isRunTerminal = currentRunStatus ? isTerminalQaaRunStatus(currentRunStatus) : false;
  // Read the latest terminal status from inside the long-lived reconnect loop
  // without making it an effect dependency (which would tear the stream down).
  const isRunTerminalRef = useRef(isRunTerminal);
  isRunTerminalRef.current = isRunTerminal;

  const runQuery = useQuery({
    enabled: Boolean(token && liveRun?.runId && hasPersonalToken),
    queryFn: ({ signal }) => qaaAgentClient.getQaaRun(agentPort, token ?? "", liveRun?.runId ?? "", signal),
    queryKey: [QueryKey.QAA_RUN_DETAIL, agentPort, token, liveRun?.runId],
    refetchInterval: (query) => {
      const nextStatus = query.state.data?.status ?? liveRun?.run?.status;
      return nextStatus && isTerminalQaaRunStatus(nextStatus)
        ? false
        : DEFAULT_JOB_POLL_INTERVAL_MS;
    },
  });

  useEffect(() => {
    if (!runQuery.data) {
      return;
    }

    reduceLiveRun({
      run: runQuery.data,
      type: "hydrate-run",
    });

    if (isTerminalQaaRunStatus(runQuery.data.status)) {
      void invalidateQaaRunQueries(queryClient);
    }
  }, [queryClient, reduceLiveRun, runQuery.data]);

  useEffect(() => {
    const runId = liveRun?.runId;
    if (!token || !runId || !hasPersonalToken) {
      return;
    }

    const controller = new AbortController();
    streamAbortControllerRef.current?.abort();
    streamAbortControllerRef.current = controller;
    lastEventIdRef.current = null;

    // The qaa-generator stream delivers events up to the current tip and then
    // closes rather than staying open indefinitely, so a single connection would
    // freeze the log at whatever stage was live when it connected. Reconnect —
    // resuming via Last-Event-ID — until the run reaches a terminal status. Dedup
    // in the reducer makes any events replayed across reconnects harmless.
    const runStream = async (): Promise<void> => {
      while (!controller.signal.aborted && !isRunTerminalRef.current) {
        try {
          await qaaAgentClient.streamQaaRun(
            agentPort,
            token,
            runId,
            (event, eventId) => {
              if (eventId) {
                lastEventIdRef.current = eventId;
              }
              reduceLiveRun({ event, type: "append-event" });
              reduceLiveRun({ type: "clear-stream-error" });
            },
            controller.signal,
            lastEventIdRef.current
          );
        } catch (error: unknown) {
          if (controller.signal.aborted) {
            return;
          }
          reduceLiveRun({
            message: error instanceof Error ? error.message : QAA_LIVE_COPY.STREAM_FAILED,
            type: "set-stream-error",
          });
        }

        if (controller.signal.aborted || isRunTerminalRef.current) {
          return;
        }
        await delay(QAA_STREAM_RECONNECT_DELAY_MS, controller.signal);
      }
    };

    void runStream();

    return () => {
      controller.abort();
      if (streamAbortControllerRef.current === controller) {
        streamAbortControllerRef.current = null;
      }
    };
  }, [agentPort, hasPersonalToken, liveRun?.runId, reduceLiveRun, token]);

  useEffect(() => {
    if (logViewportRef.current) {
      logViewportRef.current.scrollTop = logViewportRef.current.scrollHeight;
    }
  }, [liveRun?.events.length]);

  useEffect(() => {
    return () => {
      streamAbortControllerRef.current?.abort();
    };
  }, []);

  const pauseMutation = useMutation({
    mutationFn: async () => {
      if (!token || !liveRun) {
        throw new Error(QAA_LIVE_COPY.RUN_REQUIRED);
      }
      if (!hasPersonalToken) {
        throw new Error(QAA_LIVE_COPY.TOKEN_REQUIRED);
      }

      return qaaAgentClient.pauseQaaRun(agentPort, token, liveRun.runId);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: [QueryKey.QAA_RUN_DETAIL, agentPort, token, liveRun?.runId],
      });
      await invalidateQaaRunQueries(queryClient);
    },
  });

  const resumeMutation = useMutation({
    mutationFn: async () => {
      if (!token || !liveRun) {
        throw new Error(QAA_LIVE_COPY.RUN_REQUIRED);
      }
      if (!hasPersonalToken) {
        throw new Error(QAA_LIVE_COPY.TOKEN_REQUIRED);
      }

      return qaaAgentClient.resumeQaaRun(agentPort, token, liveRun.runId);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: [QueryKey.QAA_RUN_DETAIL, agentPort, token, liveRun?.runId],
      });
      await invalidateQaaRunQueries(queryClient);
    },
  });

  const stopMutation = useMutation({
    mutationFn: async () => {
      if (!token || !liveRun) {
        throw new Error(QAA_LIVE_COPY.RUN_REQUIRED);
      }
      if (!hasPersonalToken) {
        throw new Error(QAA_LIVE_COPY.TOKEN_REQUIRED);
      }

      return qaaAgentClient.stopQaaRun(agentPort, token, liveRun.runId);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: [QueryKey.QAA_RUN_DETAIL, agentPort, token, liveRun?.runId],
      });
      await invalidateQaaRunQueries(queryClient);
    },
  });

  return {
    clearLiveRun,
    isRunTerminal,
    liveRun,
    logViewportRef,
    pauseMutation,
    resumeMutation,
    runQuery,
    startRun,
    stopMutation,
  };
}
