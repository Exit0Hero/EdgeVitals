import type { RelativeStatus } from '@edgevitals/domain';
import type { Tone } from '../components/ui';

export const METRIC_SHORT: Record<string, string> = {
  heart_rate: 'Heart rate',
  hrv: 'PRV',
  breathing_rate: 'Breathing',
  spo2: 'SpO₂',
  blood_pressure: 'Blood pressure',
};
export const METRIC_LONG: Record<string, string> = {
  ...METRIC_SHORT,
  // Camera and fingertip beats are pulse intervals, not ECG R-R intervals, so
  // the interval metric is pulse-rate variability (metric id stays 'hrv').
  hrv: 'Pulse-rate variability (PRV)',
  breathing_rate: 'Breathing rate',
};
export const METRIC_UNIT: Record<string, string> = {
  heart_rate: 'bpm',
  hrv: 'ms',
  breathing_rate: '/min',
  spo2: '%',
  blood_pressure: 'mmHg',
};

export function longDate(d: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone,
  }).format(d);
}

export function timeOfDay(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  }).format(new Date(iso));
}

export function greeting(d: Date): string {
  const h = d.getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

/** "yesterday 21:04", "today 07:18", or "24 Nov 21:04". */
export function relativeWhen(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  const t = timeOfDay(iso);
  if (diff === 0) return `today ${t}`;
  if (diff === 1) return `yesterday ${t}`;
  return `${new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(d)} ${t}`;
}

export function relativeLabel(r: RelativeStatus): { label: string; tone: Tone } | null {
  switch (r) {
    case 'typical':
      return { label: 'Typical', tone: 'primary' };
    case 'higher':
      return { label: 'Higher', tone: 'warning' };
    case 'lower':
      return { label: 'Lower', tone: 'warning' };
    case 'no_baseline':
      return { label: 'Learning', tone: 'muted' };
    default:
      return null;
  }
}

/** Short note shown in place of a missing value. Older records without a reason say "No reliable reading". */
export const REASON_COPY: Record<string, string> = {
  unsupported_method: 'Not available',
  insufficient_duration: 'Scan too short',
  low_signal_quality: 'Signal too weak',
  inconsistent_estimates: 'Estimates disagreed',
  out_of_operating_range: 'Out of range',
  cancelled: 'Cancelled',
};

export interface MissingVital {
  metric: string;
  status: string;
  reason?: string | null;
  method?: string | null;
  quality_flags?: string[] | null;
}

/** Plain explanation of a "Low confidence" label, per vital. */
export const LOW_CONFIDENCE_COPY: Record<string, string> = {
  heart_rate:
    'The strict checks could not confirm this heart rate, but a simpler single-method check found the same steady rhythm through most of the scan. Treat it as a rough reading. It is not added to your baseline or scores.',
  breathing_rate:
    'Two breathing signals agreed closely, but the rhythm was less clear than a confident reading needs. Treat it as a rough reading. It is not added to your baseline or scores.',
};

/**
 * One plain sentence on why a vital has no value and what the person can do.
 * Null for valid values and cancelled scans. Never implies a health finding.
 */
export function missingExplanation(
  v: MissingVital,
  ctx: { heartRateValid: boolean; fingerScan: boolean; heartRateLowConfidence?: boolean },
): string | null {
  if (v.status === 'valid' || v.status === 'simulated' || v.reason === 'cancelled') return null;
  const r = v.reason ?? 'low_signal_quality';
  const tooShort = 'There was not enough steady signal. Keep still until the scan ends.';
  switch (v.metric) {
    case 'heart_rate':
      return r === 'insufficient_duration'
        ? tooShort
        : 'The pulse in the camera signal was too weak or unsteady to count reliably.';
    case 'hrv':
      if (!ctx.heartRateValid) return null;
      if (ctx.heartRateLowConfidence)
        return 'Heart rate only came through as a low-confidence estimate, and PRV needs a much stronger pulse than that, so it was withheld.';
      if (r === 'insufficient_duration')
        return 'PRV needs a longer steady stretch than heart rate. Keep still until the scan ends.';
      if (r === 'inconsistent_estimates')
        return 'The timing of the individual beats did not match the heart rate, so PRV was withheld.';
      if (r === 'out_of_operating_range')
        return 'The PRV estimate fell outside the range the app can measure, so it was withheld.';
      return 'Heart rate passed, but PRV needs the exact timing of every beat and this signal was not clean enough. A steadier scan helps.';
    case 'breathing_rate':
      if (!ctx.heartRateValid && r !== 'insufficient_duration') return null;
      if (ctx.heartRateLowConfidence && r !== 'insufficient_duration')
        return 'The pulse was too faint to read the breathing rhythm from it, so breathing was withheld.';
      if (r === 'insufficient_duration')
        return 'Breathing rate needs a longer steady stretch. Keep still until the scan ends.';
      if (r === 'inconsistent_estimates')
        return 'Two independent breathing estimates disagreed, so neither is shown.';
      return 'The breathing rhythm was not clear enough in the signal. Breathe normally and keep still.';
    case 'spo2':
      if (v.method === 'licensed_sdk' || v.method === 'camera_experimental') {
        if (r === 'out_of_operating_range')
          return 'The experimental SpO₂ estimate came out outside the 90–100% it can report, so it was withheld. It cannot detect low oxygen: use a pulse oximeter if you are concerned.';
        if (r === 'insufficient_duration')
          return 'The experimental SpO₂ estimate needs a longer steady scan.';
        return 'The experimental SpO₂ estimate needs a clearer pulse than this scan had.';
      }
      return ctx.fingerScan || v.method === 'finger_ppg'
        ? "The finger scan does not estimate SpO₂: the published camera method is calibrated for daylight on the face, not the phone's flash. Sync a pulse oximeter from your health app to see SpO₂ here."
        : 'Camera SpO₂ is off. You can turn on the experimental estimate in Settings, under Experimental estimates, or sync a pulse oximeter from your health app.';
    case 'blood_pressure':
      return v.method === 'licensed_sdk'
        ? 'The camera blood-pressure estimate needs a clearer signal than this scan had.'
        : 'The phone camera cannot measure blood pressure. Log a reading from your cuff, or sync one from your health app.';
    default:
      return null;
  }
}
