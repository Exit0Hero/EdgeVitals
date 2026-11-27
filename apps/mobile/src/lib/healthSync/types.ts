import type { HealthSyncPlatform, HealthSyncReadingInput } from '@edgevitals/domain';

export type Availability =
  /** The health store is installed and usable. */
  | 'available'
  /** Health Connect is installed but needs an update from the Play Store. */
  | 'needs_update'
  /** No health store on this device (web, old Android, iPad without Health). */
  | 'unavailable';

/** What the person allowed EdgeVitals to read. `null` = the platform will not say (iOS). */
export interface Access {
  spo2: boolean | null;
  blood_pressure: boolean | null;
}

export interface ReadResult {
  readings: HealthSyncReadingInput[];
  /** Records we left out because the values were outside what a person can have. */
  skipped: number;
}

/**
 * Read-only access to the phone's health store (ADR 0009). One implementation
 * per platform; the web build has none.
 */
export interface HealthStore {
  platform: HealthSyncPlatform;
  /** Shown to the person: "Health Connect" or "Apple Health". */
  name: string;
  availability(): Promise<Availability>;
  /** Shows the system permission sheet for SpO2 and blood pressure (read only). */
  requestAccess(): Promise<Access>;
  /** Current permissions without asking. */
  grantedAccess(): Promise<Access>;
  /** Readings recorded at or after `since`. */
  read(since: Date): Promise<ReadResult>;
  /** Removes EdgeVitals' permissions where the platform allows it; returns false when the person must do it in system settings. */
  revoke(): Promise<boolean>;
  /** Opens the system screen where the person manages these permissions. */
  openSettings(): Promise<void>;
}
