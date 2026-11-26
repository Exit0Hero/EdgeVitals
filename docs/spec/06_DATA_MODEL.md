# 06 — Data Model

## 1. Principles

- Store the minimum data required for the stated purpose.
- Separate identity from measurement records where practical.
- Record consent version and purpose.
- Store timestamps in UTC and the user's IANA timezone.
- Include provenance and algorithm version for every result.
- Distinguish unavailable, invalid, simulated and measured values.
- Never encode missing readings as zero.

## 2. Core entities

### User
- `id` UUID
- `email` or identity-provider subject
- `created_at`
- `status`
- `timezone`
- `deleted_at` nullable

### Profile
- `user_id`
- `birth_year`
- `sex_at_birth` (nullable/enum subject to product decision)
- `height_cm`
- `weight_kg`
- `updated_at`

### ConsentRecord
- `id`
- `user_id`
- `consent_type`: `processing`, `wellness_acknowledgement`, `anonymous_improvement`
- `granted`
- `policy_version`
- `recorded_at`
- `withdrawn_at` nullable
- `source`

### AssessmentSchedule
- `user_id`
- `morning_local_time`
- `evening_local_time`
- `timezone`
- `reminders_enabled`
- `updated_at`

### Assessment
- `id`
- `user_id`
- `kind`: `morning` or `evening`
- `status`
- `scheduled_for`
- `started_at`
- `completed_at`
- `timezone`
- `attempt_number`
- `created_at`

### CheckIn
- `id`
- `assessment_id`
- `sleep_quality` nullable
- `energy_rating`
- `stress_rating` nullable
- `alcohol_previous_evening` nullable
- `heart_rate_affecting_substance_response` nullable
- `created_at`

### Measurement
- `id`
- `assessment_id`
- `metric`: `heart_rate`, `hrv`, `breathing_rate`, `spo2`, `blood_pressure`
- `value_numeric` nullable
- `value_secondary` nullable (e.g. diastolic for blood pressure)
- `unit`
- `status`: `valid`, `unavailable`, `invalid`, `simulated`
- `quality_score` nullable
- `uncertainty` nullable
- `method`
- `algorithm_name`
- `algorithm_version`
- `measured_at`
- `created_at`

### Baseline
- `id`
- `user_id`
- `metric`
- `window_start`
- `window_end`
- `sample_count`
- `center_value`
- `lower_bound`
- `upper_bound`
- `method_version`
- `status`: `collecting`, `ready`, `insufficient`
- `calculated_at`

### Insight
- `id`
- `user_id`
- `insight_type`
- `title`
- `body`
- `evidence_window`
- `sample_count`
- `rule_version`
- `created_at`
- `expires_at`

### ExportJob / DeletionJob
Track request, status, timestamps, completion and audit references. Do not expose internal storage paths.

## 3. Relationship summary

- User 1:1 Profile
- User 1:N ConsentRecord
- User 1:1 AssessmentSchedule
- User 1:N Assessment
- Assessment 1:0..1 CheckIn
- Assessment 1:N Measurement
- User 1:N Baseline (one per metric/version/window)
- User 1:N Insight

## 4. Example measurement JSON

```json
{
  "metric": "heart_rate",
  "value": 62,
  "unit": "bpm",
  "status": "valid",
  "quality": {
    "score": 0.91,
    "flags": []
  },
  "provenance": {
    "method": "camera_rppg",
    "algorithm": "candidate-algorithm",
    "version": "0.1.0",
    "source": "measured"
  },
  "measured_at": "2026-11-26T07:18:00Z"
}
```

This is a schema illustration, not a claim that the sample value is real.

## 5. Indexes and constraints

- Unique identity subject.
- Foreign keys with explicit deletion strategy.
- Index `Assessment(user_id, scheduled_for)`.
- Index `Measurement(assessment_id, metric)`.
- Index `Baseline(user_id, metric, calculated_at)`.
- Check ratings are integers 1–5.
- Check units match metric.
- Prevent `status=valid` when value is null.
- Prevent `status=simulated` from entering production baseline calculations.

## 6. Retention and deletion

Define retention by data category before launch. Account deletion must cascade or anonymise all user-linked records as legally and operationally appropriate, including backups according to a documented backup expiry policy. Verify export completeness and deletion outcomes.
