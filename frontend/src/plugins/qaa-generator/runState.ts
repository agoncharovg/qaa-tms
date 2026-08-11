import type { QaaRunEvent, QaaRunRead } from "@/api/types";
import {
  TERMINAL_QAA_RUN_STATUSES,
  type QaaRunStatus,
} from "@/constants";

export interface QaaLiveRunState {
  events: QaaRunEvent[];
  run: QaaRunRead | null;
  runId: string;
  streamError: string | null;
}

export type QaaLiveRunAction =
  | { type: "append-event"; event: QaaRunEvent }
  | { type: "hydrate-run"; run: QaaRunRead }
  | { type: "set-stream-error"; message: string }
  | { type: "clear-stream-error" };

export function createQaaLiveRunState(runId: string): QaaLiveRunState {
  return {
    events: [],
    run: null,
    runId,
    streamError: null,
  };
}

export function isTerminalQaaRunStatus(status: QaaRunStatus): boolean {
  return TERMINAL_QAA_RUN_STATUSES.has(status);
}

export function reduceQaaLiveRunState(
  state: QaaLiveRunState,
  action: QaaLiveRunAction
): QaaLiveRunState {
  switch (action.type) {
    case "append-event":
      return {
        ...state,
        events: [...state.events, action.event],
      };
    case "hydrate-run":
      return {
        ...state,
        run: action.run,
        runId: action.run.run_id,
      };
    case "set-stream-error":
      return {
        ...state,
        streamError: action.message,
      };
    case "clear-stream-error":
      return {
        ...state,
        streamError: null,
      };
  }
}
