import { analyzeFingerSession, analyzeSession } from '@edgevitals/measurement';
import { describe, expect, it } from 'vitest';
import { fingerSession } from '../../../packages/measurement/test/fixtures/fingerSynthetic';
import { phoneNoiseSession } from '../../../packages/measurement/test/fixtures/phoneNoise';
import { missingExplanation } from '../src/lib/format';
import { scanFindings } from '../src/lib/scanAdvice';

// SYNTHETIC recordings: they check which advice a scan's own diagnostics
// produce, never a health finding.

describe('what to change next time', () => {
  it('names the weak finger pulse with its measured strength', () => {
    const r = analyzeFingerSession(
      fingerSession({ seed: 3, pulseDepth: 0.006, noise: 0.35 }).frames,
    );
    const ids = scanFindings(r).map((f) => f.id);
    expect(r.metrics.find((m) => m.metric === 'hrv')!.status).not.toBe('valid');
    expect(ids).toContain('finger_weak_pulse');
    const weak = scanFindings(r).find((f) => f.id === 'finger_weak_pulse')!;
    expect(weak.finding).toMatch(/\d\.\d\d% darker/);
    expect(weak.fix).toMatch(/Press lightly/);
  });

  it('gives nothing to fix after a clean finger scan', () => {
    const r = analyzeFingerSession(fingerSession({ seed: 5 }).frames);
    expect(r.outcome).toBe('completed');
    expect(scanFindings(r)).toEqual([]);
  });

  it('points at dim light (low frame rate) and a faint face pulse', () => {
    const r = analyzeSession(phoneNoiseSession({ seed: 11, durationSec: 45, fps: 20 }));
    const ids = scanFindings(r).map((f) => f.id);
    expect(ids).toContain('face_low_fps');
    expect(ids).toContain('face_weak_pulse');
    expect(scanFindings(r).find((f) => f.id === 'face_low_fps')!.finding).toMatch(/20 frames/);
  });

  it('says nothing for a cancelled scan', () => {
    const r = analyzeSession(phoneNoiseSession({ seed: 1, durationSec: 20 }), { cancelled: true });
    expect(scanFindings(r)).toEqual([]);
  });
});

describe('low-confidence heart rate', () => {
  it('explains why PRV and breathing were withheld', () => {
    const ctx = { heartRateValid: true, fingerScan: false, heartRateLowConfidence: true };
    expect(
      missingExplanation(
        { metric: 'hrv', status: 'unavailable', reason: 'low_signal_quality' },
        ctx,
      ),
    ).toMatch(/low-confidence/);
    expect(
      missingExplanation(
        { metric: 'breathing_rate', status: 'unavailable', reason: 'low_signal_quality' },
        ctx,
      ),
    ).toMatch(/too faint/);
  });
});
