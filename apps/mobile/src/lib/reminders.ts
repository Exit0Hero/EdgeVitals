import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import {
  planReminders,
  REMINDER_COPY,
  type ReminderInput,
  type ReminderKind,
} from './reminderPlan';

/**
 * Local scan reminders (iOS/Android). Notifications are scheduled on the
 * device; nothing is sent to a push server and no health data is included.
 */
export type ReminderPermission = 'granted' | 'denied' | 'undetermined' | 'unsupported';

const CHANNEL = 'scan-reminders';
const TAG = 'edgevitals-reminder';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export async function reminderPermission(): Promise<ReminderPermission> {
  const p = await Notifications.getPermissionsAsync();
  if (p.granted || p.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL)
    return 'granted';
  return p.canAskAgain ? 'undetermined' : 'denied';
}

/** Ask only when the person has chosen reminders (onboarding or settings). */
export async function requestReminderPermission(): Promise<ReminderPermission> {
  const current = await reminderPermission();
  if (current !== 'undetermined') return current;
  const p = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowSound: false, allowBadge: false },
  });
  return p.granted ? 'granted' : 'denied';
}

/** Replace this app's pending reminders with a fresh plan. Returns how many were scheduled. */
export async function syncReminders(input: Omit<ReminderInput, 'now'>): Promise<number> {
  await cancelReminders();
  if (!input.enabled || (await reminderPermission()) !== 'granted') return 0;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL, {
      name: 'Scan reminders',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  const plan = planReminders({ ...input, now: new Date() });
  for (const r of plan) {
    await Notifications.scheduleNotificationAsync({
      content: { ...REMINDER_COPY[r.kind], data: { tag: TAG, kind: r.kind } },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: r.at,
        channelId: CHANNEL,
      },
    });
  }
  return plan.length;
}

export async function cancelReminders(): Promise<void> {
  const pending = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    pending
      .filter((n) => (n.content.data as { tag?: string } | null)?.tag === TAG)
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
  );
}

/** The scan kind of the reminder the person tapped to open the app, if any. */
export function useReminderTap(): { id: string; kind: ReminderKind } | null {
  const response = Notifications.useLastNotificationResponse();
  const data = response?.notification.request.content.data as
    { tag?: string; kind?: ReminderKind } | undefined;
  // The last response survives restarts; only act on a recent tap.
  const recent = response ? Date.now() - response.notification.date < 15 * 60_000 : false;
  return response && recent && data?.tag === TAG && data.kind
    ? { id: response.notification.request.identifier, kind: data.kind }
    : null;
}

export const remindersSupported = true;
