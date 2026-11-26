import { describe, expect, it } from 'vitest';
import { MAX_REMINDER_DAYS, planReminders } from '../src/lib/reminderPlan';

// vitest.config.ts pins TZ=Europe/London so DST rules are exercised.
const local = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi);
const fmt = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const base = {
  morning: '07:15',
  evening: '21:00',
  enabled: true,
  doneToday: { morning: false, evening: false },
};

describe('reminder planning', () => {
  it('schedules both scans for the coming days at local times, skipping past ones', () => {
    const plan = planReminders({ ...base, now: local(2026, 11, 26, 9, 0), days: 2 });
    expect(plan.map((p) => `${p.kind} ${fmt(p.at)}`)).toEqual([
      'evening 2026-11-26 21:00',
      'morning 2026-11-27 07:15',
      'evening 2026-11-27 21:00',
    ]);
  });

  it('does not remind about a scan already done today', () => {
    const plan = planReminders({
      ...base,
      now: local(2026, 11, 26, 6, 0),
      days: 1,
      doneToday: { morning: true, evening: false },
    });
    expect(plan.map((p) => p.kind)).toEqual(['evening']);
  });

  it('schedules nothing when reminders are off', () => {
    expect(planReminders({ ...base, enabled: false, now: local(2026, 11, 26) })).toEqual([]);
  });

  it('keeps wall-clock times across a daylight-saving change', () => {
    // UK clocks go back on 25 Oct 2026.
    const plan = planReminders({ ...base, now: local(2026, 10, 24, 22, 0), days: 3 });
    expect(plan.filter((p) => p.kind === 'morning').map((p) => fmt(p.at))).toEqual([
      '2026-10-25 07:15',
      '2026-10-26 07:15',
    ]);
  });

  it('caps the number of pending notifications', () => {
    const plan = planReminders({ ...base, now: local(2026, 11, 26, 0, 0), days: 100 });
    expect(plan).toHaveLength(MAX_REMINDER_DAYS * 2);
  });

  it('ignores malformed times rather than scheduling at midnight', () => {
    expect(
      planReminders({ ...base, morning: '7am', now: local(2026, 11, 26, 0, 0), days: 1 }).map(
        (p) => p.kind,
      ),
    ).toEqual(['evening']);
  });
});
