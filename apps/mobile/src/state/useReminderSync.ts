import { useEffect } from 'react';
import { api, type Dashboard } from '../api/client';
import { deviceTimeZone } from '../lib/id';
import { syncReminders } from '../lib/reminders';
import { useSession } from './session';

/**
 * Keeps local reminders and the stored time zone in step with the person's
 * schedule and today's progress. Runs whenever Today loads.
 */
export function useReminderSync(today: Dashboard['today'] | undefined) {
  const { me, refreshMe } = useSession();
  const s = me?.schedule;
  const morningDone = !!today?.morning;
  const eveningDone = !!today?.evening;
  useEffect(() => {
    if (!s || !today) return;
    let cancelled = false;
    (async () => {
      // After travel, day boundaries (streaks, "today") follow the device's zone.
      const tz = deviceTimeZone();
      if (s.timezone !== tz) {
        await api.saveSchedule({ ...s, timezone: tz }).catch(() => undefined);
        if (!cancelled) await refreshMe();
        return; // the refreshed schedule re-runs this effect
      }
      await syncReminders({
        morning: s.morning_time,
        evening: s.evening_time,
        enabled: s.reminders_enabled,
        doneToday: { morning: morningDone, evening: eveningDone },
      }).catch(() => undefined);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    s?.morning_time,
    s?.evening_time,
    s?.reminders_enabled,
    s?.timezone,
    morningDone,
    eveningDone,
    !!today,
  ]);
}
