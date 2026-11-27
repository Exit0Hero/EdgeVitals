/**
 * Copies SpO2 and blood pressure from the phone's health store to EdgeVitals
 * (ADR 0009). Read only: nothing is ever written back to Health Connect or
 * Apple Health. Runs only while the person's `health_sync` consent is on.
 */
import { api } from '../../api/client';
import { tokenStore } from '../secureStore';
import { healthStore } from './store';

/** First sync looks back this far (Health Connect's default history window). */
const FIRST_SYNC_DAYS = 30;
/** Later syncs re-read this much, to pick up records a device uploaded late. */
const OVERLAP_MS = 2 * 86_400_000;
/** Automatic syncs (on opening Trends or results) run at most this often. */
const AUTO_INTERVAL_MS = 15 * 60_000;
const CHUNK = 200;

const key = (userId: string) => `ev.healthsync.last.${userId}`;

export interface SyncSummary {
  at: string;
  read: number;
  inserted: number;
  updated: number;
  skipped: number;
}

export async function lastSyncedAt(userId: string): Promise<Date | null> {
  try {
    const v = await tokenStore.get(key(userId));
    const t = v ? Date.parse(v) : NaN;
    return Number.isFinite(t) ? new Date(t) : null;
  } catch {
    return null;
  }
}

export async function forgetSync(userId: string): Promise<void> {
  await tokenStore.remove(key(userId)).catch(() => undefined);
}

let running: Promise<SyncSummary> | null = null;

/** Reads new records and uploads them. Throws when the store or the API fails. */
export function syncHealthNow(userId: string): Promise<SyncSummary> {
  if (!healthStore) return Promise.reject(new Error('No health app on this device'));
  const store = healthStore;
  running ??= (async () => {
    const started = new Date();
    const last = await lastSyncedAt(userId);
    const since = last
      ? new Date(last.getTime() - OVERLAP_MS)
      : new Date(started.getTime() - FIRST_SYNC_DAYS * 86_400_000);
    const { readings, skipped } = await store.read(since);
    let inserted = 0;
    let updated = 0;
    for (let i = 0; i < readings.length; i += CHUNK) {
      const r = await api.uploadHealthSync({
        platform: store.platform,
        readings: readings.slice(i, i + CHUNK),
      });
      inserted += r.inserted;
      updated += r.updated;
    }
    await tokenStore.set(key(userId), started.toISOString());
    return { at: started.toISOString(), read: readings.length, inserted, updated, skipped };
  })().finally(() => {
    running = null;
  });
  return running;
}

/**
 * Background-friendly sync used when a screen opens: silent, throttled, and a
 * no-op unless the consent is on. Never throws.
 */
export async function autoSyncHealth(
  userId: string | undefined,
  consentActive: boolean,
): Promise<SyncSummary | null> {
  if (!healthStore || !userId || !consentActive) return null;
  try {
    const last = await lastSyncedAt(userId);
    if (last && Date.now() - last.getTime() < AUTO_INTERVAL_MS) return null;
    if ((await healthStore.availability()) !== 'available') return null;
    return await syncHealthNow(userId);
  } catch {
    return null;
  }
}
