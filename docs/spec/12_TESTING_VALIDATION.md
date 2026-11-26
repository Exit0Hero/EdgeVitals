# 12 — Testing and Validation Strategy

## 1. Test pyramid

- Unit tests: domain rules, validators, score formulas, state transitions.
- Integration tests: API/database, consent gates, assessment lifecycle.
- Component tests: forms, cards, charts, error states.
- End-to-end tests: onboarding through results, trends and account controls.
- Device tests: camera, permissions, interruptions, thermals and OS variants.
- Scientific validation: each measurement against an appropriate reference.
- Security tests: auth, authorization, dependency and data leakage.

## 2. UX acceptance tests

- Welcome actions navigate correctly.
- Required consent blocks onboarding until accepted.
- Optional consent remains independent and off by default.
- Profile values persist across navigation and relaunch.
- Morning/evening times can be changed.
- Morning check-in enforces sleep/energy ratings.
- Evening check-in enforces stress/energy ratings.
- Camera preparation precedes capture.
- Permission denial produces a useful fallback.
- Cancelled scan does not create valid readings.
- Partial result displays only valid metrics.
- Trends period selector changes the window.
- Empty and insufficient-baseline states are correct.

## 3. Data integrity tests

- No measurement can be written to another user's assessment.
- Simulated values cannot enter production baselines.
- Invalid values cannot be marked valid.
- Every measurement has unit, method and algorithm version.
- Check-in ratings are within 1–5.
- Duplicate requests are idempotent.
- Timezone conversion and daylight-saving behaviour are tested.
- Deleted accounts cannot continue using old tokens.

## 4. Measurement validation

For each metric:
- define reference standard;
- pre-register protocol and primary endpoint;
- define sample size rationale;
- collect representative device and participant coverage;
- lock evaluation data before final tuning;
- measure bias, precision, limits of agreement and repeatability;
- analyse failures and abstentions;
- perform subgroup and environmental analysis;
- publish limitations internally;
- require approval before enabling user-facing claims.

Do not treat correlation alone as proof of agreement or accuracy.

## 5. Performance targets

Set targets after a device matrix and prototype benchmark. Measure:
- app startup;
- screen transitions;
- camera startup latency;
- frame processing rate;
- memory and battery use;
- thermal throttling;
- API latency;
- chart rendering;
- offline queue recovery.

## 6. Accessibility

- Screen reader names and roles.
- Dynamic font scaling.
- Colour contrast.
- Touch target sizing.
- Keyboard and switch access where applicable.
- Non-colour status cues.
- Chart text summaries.
- Reduced motion.

## 7. Release gate

Block release for:
- unresolved critical/high security issues;
- consent bypass;
- cross-account data exposure;
- demo data entering production;
- fabricated or unvalidated physiological outputs;
- failed export/deletion workflows;
- major accessibility blockers;
- unreviewed third-party license obligations.
