# Images

Screenshots used by the root `README.md`. Every image here is a real screen of the app. None is a mock-up, and none was edited apart from resizing to 540 px wide.

## How `screens/` was captured

- Date: 2026-11-28, from `main` at commit `6712d61`.
- Build: the exported web build (`npm run build:web`) served by `apps/mobile/e2e/serve.mjs`, against a local API with `DEMO_MODE_ENABLED=true`.
- Tool: the Playwright suite in `apps/mobile/e2e` with `E2E_SCREENSHOTS` set (Pixel 7 viewport), plus one short local-only script for the cuff blood pressure and Settings screens. That script was not committed.

| File                             | Screen                                   | Where the numbers come from                                     |
| -------------------------------- | ---------------------------------------- | --------------------------------------------------------------- |
| `onboarding-welcome.png`         | Welcome                                  | No values                                                       |
| `onboarding-consent.png`         | Consent                                  | No values (hosting region is the local config value)            |
| `onboarding-schedule.png`        | Your daily rhythm                        | Times typed by the test                                         |
| `check-in-morning.png`           | Morning check-in                         | Answers chosen by the test                                      |
| `scan-prepare.png`               | Get ready to scan (finger or face)       | No values                                                       |
| `scan-face-no-face.png`          | Face scan with Chromium's fake camera    | No values: the test pattern has no face, so nothing is measured |
| `results-demo.png`               | Demo results                             | Demo mode: simulated, labelled "Demo" in the app                |
| `results-finger-partial.png`     | Results after a partial finger scan      | Test fixture (`algorithm_name: "e2e-fixture"`)                  |
| `results-why-no-value.png`       | "Why some vitals have no value"          | Test fixture                                                    |
| `today-first-day.png`            | Today, first day                         | No values                                                       |
| `today-with-history.png`         | Today with 23 days of history            | Test fixtures seeded by `history.spec.ts` into a local database |
| `today-last-assessment.png`      | Today, last assessment summary           | Test fixture                                                    |
| `trends-hrv.png`                 | Trends, HRV, 30 days                     | Test fixtures seeded by `history.spec.ts`                       |
| `cuff-blood-pressure.png`        | Log a cuff blood pressure reading        | Example entry typed by the test                                 |
| `settings-experimental-sync.png` | Settings: experimental SpO₂, health sync | No values                                                       |
| `settings-your-data.png`         | Settings: consents, export, deletion     | No values                                                       |

To recapture, follow `apps/mobile/e2e/README.md` and run the suite with `E2E_SCREENSHOTS=/some/dir`.

## Still needed (real phone only)

These cannot be captured honestly from the web build. Take them from an EAS test build on a real phone, in a real scan, and add them here with the device model and app commit:

- Finger scan in progress (back camera, flash, live pulse).
- Face scan in progress with a real face in the oval and the live signal-strength indicator.
- Results after a real scan, including the finger pulse waveform with detected beats.
- Scan details after a failed scan (per-area SNR, gate reasons).
- Health app sync: the system permission sheet and the Synced readings screen with readings from a real device.
- A reminder notification.

Never use a screenshot from a mocked camera, a synthetic pulse or an edited image in the README: the app's documentation forbids presenting fabricated readings.
