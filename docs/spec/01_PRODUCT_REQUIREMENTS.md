# 01 — Product Requirements Document

## 1. Product summary

**Product:** EdgeVitals  
**Concept:** A daily wellness companion that invites users to complete two short face-camera sessions (morning and evening), records contextual check-in answers, builds a personal baseline over 14 days, and presents personal trends and wellness insights.

The supplied POC describes heart rate, HRV, breathing rate, SpO₂ and blood pressure as the five headline vital categories. It also explicitly states: **“Wellness insights — not a medical device.”**

## 2. Product goals

- Reproduce the supplied 12-screen experience faithfully.
- Make onboarding, consent, daily check-ins, scan flow, results and trends usable end-to-end.
- Store user-owned history and consent choices securely.
- Establish a personal baseline after 14 days of eligible data.
- Communicate measurement quality, uncertainty and missing data honestly.
- Provide export and deletion controls.

## 3. Non-goals for the initial release

- Diagnosis, disease screening, treatment recommendations or clinical monitoring.
- Replacing a validated blood-pressure cuff, pulse oximeter or other medical device.
- Claiming clinical-grade accuracy without appropriate evidence and regulatory review.
- Inferring a medical condition from wellness scores.
- Building social networking, clinician portals or insurance integrations unless separately approved.

## 4. Target users and jobs-to-be-done

### Primary user
A consumer who wants a simple daily routine and an understandable view of personal wellness trends.

### Jobs
- “Help me establish a consistent morning/evening check-in habit.”
- “Show me how my measurements vary relative to my own history.”
- “Help me understand possible relationships between sleep, energy, stress and my trends.”
- “Let me control, export and delete my data.”

## 5. Core product loop

1. User opens the app.
2. Home screen shows today's status and the next due assessment.
3. User completes a short context check-in.
4. App guides the user into a camera session.
5. The system evaluates camera/face/lighting quality.
6. The measurement engine either returns supported estimates with quality metadata or reports that the scan could not be completed.
7. Results are saved and shown with appropriate caveats.
8. Repeated eligible readings contribute to personal baseline and trend summaries.
9. User receives reminders for the next scheduled assessment.

## 6. Functional requirements

### Account and consent
- FR-001: User can create an account and sign in.
- FR-002: User must accept required data-processing consent before assessments are enabled.
- FR-003: User must acknowledge the wellness-not-medical-device notice.
- FR-004: Optional anonymised-data contribution is off by default and separately recorded.
- FR-005: User can read the privacy policy.
- FR-006: User can revoke optional consent and request data export/deletion.

### Profile and schedule
- FR-010: Capture year of birth, sex at birth, height and weight as shown in the POC.
- FR-011: Allow profile values to be edited later.
- FR-012: Configure morning and evening assessment times; POC defaults are 07:15 and 21:00.
- FR-013: Ask whether the user takes anything that affects heart rate; response options are No, Yes and Skip. The POC gives beta-blockers as an example.
- FR-014: Explain why this optional context is requested and do not infer medication names.

### Baseline
- FR-020: Show progress toward a 14-day baseline.
- FR-021: Clearly distinguish elapsed days, completed eligible assessments and remaining days.
- FR-022: Do not unlock personal baseline features until the baseline eligibility rule is met.
- FR-023: Missing or low-quality readings must not be silently treated as valid baseline samples.

### Check-in
- FR-030: Morning check-in asks sleep quality (1–5), energy (1–5), and previous-evening alcohol (No/Yes).
- FR-031: Evening check-in asks perceived stress (1–5) and current energy (1–5).
- FR-032: Responses are timestamped and associated with the relevant assessment.
- FR-033: User can navigate back before submission without losing answers.

### Scan
- FR-040: Show preparation instructions: sit down and relax; face camera in even light; stay still and breathe normally; do not talk.
- FR-041: Request camera permission with an explanation.
- FR-042: Show live camera preview only after permission is granted.
- FR-043: Show face-detected and lighting status only when actually evaluated.
- FR-044: Show progress and per-metric states: pending, measuring, available, unavailable, failed.
- FR-045: Allow cancellation.
- FR-046: Never fabricate measurements to fill missing metrics.
- FR-047: “Skip to results” is a prototype-only affordance in the reference; production must not expose it as a normal measurement path.

### Results and dashboard
- FR-050: Results show the session time and check-in context.
- FR-051: Display only readings that passed the relevant quality and validation gates.
- FR-052: Show Recovery and Stress cards in the result screen, and Energy on the mature dashboard.
- FR-053: Label each metric relative to the user's baseline only when a baseline exists.
- FR-054: Provide a clear wellness-only disclaimer.
- FR-055: Dashboard displays due/completed assessments, streak, progress, vital summaries, trend cards and eligible insights.

### Trends and reports
- FR-060: Trends support 7-day, 30-day and 90-day windows.
- FR-061: Trend metric selector includes Recovery, Stress, Energy, HRV and Heart rate as shown.
- FR-062: Show a personal usual range only after sufficient valid data exists.
- FR-063: Insights must be explainable, evidence-linked to the user's own records, and avoid causal language unless causality is established.
- FR-064: 30-day report is unlocked only when its stated data/period requirements are met.

## 7. Non-functional requirements

- NFR-001: Secure transport for all network communication.
- NFR-002: Encrypt sensitive stored data at rest using managed platform capabilities.
- NFR-003: Apply least-privilege access control.
- NFR-004: Provide accessible controls, scalable text and screen-reader labels.
- NFR-005: Support interruption/recovery during scan and network failure.
- NFR-006: Record algorithm version and quality metadata for every measurement.
- NFR-007: Keep analytics and demo data distinguishable from real user data.
- NFR-008: Provide automated unit, integration, UI and security tests.
- NFR-009: Keep secrets out of source control and client bundles.
- NFR-010: Make account export and deletion auditable.

## 8. Success measures

Product metrics (not clinical claims):
- onboarding completion rate;
- consent completion rate;
- morning/evening assessment completion;
- scan completion and retry rate;
- proportion of sessions with usable signal quality;
- 14-day baseline completion;
- weekly retention;
- export/deletion request completion time;
- crash-free sessions.

Do not optimise for increasing the number of displayed vital values at the expense of validity.

## 9. Release acceptance

A release is not accepted merely because screens look correct. It must pass:
- screen and workflow parity review;
- consent and privacy tests;
- data integrity tests;
- camera permission and interruption tests;
- measurement-specific validation gates;
- accessibility checks;
- security review;
- supported-device testing.
