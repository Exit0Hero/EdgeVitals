# ADR 0006 — Scan reminders

Date: 2026-11-26 · Status: Accepted

## Decision

Reminders are **local notifications scheduled on the phone** (`expo-notifications`), not server push.

- One-off notifications for the next 7 days at the person's morning and evening times, in the device's current time zone. They are rescheduled every time Today loads, so they follow schedule changes, completed scans and travel. A scan already done today gets no reminder. At most 28 are pending, well under the iOS limit of 64.
- Permission is requested only when the person has chosen reminders: at "Start my baseline" (the screen promises reminders) or when switching reminders on in Settings. Declining keeps `reminders_enabled` off; Settings explains how to re-enable it in phone settings.
- Notification text contains no health data ("Morning scan: your 1-minute morning check-in is ready").
- Tapping a reminder opens that scan's check-in (only for a tap in the last 15 minutes, so a stale tap is not replayed on a later launch).
- When the device's IANA time zone differs from the stored one, the app updates `schedule.timezone` and keeps the local wall-clock times (07:15 stays 07:15 after a flight). Streaks and "today" use the stored zone.
- Signing out, an expired session or account deletion cancels pending reminders on that device.
- The web build has no scheduled reminders; Settings says they come through the phone app.

## Why not server push

Push needs a push service, device tokens (personal data), a scheduler and per-time-zone fan-out. Local notifications need none of that, work offline and are enough for two fixed daily times. Server push can be added later for re-engagement if the product needs it.

## Not yet verified

Delivery on physical iOS and Android devices (including Android exact-alarm behaviour and Doze) is part of the device test plan.
