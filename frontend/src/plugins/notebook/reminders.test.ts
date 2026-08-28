import { describe, expect, it } from "vitest";
import {
  clearReminderFlags,
  defaultReminderValue,
  dismissReminderFlags,
  isReminderDue,
  setReminderFlags,
} from "@/plugins/notebook/reminders";
describe("reminder helpers", () => {
  it("treats the exact reminder time as due", () => {
    const reminder = {
      bookmark: "Research",
      name: "note-1",
      previewLines: [],
      remindAt: "2026-09-01T18:00",
    };
    expect(isReminderDue(reminder, new Date("2026-09-01T18:00"))).toBe(true);
    expect(isReminderDue(reminder, new Date("2026-09-01T17:59"))).toBe(false);
  });
  it("re-arms a reminder by dropping remindDismissedAt", () => {
    expect(setReminderFlags({ keep: true, remindDismissedAt: "2026-09-01T18:05" }, "2026-09-02T09:30")).toEqual({
      keep: true,
      remindAt: "2026-09-02T09:30",
    });
  });
  it("defaults reminders to the next upcoming 09:00", () => {
    expect(defaultReminderValue(new Date("2026-09-01T07:15"))).toBe("2026-09-01T09:00");
    expect(defaultReminderValue(new Date("2026-09-01T09:00"))).toBe("2026-09-02T09:00");
    expect(defaultReminderValue(new Date("2026-09-01T14:30"))).toBe("2026-09-02T09:00");
  });
  it("clears both reminder keys", () => {
    expect(clearReminderFlags({
      keep: true,
      remindAt: "2026-09-02T09:30",
      remindDismissedAt: "2026-09-02T10:00",
    })).toEqual({ keep: true });
  });
  it("dismisses while keeping remindAt", () => {
    expect(dismissReminderFlags({ keep: true, remindAt: "2026-09-02T09:30" }, "2026-09-02T10:00")).toEqual({
      keep: true,
      remindAt: "2026-09-02T09:30",
      remindDismissedAt: "2026-09-02T10:00",
    });
  });
});
