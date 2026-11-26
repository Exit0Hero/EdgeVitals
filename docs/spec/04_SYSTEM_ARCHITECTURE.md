# 04 — System Architecture

## 1. Architectural goals

- Reproduce the mobile-first POC with a maintainable cross-platform codebase.
- Keep UI, domain logic, persistence and measurement algorithms separated.
- Support independent algorithm replacement and validation.
- Make demo/synthetic data impossible to confuse with real readings.
- Minimise collection and retention of camera data.
- Enable a web-based internal operations view only if needed later.

## 2. Logical components

### Mobile client
Responsibilities:
- onboarding, consent, profile and schedule;
- check-in forms and navigation;
- camera permission and preview;
- scan orchestration and quality feedback;
- results, dashboard, trends and settings;
- secure session handling and local retry queue.

### API service
Responsibilities:
- authentication/session validation;
- user/profile/consent management;
- assessment lifecycle;
- measurement metadata and result persistence;
- baseline and analytics orchestration;
- export/deletion workflows;
- notification scheduling integration.

### Measurement module
Responsibilities:
- camera capture interface;
- face/ROI detection;
- image-quality checks;
- signal extraction and preprocessing;
- metric-specific estimation;
- quality scoring and abstention;
- algorithm/version metadata.

This module should be isolated from ordinary API business logic. Prefer on-device processing for sensitive frames where technically feasible. If server processing is proposed, document exact data flow, purpose, retention and user consent before implementation.

### Data layer
- Relational database for users, consents, assessments, readings and schedules.
- Object storage should not be used for face video by default.
- If temporary raw data is essential for research, require explicit separate consent, access controls, strict retention and deletion verification.

### Analytics
- Baseline computation.
- Trend aggregation.
- Personalised, rule-based insights.
- Score generation only after formulas and validation criteria are approved.

## 3. Suggested deployment topology

`Mobile app → HTTPS API → application services → relational database`

Optional:
- background worker for reminder dispatch, export and analytics;
- managed push notification provider;
- object storage for generated exports with short-lived access links;
- observability service with sensitive-data scrubbing.

## 4. Domain boundaries

Suggested modules:
- `identity`
- `consent`
- `profile`
- `schedule`
- `assessment`
- `camera`
- `measurement`
- `baseline`
- `analytics`
- `insights`
- `notifications`
- `export`
- `privacy`
- `observability`

## 5. Data flow

1. Client obtains a short-lived authenticated session.
2. User submits check-in responses.
3. Client requests an assessment session.
4. Camera and measurement pipeline run according to approved processing mode.
5. Pipeline returns metric-specific results and quality metadata.
6. Client submits structured result metadata to API.
7. API validates ownership, schema, timestamps and algorithm version.
8. Background analytics update eligible baselines and trend aggregates.
9. Client fetches results and dashboard state.

## 6. Failure isolation

- Camera failures must not affect access to history or settings.
- Analytics failures must not erase raw validated measurements.
- Notification failures must not block assessments.
- Partial measurement results must be represented explicitly.
- API retry operations must be idempotent.

## 7. Architecture quality attributes

- Privacy by design.
- Observability without sensitive payload logging.
- Testability of every domain module.
- Versioned API and algorithm metadata.
- Backward-compatible database migrations.
- Accessibility and performance on supported devices.

## 8. Decisions still required

- Final mobile framework.
- Backend language/framework.
- Database and hosting region.
- On-device versus server-side processing.
- Authentication provider.
- Push provider.
- Whether a web client is in scope.
- Supported minimum OS/device capabilities.
