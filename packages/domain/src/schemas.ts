import { z } from 'zod';

/** Shared API contract schemas (docs/spec/07_API_CONTRACT.md). */

export const METRICS = ['heart_rate', 'hrv', 'breathing_rate', 'spo2', 'blood_pressure'] as const;
export type Metric = (typeof METRICS)[number];

export const METRIC_UNIT: Record<Metric, string> = {
  heart_rate: 'bpm',
  hrv: 'ms',
  breathing_rate: '/min',
  spo2: '%',
  blood_pressure: 'mmHg',
};

export const METRIC_LABEL: Record<Metric, string> = {
  heart_rate: 'Heart rate',
  hrv: 'HRV',
  breathing_rate: 'Breathing rate',
  spo2: 'SpO₂',
  blood_pressure: 'Blood pressure',
};

const CURRENT_YEAR = new Date().getUTCFullYear();

export const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(200)
  .refine((p) => /[A-Za-z]/.test(p) && /[0-9]/.test(p), 'Use letters and numbers');

export const registerSchema = z.object({ email: emailSchema, password: passwordSchema });
export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(200) });
export const refreshSchema = z.object({ refresh_token: z.string().min(20).max(200) });

export const SEX_AT_BIRTH = ['female', 'male'] as const;

export const profileSchema = z.object({
  birth_year: z
    .number()
    .int()
    .min(CURRENT_YEAR - 110)
    .max(CURRENT_YEAR - 13, 'You must be at least 13'),
  sex_at_birth: z.enum(SEX_AT_BIRTH),
  height_cm: z.number().min(100).max(250),
  weight_kg: z.number().min(30).max(300),
});
export type Profile = z.infer<typeof profileSchema>;
export const profilePatchSchema = profileSchema.partial();

export const CONSENT_TYPES = [
  'processing',
  'wellness_acknowledgement',
  'anonymous_improvement',
] as const;
export type ConsentType = (typeof CONSENT_TYPES)[number];
export const REQUIRED_CONSENTS: readonly ConsentType[] = ['processing', 'wellness_acknowledgement'];
export const CONSENT_POLICY_VERSION = '2026-11-26.1';

export const consentGrantSchema = z.object({
  consent_type: z.enum(CONSENT_TYPES),
  granted: z.boolean(),
  policy_version: z.string().min(1).max(40),
  source: z.string().min(1).max(60),
});

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const timezoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(isValidTimeZone, 'Unknown time zone');

export const HR_AFFECTING_RESPONSES = ['no', 'yes', 'skip'] as const;

export const scheduleSchema = z.object({
  morning_time: hhmm,
  evening_time: hhmm,
  timezone: timezoneSchema,
  reminders_enabled: z.boolean(),
  heart_rate_affecting_substance: z.enum(HR_AFFECTING_RESPONSES).nullable().optional(),
});
export type Schedule = z.infer<typeof scheduleSchema>;
export const DEFAULT_SCHEDULE = { morning_time: '07:15', evening_time: '21:00' } as const;

export const ASSESSMENT_KINDS = ['morning', 'evening'] as const;
export type AssessmentKind = (typeof ASSESSMENT_KINDS)[number];

export const ASSESSMENT_STATUSES = [
  'not_started',
  'check_in_in_progress',
  'check_in_complete',
  'scan_preparation',
  'permission_pending',
  'capturing',
  'quality_check',
  'processing',
  'completed',
  'partial',
  'failed',
  'cancelled',
] as const;
export type AssessmentStatus = (typeof ASSESSMENT_STATUSES)[number];
export const TERMINAL_STATUSES: readonly AssessmentStatus[] = [
  'completed',
  'partial',
  'failed',
  'cancelled',
];

export const createAssessmentSchema = z.object({
  kind: z.enum(ASSESSMENT_KINDS),
  scheduled_for: z.iso.datetime({ offset: true }),
  timezone: timezoneSchema,
  demo: z.boolean().optional(),
});

const rating = z.number().int().min(1).max(5);

export const morningCheckInSchema = z.object({
  kind: z.literal('morning'),
  sleep_quality: rating,
  energy_rating: rating,
  alcohol_previous_evening: z.boolean(),
});
export const eveningCheckInSchema = z.object({
  kind: z.literal('evening'),
  stress_rating: rating,
  energy_rating: rating,
});
export const checkInSchema = z.discriminatedUnion('kind', [
  morningCheckInSchema,
  eveningCheckInSchema,
]);
export type CheckIn = z.infer<typeof checkInSchema>;

export const MEASUREMENT_STATUSES = ['valid', 'unavailable', 'invalid', 'simulated'] as const;
export type MeasurementStatus = (typeof MEASUREMENT_STATUSES)[number];

/** Operating ranges accepted by the API, per metric. */
export const METRIC_BOUNDS: Record<Metric, [number, number]> = {
  heart_rate: [30, 220],
  hrv: [1, 300],
  breathing_rate: [3, 60],
  spo2: [50, 100],
  blood_pressure: [50, 260],
};

