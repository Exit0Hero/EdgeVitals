-- ADR 0008: opt-in experimental camera SpO2 (published ratio-of-ratios method,
-- unvalidated). Stored with method 'camera_experimental', SpO2 only.
ALTER TABLE measurements DROP CONSTRAINT measurements_method_check;
ALTER TABLE measurements ADD CONSTRAINT measurements_method_check
  CHECK (method IN ('camera_rppg', 'demo_fixture', 'licensed_sdk', 'camera_experimental'));

ALTER TABLE measurements DROP CONSTRAINT measurements_sdk_metric_scope_check;
ALTER TABLE measurements ADD CONSTRAINT measurements_sdk_metric_scope_check
  CHECK (
    (metric = 'spo2' AND (status <> 'valid' OR method IN ('licensed_sdk', 'camera_experimental'))) OR
    (metric = 'blood_pressure' AND (status <> 'valid' OR method = 'licensed_sdk') AND method <> 'camera_experimental') OR
    (metric NOT IN ('spo2', 'blood_pressure') AND method NOT IN ('licensed_sdk', 'camera_experimental'))
  );
