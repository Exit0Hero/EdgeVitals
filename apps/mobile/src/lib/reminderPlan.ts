/**
 * Which reminder notifications to schedule. Pure and deterministic so it can
 * be tested; `src/lib/reminders.ts` hands the result to the OS.
 *
 * Reminders are one-off local notifications for the next `days` days, at the
 * user's morning and evening times in the device's current time zone. A scan
 * already done today has no reminder, and a time that has passed is skipped.
 * Rescheduling on every app open keeps this in step with travel, schedule
 * changes and completed scans.
 */
export type ReminderKind = 'morning' | 'evening';

export interface PlannedReminder {
  kind: ReminderKind;
  at: Date;
}

export interface ReminderInput {
  now: Date;
  morning: string; // HH:MM
  evening: string; // HH:MM
  enabled: boolean;
  doneToday: { morning: boolean; evening: boolean };
  days?: number;
}

/** iOS allows 64 pending local notifications per app; stay far below. */
export const MAX_REMINDER_DAYS = 14;

function at(day: Date, hhmm: string): Date | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const d = new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    Number(m[1]),
    Number(m[2]),
    0,
    0,
  );
  return d;
}

export function planReminders(input: ReminderInput): PlannedReminder[] {
  if (!input.enabled) return [];
  const days = Math.min(Math.max(input.days ?? 7, 1), MAX_REMINDER_DAYS);
  const out: PlannedReminder[] = [];
  for (let i = 0; i < days; i++) {
    const day = new Date(input.now.getFullYear(), input.now.getMonth(), input.now.getDate() + i);
    for (const kind of ['morning', 'evening'] as const) {
      if (i === 0 && input.doneToday[kind]) continue;
      const when = at(day, input[kind]);
      if (!when || when.getTime() <= input.now.getTime()) continue;
      out.push({ kind, at: when });
    }
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

export const REMINDER_COPY: Record<ReminderKind, { title: string; body: string }> = {
  morning: {
    title: 'Morning scan',
    body: 'Your 1-minute morning check-in is ready. Best before coffee.',
  },
  evening: {
    title: 'Evening scan',
    body: 'Take a minute for your evening check-in before winding down.',
  },
};
