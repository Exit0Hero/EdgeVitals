-- ADR 0007: SpO2 and blood pressure may be stored as valid only when they come
-- from a licensed third-party SDK (method 'licensed_sdk'). Our own camera
-- pipeline still cannot produce them, and a licensed SDK may produce nothing else.
ALTER TABLE measurements DROP CONSTRAINT measurements_method_check;
ALTER TABLE measurements ADD CONSTRAINT measurements_method_check
  CHECK (method IN ('camera_rppg', 'demo_fixture', 'licensed_sdk'));

ALTER TABLE measurements DROP CONSTRAINT measurements_check3;
ALTER TABLE measurements ADD CONSTRAINT measurements_sdk_metric_scope_check
  CHECK (
    (metric IN ('spo2', 'blood_pressure') AND (status <> 'valid' OR method = 'licensed_sdk')) OR
    (metric NOT IN ('spo2', 'blood_pressure') AND method <> 'licensed_sdk')
  );

-- Blood pressure is stored as systolic (value_numeric) over diastolic (value_secondary).
ALTER TABLE measurements ADD CONSTRAINT measurements_bp_pair_check
  CHECK (
    metric <> 'blood_pressure' OR status <> 'valid' OR
    (value_secondary IS NOT NULL AND value_secondary < value_numeric)
  );
