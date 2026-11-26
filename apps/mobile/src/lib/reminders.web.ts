import type { ReminderInput, ReminderKind } from './reminderPlan';

/** Web build: scheduled reminders need the mobile app. */
export type ReminderPermission = 'granted' | 'denied' | 'undetermined' | 'unsupported';
export const reminderPermission = async (): Promise<ReminderPermission> => 'unsupported';
export const requestReminderPermission = async (): Promise<ReminderPermission> => 'unsupported';
export const syncReminders = async (_input: Omit<ReminderInput, 'now'>): Promise<number> => 0;
export const cancelReminders = async (): Promise<void> => undefined;
export const useReminderTap = (): { id: string; kind: ReminderKind } | null => null;
export const remindersSupported = false;
