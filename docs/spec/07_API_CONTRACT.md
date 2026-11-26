# 07 — API Contract

Base path: `/api/v1`  
Transport: HTTPS only. JSON unless specified otherwise. All user-owned resources require authentication and ownership checks.

## 1. Conventions

- UUID identifiers.
- ISO-8601 timestamps in UTC.
- IANA timezone identifiers.
- Cursor pagination for lists.
- Idempotency key for assessment creation and export/deletion requests.
- Consistent errors: `{ "error": { "code": "...", "message": "...", "request_id": "..." } }`.
- Never include raw camera frames in ordinary JSON API logs.

## 2. Authentication

Prefer a managed OIDC/OAuth flow with PKCE for mobile clients.

Endpoints depend on chosen identity provider. The API validates access tokens and derives user identity from the verified token; never trust a client-supplied `user_id`.

## 3. Profile

- `GET /me`
- `PATCH /me/profile`

Example patch:
```json
{
  "birth_year": 1998,
  "sex_at_birth": "female",
  "height_cm": 170,
  "weight_kg": 68
}
```

Values are illustrative. Server validates bounds and supported enum values.

## 4. Consent

- `GET /me/consents`
- `POST /me/consents`
- `POST /me/consents/{consent_id}/withdraw`

Record policy version, purpose, timestamp and source. Required consent is checked before assessment creation.

## 5. Schedule

- `GET /me/schedule`
- `PUT /me/schedule`

Example:
```json
{
  "morning_time": "07:15",
  "evening_time": "21:00",
  "timezone": "Asia/Kolkata",
  "reminders_enabled": true
}
```

## 6. Assessments

- `POST /assessments`
- `GET /assessments`
- `GET /assessments/{assessment_id}`
- `PATCH /assessments/{assessment_id}/status`
- `POST /assessments/{assessment_id}/check-in`
- `POST /assessments/{assessment_id}/measurements`

Create request:
```json
{
  "kind": "morning",
  "scheduled_for": "2026-11-26T07:15:00+05:30"
}
```

Measurement request must include metric status, units, provenance and quality metadata. Server validates algorithm allowlist and rejects simulated values from production measurement endpoints unless explicit demo mode is active.

## 7. Dashboard and trends

- `GET /dashboard/today`
- `GET /trends?metric=hrv&period=30d`
- `GET /baseline`
- `GET /insights`
- `GET /reports/monthly`

Responses should include:
- data window;
- sample count;
- missing-data count;
- metric units;
- baseline status;
- calculation/rule version;
- generated timestamp.

## 8. Export and deletion

- `POST /me/export`
- `GET /me/export/{job_id}`
- `POST /me/deletion-request`
- `GET /me/deletion-request/{job_id}`

Export links must be short-lived and access-controlled. Deletion flow must explain what is deleted, what may remain temporarily in backups, and applicable legal exceptions.

## 9. Status codes

- 200 successful read/update
- 201 created
- 202 accepted asynchronous job
- 400 malformed request
- 401 unauthenticated
- 403 consent/permission/ownership restriction
- 404 unknown or inaccessible resource
- 409 state conflict/idempotency conflict
- 422 semantic validation failure
- 429 rate limit
- 500 unexpected server error

## 10. API contract tests

Test authentication, ownership isolation, consent gating, schema validation, idempotency, pagination, timezone handling, partial results and deletion/export lifecycle.
