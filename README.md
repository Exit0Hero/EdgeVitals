# EdgeVitals

A daily wellness companion: two short camera check-ins a day (morning and evening), a personal 14-day baseline, and honest trends.

> **Wellness software, not a medical device.** Nothing here diagnoses, treats or monitors a medical condition. Camera estimates are **not clinically validated**: every value is labelled "Estimate, not validated" in the app, and every stored measurement records `validation: "unvalidated"` with its algorithm, version and config. The quality gates are tuned on synthetic signals and a few real traces from one phone, with no reference device.

See `docs/spec/` for the product specification and `docs/adr/` for architecture decisions.

## What the app does

- **Onboarding, consent and profile.** Account, consent, rhythm (scan times) and profile screens; consents can be withdrawn in Settings. Reminders for the two check-in times.
- **Face scan (rPPG).** On-device POS/PBV pulse extraction from forehead and cheek colour averages. No frames, images or video are stored or uploaded ([ADR 0003](docs/adr/0003-on-device-measurement.md)). On Android, measurement starts automatically (no preview-only mode).
  - Camera auto-exposure and white balance are locked on the face, and the skin-sampling area is held still, so exposure ramps and box jitter are not read as pulse. The signal is split at sudden colour steps.
  - Heart rate passes either a window-consensus gate (10 s windows must agree) or a whole-scan spectrum gate with half-scan agreement. Scans target 45 s of usable signal and extend up to 75 s (hard stop 90 s) when heart rate has not passed yet. Gates and false-acceptance runs: [ADR 0004](docs/adr/0004-metric-availability-and-gates.md).
  - Live BPM, HRV and breathing during the scan, plus a live pulse-signal strength once 15 s of clean signal exists.
  - Breathing can also come from head movement when the colour-based estimators abstain ([ADR 0010](docs/adr/0010-finger-scan-and-motion-breathing.md)).
- **Finger scan.** Fingertip over the back camera with the torch on, for a much stronger pulse: heart rate, HRV (RMSSD and SDNN) and breathing, with its own gates and a 75 s hard stop so the torch doesn't overheat the phone. It never reports SpO₂ or blood pressure ([ADR 0010](docs/adr/0010-finger-scan-and-motion-breathing.md)).
- **Results and scan details.** Each metric either passes its gates or shows "No reliable reading" with the reason. Scan details stay visible after a failed scan and include pulse SNR by area (forehead, left and right cheek). The details and the signal trace (mean skin colour per frame, no images) can be shared as a file for debugging.
- **SpO₂ and blood pressure**, kept separate by source:
  - _Experimental camera SpO₂_: off by default, turned on under **Settings → Experimental estimates**. Bal (2015) ratio of ratios, reported only within 90–100 % and only after heart rate passes ([ADR 0008](docs/adr/0008-experimental-camera-spo2.md)). There is no camera blood pressure.
  - _Manual cuff BP_: log readings from your own blood-pressure cuff.
  - _Health Connect / Apple Health_: optional, read-only import of SpO₂ and blood pressure saved by your watch, ring, oximeter or cuff, behind its own consent. Synced copies can be deleted from Settings ([ADR 0009](docs/adr/0009-health-app-sync.md)).
  - _Licensed SDK_: a provider interface exists for a commercial SDK, but no vendor is licensed, so it returns nothing ([ADR 0007](docs/adr/0007-licensed-sdk-spo2-blood-pressure.md)).
- **Baseline and trends.** Personal 14-day baseline, trends and insights. Recovery, Stress and Energy scores are a draft (`scores-v0-draft`, [ADR 0005](docs/adr/0005-baseline-scores-insights.md)).
- **Your data.** Export and account deletion.

Native camera, finger scan and health sync are **not yet verified on enough devices**: see `docs/native-camera-device-tests.md`.

## Layout

- `packages/measurement`: on-device signal pipeline in pure TypeScript (face rPPG, finger PPG, motion breathing, experimental SpO₂, quality gates, YUV ROI extraction, licensed-SDK interface).
- `packages/domain`: shared schemas and analytics (baseline, draft scores, insights).
- `apps/api`: Fastify + PostgreSQL API (auth, consents, assessments, cuff BP, health-sync readings, dashboard, export, deletion). SQL migrations in `apps/api/migrations/`.
- `apps/mobile`: Expo app (iOS, Android, web). Native camera via VisionCamera and on-device ML Kit face detection; the web build has a working face scan.

## Development

```sh
npm ci
npm run typecheck && npm test   # API tests need Postgres (see apps/api/.env.example)
cd apps/mobile && npm run web   # Expo dev server
```

End-to-end tests: `apps/mobile/e2e/README.md`. Design differences from the wireframes: `docs/design-deviations.md`.

Phone test builds: **Actions → Build test app** (Expo EAS, needs the `EXPO_TOKEN` secret). Install and test steps: `docs/native-camera-device-tests.md`.

## Deployment

Docker images, environment variables, migrations, hosting headers and the launch checklist: `docs/deployment.md`.

Staging runs on Render's free tier (`render.yaml`, Singapore): `docs/render-staging.md`.

> **Ops note: PRs that add a migration.** The API never migrates on start, and `/ready` returns 503 until every migration is applied, so after merging a PR that adds a file to `apps/api/migrations/` the new staging deploy stays unhealthy. To finish it:
>
> 1. Temporarily allow `0.0.0.0/0` on the staging database in Render (Networking).
> 2. Run **Actions → Migrate staging database** on `main` and type `MIGRATE`.
> 3. Remove the temporary allow-list entry.
> 4. In Render, open `edgevitals-staging-api` → **Manual Deploy → Deploy latest commit**.
>
> Full steps: `docs/render-staging.md` ("Later schema changes").
