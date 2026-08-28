import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { agentClient } from "@/api/agentClient";
import type { NotebookReminder } from "@/api/types";
import { QueryKey } from "@/constants";
import { useNotebookAgent } from "@/plugins/notebook/notebookShared";
const REMINDER_POLL_MS = 60_000;
const REMINDER_TICK_MS = 30_000;
type NotebookFlags = Record<string, unknown>;
export function parseLocalReminder(remindAt: string): Date {
  // Datetime-local strings without a timezone are parsed as local time in JS.
  return new Date(remindAt);
}
export function formatReminder(remindAt: string): string {
  const parsed = parseLocalReminder(remindAt);
  if (Number.isNaN(parsed.getTime())) {
    return remindAt;
  }
  return parsed.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
export function formatReminderValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("-") + "T" + [pad(date.getHours()), pad(date.getMinutes())].join(":");
}
export function defaultReminderValue(now: Date = new Date()): string {
  const target = new Date(now);
  target.setSeconds(0, 0);
  if (target.getHours() >= 9) {
    target.setDate(target.getDate() + 1);
  }
  target.setHours(9, 0, 0, 0);
  return formatReminderValue(target);
}
export function getReminderFlagValue(flags: NotebookFlags | null | undefined): string | null {
  const remindAt = flags?.remindAt;
  return typeof remindAt === "string" && remindAt.trim().length > 0 ? remindAt : null;
}
export function hasActiveReminder(flags: NotebookFlags | null | undefined): boolean {
  return getReminderFlagValue(flags) !== null && !(flags && "remindDismissedAt" in flags);
}
export function isReminderDue(reminder: NotebookReminder, now: Date): boolean {
  const parsed = parseLocalReminder(reminder.remindAt);
  return !Number.isNaN(parsed.getTime()) && parsed.getTime() <= now.getTime();
}
export function setReminderFlags(flags: NotebookFlags | null | undefined, remindAt: string): NotebookFlags {
  const next = { ...(flags ?? {}) };
  next.remindAt = remindAt;
  delete next.remindDismissedAt;
  return next;
}
export function clearReminderFlags(flags: NotebookFlags | null | undefined): NotebookFlags {
  const next = { ...(flags ?? {}) };
  delete next.remindAt;
  delete next.remindDismissedAt;
  return next;
}
export function dismissReminderFlags(
  flags: NotebookFlags | null | undefined,
  dismissedAt: string
): NotebookFlags {
  const next = { ...(flags ?? {}) };
  next.remindDismissedAt = dismissedAt;
  return next;
}
export function useNotebookReminders(enabled = true) {
  const { agentPort, token } = useNotebookAgent(enabled);
  const [now, setNow] = useState(() => new Date());
  const query = useQuery({
    enabled: enabled && Boolean(token && agentPort !== null),
    queryFn: ({ signal }) => agentClient.getNotebookReminders(agentPort ?? 0, token ?? "", signal),
    queryKey: [QueryKey.NOTEBOOK_REMINDERS, token, agentPort],
    refetchInterval: REMINDER_POLL_MS,
    refetchOnWindowFocus: true,
    retry: false,
  });
  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    const intervalId = window.setInterval(() => {
      setNow(new Date());
    }, REMINDER_TICK_MS);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [enabled]);
  const reminders = query.data?.reminders ?? [];
  const dueReminders = reminders.filter((reminder) => isReminderDue(reminder, now));
  let nextFutureAt: Date | null = null;
  for (const reminder of reminders) {
    const parsed = parseLocalReminder(reminder.remindAt);
    if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= now.getTime()) {
      continue;
    }
    if (nextFutureAt === null || parsed.getTime() < nextFutureAt.getTime()) {
      nextFutureAt = parsed;
    }
  }
  useEffect(() => {
    if (!enabled || nextFutureAt === null) {
      return undefined;
    }
    const timeoutId = window.setTimeout(() => {
      setNow(new Date());
    }, Math.max(0, nextFutureAt.getTime() - Date.now()));
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [enabled, nextFutureAt]);
  return {
    ...query,
    agentPort,
    dueReminders,
    nextFutureAt,
    now,
    reminders,
    token,
  };
}
