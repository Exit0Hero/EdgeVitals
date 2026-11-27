-- Blood pressure the user typed in from their own cuff (ADR 0008 follow-up).
-- Kept apart from camera measurements: these are self-reported device readings.
CREATE TABLE cuff_bp_readings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  systolic     smallint NOT NULL CHECK (systolic BETWEEN 60 AND 260),
  diastolic    smallint NOT NULL CHECK (diastolic BETWEEN 30 AND 160),
  pulse_bpm    smallint CHECK (pulse_bpm BETWEEN 30 AND 220),
  measured_at  timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (diastolic < systolic)
);
CREATE INDEX cuff_bp_readings_user_time_idx ON cuff_bp_readings (user_id, measured_at DESC);
