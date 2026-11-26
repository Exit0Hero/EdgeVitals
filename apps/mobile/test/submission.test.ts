import { submitMeasurementsSchema } from '@edgevitals/domain';
import { ScanSession } from '@edgevitals/measurement';
import { describe, expect, it } from 'vitest';
import { demoMeasurements } from '../src/lib/demo';
import { toSubmission } from '../src/lib/measurements';

describe('what the app submits to the API', () => {
  it('turns a scan with no face into an accepted submission with no values', () => {
    const s = new ScanSession();
    for (let i = 0; i < 60; i++)
      s.pushFrame({ t: i * 33, faces: [], roi: null, frameWidth: 640, frameHeight: 480 });
    const body = toSubmission(s.finish(), new Date('2026-11-26T07:15:00Z'));
    expect(submitMeasurementsSchema.safeParse(body).success).toBe(true);
    expect(body.measurements.every((m) => m.value === null)).toBe(true);
    expect(body.measurements.find((m) => m.metric === 'spo2')?.reason).toBe('unsupported_method');
  });

  it('labels demo values as simulated fixtures and never measures SpO2 or BP', () => {
    for (const kind of ['morning', 'evening'] as const) {
      const ms = demoMeasurements(kind);
      expect(
        submitMeasurementsSchema.safeParse({ outcome: 'completed', measurements: ms }).success,
      ).toBe(true);
      for (const m of ms) {
        if (m.metric === 'spo2' || m.metric === 'blood_pressure') expect(m.value).toBeNull();
        else expect(m.status).toBe('simulated');
      }
    }
  });
});
