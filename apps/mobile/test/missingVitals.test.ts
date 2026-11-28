import { describe, expect, it } from 'vitest';
import { missingExplanation, REASON_COPY } from '../src/lib/format';

const face = { heartRateValid: true, fingerScan: false };
const finger = { heartRateValid: true, fingerScan: true };

describe('why a vital has no value', () => {
  it('gives a specific short note per reason', () => {
    expect(REASON_COPY.low_signal_quality).toBe('Signal too weak');
    expect(REASON_COPY.inconsistent_estimates).toBe('Estimates disagreed');
    expect(REASON_COPY.insufficient_duration).toBe('Scan too short');
  });

  it('explains HRV withheld after heart rate passed', () => {
    const s = missingExplanation(
      { metric: 'hrv', status: 'unavailable', reason: 'low_signal_quality', method: 'finger_ppg' },
      finger,
    );
    expect(s).toMatch(/Heart rate passed/);
  });

  it('folds HRV and breathing into the heart-rate line when heart rate failed', () => {
    const ctx = { heartRateValid: false, fingerScan: false };
    expect(
      missingExplanation(
        { metric: 'hrv', status: 'unavailable', reason: 'low_signal_quality' },
        ctx,
      ),
    ).toBeNull();
    expect(
      missingExplanation(
        { metric: 'heart_rate', status: 'unavailable', reason: 'low_signal_quality' },
        ctx,
      ),
    ).toMatch(/too weak/);
  });

  it('says why SpO2 is missing for each scan type and points to a real source', () => {
    const fingerSpo2 = missingExplanation(
      { metric: 'spo2', status: 'unavailable', reason: 'unsupported_method', method: 'finger_ppg' },
      finger,
    );
    expect(fingerSpo2).toMatch(/finger scan does not estimate SpO₂/);
    expect(fingerSpo2).toMatch(/pulse oximeter/);
    expect(
      missingExplanation(
        {
          metric: 'spo2',
          status: 'unavailable',
          reason: 'unsupported_method',
          method: 'camera_rppg',
        },
        face,
      ),
    ).toMatch(/Settings/);
    // Out of range never reads as a low-oxygen finding.
    const oor = missingExplanation(
      {
        metric: 'spo2',
        status: 'invalid',
        reason: 'out_of_operating_range',
        method: 'camera_experimental',
      },
      face,
    );
    expect(oor).toMatch(/cannot detect low oxygen/);
  });

  it('points blood pressure to the cuff and health app', () => {
    expect(
      missingExplanation(
        { metric: 'blood_pressure', status: 'unavailable', reason: 'unsupported_method' },
        face,
      ),
    ).toMatch(/cuff/);
  });

  it('says nothing for valid values or cancelled scans', () => {
    expect(missingExplanation({ metric: 'heart_rate', status: 'valid' }, face)).toBeNull();
    expect(
      missingExplanation({ metric: 'hrv', status: 'unavailable', reason: 'cancelled' }, face),
    ).toBeNull();
  });
});
