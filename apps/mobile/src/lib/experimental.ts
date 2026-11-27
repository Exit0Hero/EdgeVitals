/**
 * Opt-in experimental estimators (ADR 0008). Stored on this device only;
 * off by default and off again after sign-out on web (session storage).
 */
import { tokenStore } from './secureStore';

const KEY = 'ev.experimental.spo2';

export async function getExperimentalSpo2(): Promise<boolean> {
  try {
    return (await tokenStore.get(KEY)) === '1';
  } catch {
    return false;
  }
}

export async function setExperimentalSpo2(on: boolean): Promise<void> {
  if (on) await tokenStore.set(KEY, '1');
  else await tokenStore.remove(KEY);
}