export const measurementSchema = z
  .object({
    metric: z.enum(METRICS),
    status: z.enum(MEASUREMENT_STATUSES),
    value: z.number().finite().nullable(),
    value_secondary: z.number().finite().nullable().optional(),
    unit: z.string(),
    quality_score: z.number().min(0).max(1).nullable(),
    quality_flags: z.array(z.string().max(40)).max(20),
    reason: z.string().max(40).nullable(),
    method: z.enum(['camera_rppg', 'demo_fixture', 'licensed_sdk', 'camera_experimental']),
    algorithm_name: z.string().min(1).max(60),
    algorithm_version: z.string().regex(/^\d+\.\d+\.\d+$/),
    config_version: z.string().min(1).max(60),
    validation: z.enum(['unvalidated', 'validated']),
    measured_at: z.iso.datetime({ offset: true }),
  })
  .superRefine((m, ctx) => {
    if (m.unit !== METRIC_UNIT[m.metric])
      ctx.addIssue({
        code: 'custom',
        message: `unit must be ${METRIC_UNIT[m.metric]}`,
        path: ['unit'],
      });
    const hasValue = m.value !== null;
    if ((m.status === 'valid' || m.status === 'simulated') && !hasValue)
      ctx.addIssue({
        code: 'custom',
        message: 'valid/simulated requires a value',
        path: ['value'],
      });
    if ((m.status === 'unavailable' || m.status === 'invalid') && hasValue)
      ctx.addIssue({
        code: 'custom',
        message: 'unavailable/invalid must not carry a value',
        path: ['value'],
      });
    if (hasValue) {
      const [lo, hi] = METRIC_BOUNDS[m.metric];
      if (m.value! < lo || m.value! > hi)
        ctx.addIssue({ code: 'custom', message: 'value outside operating range', path: ['value'] });
    }
    if (m.status === 'simulated' && m.method !== 'demo_fixture')
      ctx.addIssue({
        code: 'custom',
        message: 'simulated values must come from demo_fixture',
        path: ['method'],
      });
    if (m.method === 'demo_fixture' && m.status === 'valid')
      ctx.addIssue({
        code: 'custom',
        message: 'demo fixtures cannot be valid measurements',
        path: ['status'],
      });
    // SpO2 and blood pressure have no EdgeVitals camera method (ADR 0004). They
    // are accepted only from a licensed SDK, which may report nothing else (ADR 0007).
    const sdkMetric = m.metric === 'spo2' || m.metric === 'blood_pressure';
    // Experimental camera SpO2 (ADR 0008) is the only opt-in research estimator.
    const allowedValid =
      m.method === 'licensed_sdk' || (m.metric === 'spo2' && m.method === 'camera_experimental');
    if (sdkMetric && m.status === 'valid' && !allowedValid)
      ctx.addIssue({
        code: 'custom',
        message: `${m.metric} is only accepted from a licensed SDK or the experimental SpO2 estimator`,
        path: ['method'],
      });
    if (m.method === 'camera_experimental' && m.metric !== 'spo2')
      ctx.addIssue({
        code: 'custom',
        message: 'experimental camera estimates are only accepted for spo2',
        path: ['method'],
      });
    if (!sdkMetric && m.method === 'licensed_sdk')
      ctx.addIssue({
        code: 'custom',
        message: 'licensed SDKs may only report spo2 and blood_pressure',
        path: ['method'],
      });
    if (m.metric === 'blood_pressure' && m.status === 'valid') {
      const dia = m.value_secondary;
      if (dia === null || dia === undefined || m.value === null || dia >= m.value)
        ctx.addIssue({
          code: 'custom',
          message: 'blood pressure needs a diastolic value below systolic',
          path: ['value_secondary'],
        });
    }
  });
export type MeasurementInput = z.infer<typeof measurementSchema>;

export const submitMeasurementsSchema = z.object({
  outcome: z.enum(['completed', 'partial', 'failed', 'cancelled']),
  measurements: z.array(measurementSchema).min(1).max(10),
  diagnostics: z
    .object({
      usable_duration_sec: z.number().min(0).max(600),
      usable_frame_fraction: z.number().min(0).max(1),
      hr_snr_db: z.number().nullable(),
    })
    .optional(),
});

export const TREND_METRICS = ['recovery', 'stress', 'energy', 'hrv', 'heart_rate'] as const;
export type TrendMetric = (typeof TREND_METRICS)[number];
export const TREND_PERIODS = ['7d', '30d', '90d'] as const;
export type TrendPeriod = (typeof TREND_PERIODS)[number];
export const PERIOD_DAYS: Record<TrendPeriod, number> = { '7d': 7, '30d': 30, '90d': 90 };

export const trendsQuerySchema = z.object({
  metric: z.enum(TREND_METRICS),
  period: z.enum(TREND_PERIODS),
});
