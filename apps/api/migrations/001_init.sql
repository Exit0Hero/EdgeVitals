-- EdgeVitals initial schema (docs/spec/06_DATA_MODEL.md)
-- Timestamps are UTC (timestamptz); local context is kept as IANA zone names.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  password_hash text NOT NULL,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
  timezone      text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  CONSTRAINT users_email_lower CHECK (email = lower(email))
);
CREATE UNIQUE INDEX users_email_key ON users (email);

CREATE TABLE profiles (
  user_id      uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  birth_year   smallint CHECK (birth_year BETWEEN 1900 AND 2100),
  sex_at_birth text CHECK (sex_at_birth IN ('female', 'male')),
  height_cm    numeric(5, 1) CHECK (height_cm BETWEEN 100 AND 250),
  weight_kg    numeric(5, 1) CHECK (weight_kg BETWEEN 30 AND 300),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE consent_records (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  consent_type   text NOT NULL CHECK (consent_type IN ('processing', 'wellness_acknowledgement', 'anonymous_improvement')),
  granted        boolean NOT NULL,
  policy_version text NOT NULL,
  source         text NOT NULL,
  recorded_at    timestamptz NOT NULL DEFAULT now(),
  withdrawn_at   timestamptz
);
CREATE INDEX consent_records_user_idx ON consent_records (user_id, consent_type, recorded_at DESC);

CREATE TABLE schedules (
  user_id                         uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  morning_time                    time NOT NULL DEFAULT '07:15',
  evening_time                    time NOT NULL DEFAULT '21:00',
  timezone                        text NOT NULL,
  reminders_enabled               boolean NOT NULL DEFAULT true,
  heart_rate_affecting_substance  text CHECK (heart_rate_affecting_substance IN ('no', 'yes', 'skip')),
  updated_at                      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  family_id   uuid NOT NULL,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);

CREATE TABLE assessments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind             text NOT NULL CHECK (kind IN ('morning', 'evening')),
  status           text NOT NULL DEFAULT 'not_started' CHECK (status IN (
                     'not_started', 'check_in_in_progress', 'check_in_complete', 'scan_preparation',
                     'permission_pending', 'capturing', 'quality_check', 'processing',
                     'completed', 'partial', 'failed', 'cancelled')),
  scheduled_for    timestamptz NOT NULL,
  started_at       timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz,
  timezone         text NOT NULL,
  attempt_number   integer NOT NULL DEFAULT 1 CHECK (attempt_number >= 1),
  demo             boolean NOT NULL DEFAULT false,
  idempotency_key  text,
  scan_diagnostics jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assessments_user_scheduled_idx ON assessments (user_id, scheduled_for);
CREATE UNIQUE INDEX assessments_idempotency_idx ON assessments (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE check_ins (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id             uuid NOT NULL UNIQUE REFERENCES assessments (id) ON DELETE CASCADE,
  kind                      text NOT NULL CHECK (kind IN ('morning', 'evening')),
  sleep_quality             smallint CHECK (sleep_quality BETWEEN 1 AND 5),
  energy_rating             smallint NOT NULL CHECK (energy_rating BETWEEN 1 AND 5),
  stress_rating             smallint CHECK (stress_rating BETWEEN 1 AND 5),
  alcohol_previous_evening  boolean,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CHECK (kind <> 'morning' OR (sleep_quality IS NOT NULL AND alcohol_previous_evening IS NOT NULL)),
  CHECK (kind <> 'evening' OR stress_rating IS NOT NULL)
);

CREATE TABLE measurements (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id     uuid NOT NULL REFERENCES assessments (id) ON DELETE CASCADE,
  metric            text NOT NULL CHECK (metric IN ('heart_rate', 'hrv', 'breathing_rate', 'spo2', 'blood_pressure')),
  value_numeric     double precision,
  value_secondary   double precision,
  unit              text NOT NULL,
  status            text NOT NULL CHECK (status IN ('valid', 'unavailable', 'invalid', 'simulated')),
  quality_score     real CHECK (quality_score BETWEEN 0 AND 1),
  quality_flags     jsonb NOT NULL DEFAULT '[]',
  reason            text,
  method            text NOT NULL CHECK (method IN ('camera_rppg', 'demo_fixture')),
  algorithm_name    text NOT NULL,
  algorithm_version text NOT NULL,
  config_version    text NOT NULL,
  validation        text NOT NULL CHECK (validation IN ('unvalidated', 'validated')),
  measured_at       timestamptz NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (assessment_id, metric),
  -- Never encode missing readings as numbers; never store a valid value without one.
  CHECK ((status IN ('valid', 'simulated')) = (value_numeric IS NOT NULL)),
  CHECK (status <> 'simulated' OR method = 'demo_fixture'),
  CHECK (method <> 'demo_fixture' OR status <> 'valid'),
  -- No supported camera method for SpO2 or blood pressure (ADR 0004).
  CHECK (metric NOT IN ('spo2', 'blood_pressure') OR status <> 'valid'),
  CHECK (
    (metric = 'heart_rate' AND unit = 'bpm') OR (metric = 'hrv' AND unit = 'ms') OR
    (metric = 'breathing_rate' AND unit = '/min') OR (metric = 'spo2' AND unit = '%') OR
    (metric = 'blood_pressure' AND unit = 'mmHg'))
);
CREATE INDEX measurements_assessment_metric_idx ON measurements (assessment_id, metric);

CREATE TABLE audit_events (
  id          bigserial PRIMARY KEY,
  -- Kept (without the FK) after account deletion so deletion itself stays auditable.
  user_id     uuid,
  event_type  text NOT NULL,
  details     jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_user_idx ON audit_events (user_id, created_at);

CREATE TABLE export_jobs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status           text NOT NULL CHECK (status IN ('pending', 'completed', 'failed', 'expired')),
  idempotency_key  text,
  payload          jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz,
  expires_at       timestamptz NOT NULL
);
CREATE UNIQUE INDEX export_jobs_idempotency_idx ON export_jobs (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE deletion_jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Not a FK: the user row is gone once the job completes.
  user_id       uuid NOT NULL,
  status        text NOT NULL CHECK (status IN ('pending', 'completed', 'failed')),
  requested_at  timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz
);
