-- ADR 0009: read-only SpO2 and blood pressure from Health Connect (Android) and
-- Apple Health (iOS). Kept apart from camera measurements and cuff entries: each
-- row names the platform, the app that wrote it and, when known, the device.
-- These rows never feed baselines or scores.
ALTER TABLE consent_records DROP CONSTRAINT consent_records_consent_type_check;
ALTER TABLE consent_records ADD CONSTRAINT consent_records_consent_type_check
  CHECK (consent_type IN ('processing', 'wellness_acknowledgement', 'anonymous_improvement', 'health_sync'));

CREATE TABLE health_sync_readings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  platform            text NOT NULL CHECK (platform IN ('health_connect', 'apple_health')),
  metric              text NOT NULL CHECK (metric IN ('spo2', 'blood_pressure')),
  value               numeric(5, 1) NOT NULL,
  value_secondary     smallint,
  measured_at         timestamptz NOT NULL,
  external_id         text NOT NULL CHECK (length(external_id) BETWEEN 1 AND 200),
  source_app          text NOT NULL CHECK (length(source_app) BETWEEN 1 AND 200),
  source_name         text CHECK (length(source_name) <= 120),
  device_manufacturer text CHECK (length(device_manufacturer) <= 120),
  device_model        text CHECK (length(device_model) <= 120),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, platform, external_id),
  CHECK (
    (metric = 'spo2' AND value BETWEEN 50 AND 100 AND value_secondary IS NULL) OR
    (metric = 'blood_pressure' AND value BETWEEN 60 AND 260 AND value = trunc(value)
      AND value_secondary BETWEEN 30 AND 160 AND value_secondary < value)
  )
);
CREATE INDEX health_sync_readings_user_time_idx
  ON health_sync_readings (user_id, metric, measured_at DESC);
