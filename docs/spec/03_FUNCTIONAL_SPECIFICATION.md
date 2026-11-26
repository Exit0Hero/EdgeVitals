# 03 — Functional Specification

## 1. Navigation model

Unauthenticated:
`Welcome → Consent → About you (1/2) → Daily rhythm (2/2) → Today`

Returning user:
`Welcome → Sign in → Today`

Assessment:
`Today → Check-in → Scan preparation → Active scan → Results → Today`

Trends:
`Today ↔ Trends`

Settings/profile are required product surfaces even though they are not fully shown in the 12-page POC; exact screen design is a follow-up design task.

## 2. Assessment state machine

States:
- `not_started`
- `check_in_in_progress`
- `check_in_complete`
- `scan_preparation`
- `permission_pending`
- `capturing`
- `quality_check`
- `processing`
- `completed`
- `partial`
- `failed`
- `cancelled`

Rules:
- A session can be `completed` when all configured required outputs pass their own quality gates.
- A session can be `partial` when at least one metric is valid and others are unavailable.
- A failed or cancelled session is retained as an event only if required for reliability metrics and disclosed in privacy documentation; raw camera frames should not be retained by default.
- Retrying creates a new attempt linked to the same scheduled assessment slot, not an overwritten record.
- Never convert a missing metric to zero.

## 3. Morning check-in

Fields:
- `sleep_quality`: integer 1–5
- `energy_rating`: integer 1–5
- `alcohol_previous_evening`: boolean or unanswered until submitted

Validation:
- Both ratings required.
- Alcohol choice required in the reference flow.
- Store local timezone and UTC timestamp.
- Permit edit before scan submission; after submission, changes create an audit event or a corrected version.

## 4. Evening check-in

Fields:
- `stress_rating`: integer 1–5
- `energy_rating`: integer 1–5

Validation:
- Both ratings required.
- No medical interpretation of subjective ratings.

## 5. Schedule and reminders

- Store local wall-clock time plus IANA timezone.
- Schedule separate morning and evening reminders.
- Handle daylight-saving transitions and timezone changes.
- Ask for notification permission contextually; app remains usable if permission is denied.
- Avoid duplicate notifications after schedule edits.
- Provide quiet-hour and reminder-disable controls in settings.

## 6. Baseline progress

The POC says “personal baseline after 14 days” and shows day count. It does not define whether both daily scans are mandatory or what minimum sample count is needed.

Recommended implementation decision:
- 14 calendar days of participation, with a minimum number of valid samples per metric.
- Calculate each metric's baseline only from valid samples for that metric.
- Show progress as calendar days plus valid sample count, so a user is not misled by low-quality or missing scans.
- Final thresholds must be configurable and documented in `09_BASELINE_AND_ANALYTICS.md`.

## 7. Camera permissions and quality

Permission states:
- not_requested
- granted
- denied
- restricted
- unavailable

Quality statuses:
- face_not_found
- multiple_faces
- face_out_of_region
- lighting_too_low
- lighting_too_high
- motion_too_high
- camera_unavailable
- signal_insufficient
- ready

User-facing copy must explain corrective action. Avoid implying a successful biometric scan solely because a face is visible.

## 8. Results rendering

Each metric result contains:
- metric name and unit;
- value, if valid;
- timestamp;
- measurement method and algorithm version;
- quality status and confidence/uncertainty representation where justified;
- baseline comparison status;
- source label: measured, imported, simulated/demo, or unavailable.

Score cards must have a documented formula and minimum-data requirement. Until those are approved, show “insufficient data” rather than a fabricated score.

## 9. Empty, error and offline states

Design and implement:
- no assessments yet;
- baseline in progress;
- baseline insufficient;
- camera denied;
- unsupported camera/device;
- poor lighting;
- movement detected;
- interrupted scan;
- partial result;
- offline during upload;
- expired session;
- server error;
- deleted account;
- export in progress;
- reminder permission denied.

## 10. Auditability

Important events:
- consent granted/withdrawn;
- profile changed;
- schedule changed;
- assessment started/cancelled/completed;
- algorithm version used;
- export requested/completed;
- deletion requested/completed.

Avoid logging raw face images, raw biometric streams, credentials or unnecessary personal data.
