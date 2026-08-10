import type { JobRead, JobTerminalEvent } from "@/api/types";
import { JobStatus, TERMINAL_JOB_STATUSES, type JobStatus as JobStatusType } from "@/constants";

export interface LiveJobState {
  jobId: string;
  opId: string;
  status: JobStatusType;
  exitCode: number | null;
  argv: string[];
  lines: string[];
  createdAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  cancelRequested: boolean;
  streamError: string | null;
}

export type LiveJobAction =
  | { type: "append-line"; line: string }
  | { type: "hydrate"; job: JobRead }
  | { type: "request-cancel" }
  | { type: "set-stream-error"; message: string }
  | { type: "terminal"; terminal: JobTerminalEvent };

export function createLiveJobState(jobId: string, opId: string): LiveJobState {
  return {
    argv: [],
    cancelRequested: false,
    createdAt: null,
    exitCode: null,
    finishedAt: null,
    jobId,
    lines: [],
    opId,
    startedAt: null,
    status: JobStatus.QUEUED,
    streamError: null,
  };
}

export function isTerminalJobStatus(status: JobStatusType): boolean {
  return TERMINAL_JOB_STATUSES.some((terminalStatus) => terminalStatus === status);
}

export function reduceLiveJobState(state: LiveJobState, action: LiveJobAction): LiveJobState {
  switch (action.type) {
    case "append-line":
      return {
        ...state,
        lines: [...state.lines, action.line],
      };
    case "hydrate":
      return {
        ...state,
        argv: action.job.argv,
        createdAt: action.job.createdAt,
        exitCode: action.job.exitCode,
        finishedAt: action.job.finishedAt,
        startedAt: action.job.startedAt,
        status: action.job.status,
      };
    case "request-cancel":
      return {
        ...state,
        cancelRequested: true,
      };
    case "set-stream-error":
      return {
        ...state,
        streamError: action.message,
      };
    case "terminal":
      return {
        ...state,
        exitCode: action.terminal.exitCode,
        finishedAt: state.finishedAt,
        status: action.terminal.status,
        streamError: null,
      };
  }
}
