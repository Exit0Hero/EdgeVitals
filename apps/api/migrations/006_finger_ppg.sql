-- ADR 0010: finger-on-camera scan (fingertip over the back camera, torch on).
-- Stored with method 'finger_ppg'; heart rate, HRV and breathing only. HRV
-- rows may carry SDNN in value_secondary (RMSSD stays in value_numeric).
ALTER TABLE measurements DROP CONSTRAINT measurements_method_check;
ALTER TABLE measurements ADD CONSTRAINT measurements_method_check
  CHECK (method IN ('camera_rppg', 'demo_fixture', 'licensed_sdk', 'camera_experimental', 'finger_ppg'));

-- A finger scan never reports SpO2 or blood pressure as a value.
ALTER TABLE measurements ADD CONSTRAINT measurements_finger_metric_scope_check
  CHECK (method <> 'finger_ppg' OR metric IN ('heart_rate', 'hrv', 'breathing_rate') OR status <> 'valid');
