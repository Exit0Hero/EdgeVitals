# ADR 0009 — SpO₂ and blood pressure from Health Connect and Apple Health (read only)

Date: 2026-11-27 · Status: Accepted (product owner approved step 3 of the $0 plan)

## Context

The camera cannot give trustworthy blood pressure, and camera SpO₂ is only an experimental
estimate (ADR 0008). Many people already own a watch, ring, pulse oximeter or blood-pressure cuff
that saves readings to the phone's health store. Reading those is free and gives real device
readings, provided the source stays clear.

## Decision

- **Platforms and libraries (free, MIT).** Android: Health Connect via
  `react-native-health-connect` (its bundled Expo config plugin adds the permission-rationale
  intent filter and activity alias, and registers the permission delegate). iOS: HealthKit via
  `@kingstinct/react-native-healthkit` (config plugin with background delivery and write access
  turned off). `expo-build-properties` raises Android `minSdkVersion` to 26, which Health Connect
  needs. Web has no health store.
- **Read only, two types.** `READ_OXYGEN_SATURATION` and `READ_BLOOD_PRESSURE` on Android;
  `OxygenSaturation`, `BloodPressureSystolic` and `BloodPressureDiastolic` on iOS. EdgeVitals
  never writes to either store.
- **Consent.** New optional consent type `health_sync`. Settings → Health app sync shows the
  system permission sheet first; the consent is recorded only if something was allowed. Turning
  it off withdraws the consent, stops syncing and, on Android, revokes all Health Connect
  permissions (iOS has no API for this, so the app explains where to do it). Copies already
  uploaded stay until the person taps "Delete synced readings" (or deletes the account); the
  phone's health store is never touched. The API refuses uploads unless the consent is active.
- **Storage.** Table `health_sync_readings` (migration 005), separate from camera measurements
  and cuff entries. Each row stores the platform, the writing app (package name or bundle id),
  its friendly name, device manufacturer and model when the platform provides them, and the
  record's id in the health store. `UNIQUE (user_id, platform, external_id)` makes re-syncs
  idempotent; edited records are updated in place.
- **No fabrication or correction.** Values are copied as recorded (blood pressure rounded to
  whole mmHg, SpO₂ to 0.1 %). HealthKit's percent fraction is converted to percent. Records
  outside 50–100 % SpO₂, 60–260 / 30–160 mmHg, with diastolic ≥ systolic, without an id, or
  in the future are skipped and counted, never adjusted. The database enforces the same ranges.
- **Sync.** First sync reads 30 days (Health Connect's default history window), later syncs
  re-read from 2 days before the last sync. Runs when sync is turned on, from "Sync now", and
  silently (at most every 15 minutes) when Trends or a scan's results open. Uploads in batches
  of 200 (API maximum 500).
- **Display.** Trends shows the newest SpO₂ from the person's devices and includes synced
  readings when choosing the newest blood pressure (cuff, health app or licensed SDK), each with a
  "Your device" pill and a source line such as "Galaxy Watch6 · Samsung Health via Health
  Connect". Results shows a "From your devices" block with readings from the last 24 hours. A
  Synced readings screen lists 90 days.
- **Analytics.** Synced readings never feed baselines, scores or insights (those read only
  assessment measurements). They are included in data export and account deletion.

## Consequences

- Readings are only as accurate as the device that recorded them. EdgeVitals does not validate
  third-party devices and says so in the app.
- Publishing to Google Play with Health Connect permissions needs a health apps declaration in
  the Play Console. Internal EAS test builds do not.
- iOS is code-complete but untested: HealthKit needs an Apple Developer account for the
  entitlement.
- Health Connect's privacy-policy link opens the app's start screen, not the policy itself.
