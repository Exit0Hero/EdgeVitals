import type { RelativeStatus } from '@edgevitals/domain';
import type { Tone } from '../components/ui';

export const METRIC_SHORT: Record<string, string> = {
  heart_rate: 'Heart rate',
  hrv: 'HRV',
  breathing_rate: 'Breathing',
  spo2: 'SpO₂',
  blood_pressure: 'Blood pressure',
};
export const METRIC_LONG: Record<string, string> = {
  ...METRIC_SHORT,
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

export const REASON_COPY: Record<string, string> = {
  unsupported_method: 'Not available',
  insufficient_duration: 'Scan too short',
  low_signal_quality: 'No reliable reading',
  inconsistent_estimates: 'No reliable reading',
  out_of_operating_range: 'No reliable reading',
  cancelled: 'Cancelled',
};
