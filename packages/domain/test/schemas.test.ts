import { describe, expect, it } from 'vitest';
import {
  checkInSchema,
  measurementSchema,
  profileSchema,
  registerSchema,
  scheduleSchema,
} from '../src/schemas';

const base = {
  metric: 'heart_rate' as const,
  status: 'valid' as const,
  value: 62,
  unit: 'bpm',
  quality_score: 0.8,
  quality_flags: [],
  reason: null,
  method: 'camera_rppg' as const,
  algorithm_name: 'pos-welch',
  algorithm_version: '0.1.0',
  config_version: 'v0',
  validation: 'unvalidated' as const,
  measured_at: '2026-11-26T07:18:00Z',
};

describe('measurement schema', () => {
  it('accepts a valid measurement', () => {
    expect(measurementSchema.safeParse(base).success).toBe(true);
  });
  it('rejects a valid status without a value and an unavailable status with one', () => {
    expect(measurementSchema.safeParse({ ...base, value: null }).success).toBe(false);
    expect(
      measurementSchema.safeParse({ ...base, status: 'unavailable', reason: 'low_signal_quality' })
        .success,
    ).toBe(false);
  });
  it('rejects mismatched units and out-of-range values', () => {
    expect(measurementSchema.safeParse({ ...base, unit: 'ms' }).success).toBe(false);
    expect(measurementSchema.safeParse({ ...base, value: 400 }).success).toBe(false);
  });
  it('never accepts SpO2 or blood pressure as valid', () => {
    expect(
      measurementSchema.safeParse({ ...base, metric: 'spo2', unit: '%', value: 98 }).success,
    ).toBe(false);
    expect(
      measurementSchema.safeParse({
        ...base,
        metric: 'blood_pressure',
        unit: 'mmHg',
        value: 120,
        value_secondary: 80,
      }).success,
    ).toBe(false);
  });
  it('keeps simulated values tied to demo fixtures', () => {
    expect(measurementSchema.safeParse({ ...base, status: 'simulated' }).success).toBe(false);
    expect(
      measurementSchema.safeParse({ ...base, status: 'simulated', method: 'demo_fixture' }).success,
    ).toBe(true);
    expect(measurementSchema.safeParse({ ...base, method: 'demo_fixture' }).success).toBe(false);
  });
});

describe('form schemas', () => {
  it('validates check-in ratings 1-5', () => {
    expect(
      checkInSchema.safeParse({
        kind: 'morning',
        sleep_quality: 4,
        energy_rating: 3,
        alcohol_previous_evening: false,
      }).success,
    ).toBe(true);
    expect(
      checkInSchema.safeParse({
        kind: 'morning',
        sleep_quality: 6,
        energy_rating: 3,
        alcohol_previous_evening: false,
      }).success,
    ).toBe(false);
    expect(
      checkInSchema.safeParse({ kind: 'evening', stress_rating: 0, energy_rating: 3 }).success,
    ).toBe(false);
    expect(
      checkInSchema.safeParse({ kind: 'morning', sleep_quality: 4, energy_rating: 3 }).success,
    ).toBe(false);
  });
  it('validates profile bounds', () => {
    expect(
      profileSchema.safeParse({
        birth_year: 1985,
        sex_at_birth: 'female',
        height_cm: 175,
        weight_kg: 70,
      }).success,
    ).toBe(true);
    expect(
      profileSchema.safeParse({
        birth_year: 1800,
        sex_at_birth: 'female',
        height_cm: 175,
        weight_kg: 70,
      }).success,
    ).toBe(false);
    expect(
      profileSchema.safeParse({
        birth_year: 1985,
        sex_at_birth: 'female',
        height_cm: 20,
        weight_kg: 70,
      }).success,
    ).toBe(false);
  });
  it('validates schedule times and IANA zones', () => {
    const ok = {
      morning_time: '07:15',
      evening_time: '21:00',
      timezone: 'Asia/Kolkata',
      reminders_enabled: true,
    };
    expect(scheduleSchema.safeParse(ok).success).toBe(true);
    expect(scheduleSchema.safeParse({ ...ok, morning_time: '7:15' }).success).toBe(false);
    expect(scheduleSchema.safeParse({ ...ok, timezone: 'Mars/Olympus' }).success).toBe(false);
  });
  it('requires a reasonably strong password', () => {
    expect(registerSchema.safeParse({ email: 'a@b.co', password: 'short1' }).success).toBe(false);
    expect(
      registerSchema.safeParse({ email: 'A@B.co ', password: 'longenough123' }).data?.email,
    ).toBe('a@b.co');
  });
});
