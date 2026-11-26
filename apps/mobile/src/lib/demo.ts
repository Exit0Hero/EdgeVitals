/**
 * DEMO FIXTURES — deterministic, visibly labelled, simulated values used only
 * when the server has DEMO_MODE_ENABLED (never in production). They are
 * stored with status "simulated" and method "demo_fixture", which the API
 * and database keep out of baselines, trends and insights (doc 08 §7).
 * Values mirror the reference wireframe examples.
 */
export function demoMeasurements(kind: 'morning' | 'evening') {
  const now = new Date().toISOString();
  const base = {
    quality_score: null,
    quality_flags: [],
    reason: null,
    method: 'demo_fixture',
    algorithm_name: 'demo-fixture',
    algorithm_version: '0.0.0',
    config_version: 'demo',
    validation: 'unvalidated',
    measured_at: now,
  };
  const v = kind === 'morning' ? { hr: 58, hrv: 52, br: 13 } : { hr: 64, hrv: 48, br: 14 };
  return [
    { ...base, metric: 'heart_rate', status: 'simulated', value: v.hr, unit: 'bpm' },
    { ...base, metric: 'hrv', status: 'simulated', value: v.hrv, unit: 'ms' },
    { ...base, metric: 'breathing_rate', status: 'simulated', value: v.br, unit: '/min' },
    {
      ...base,
      metric: 'spo2',
      status: 'unavailable',
      value: null,
      unit: '%',
      reason: 'unsupported_method',
    },
    {
      ...base,
      metric: 'blood_pressure',
      status: 'unavailable',
      value: null,
      unit: 'mmHg',
      reason: 'unsupported_method',
    },
  ];
}
