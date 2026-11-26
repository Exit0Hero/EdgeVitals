import type { AssessmentRecord } from '../src/analytics';

let n = 0;
export function morning(
  date: string,
  hr: number | null,
  hrv: number | null,
  opts: {
    sleep?: number;
    energy?: number;
    alcohol?: boolean;
    demo?: boolean;
    status?: AssessmentRecord['status'];
    tz?: string;
    time?: string;
  } = {},
): AssessmentRecord {
  return {
    id: `m${++n}`,
    kind: 'morning',
    status: opts.status ?? 'completed',
    startedAt: `${date}T${opts.time ?? '07:15:00'}Z`,
    timezone: opts.tz ?? 'UTC',
    demo: opts.demo ?? false,
    checkIn: {
      kind: 'morning',
      sleep_quality: opts.sleep ?? 4,
      energy_rating: opts.energy ?? 3,
      alcohol_previous_evening: opts.alcohol ?? false,
    },
    measurements: [
      { metric: 'heart_rate', status: hr === null ? 'unavailable' : 'valid', value: hr },
      { metric: 'hrv', status: hrv === null ? 'unavailable' : 'valid', value: hrv },
      { metric: 'spo2', status: 'unavailable', value: null },
    ],
  };
}

export function evening(
  date: string,
  hr: number | null,
  hrv: number | null,
  stress = 2,
  energy = 3,
): AssessmentRecord {
  return {
    id: `e${++n}`,
    kind: 'evening',
    status: 'completed',
    startedAt: `${date}T21:00:00Z`,
    timezone: 'UTC',
    demo: false,
    checkIn: { kind: 'evening', stress_rating: stress, energy_rating: energy },
    measurements: [
      { metric: 'heart_rate', status: hr === null ? 'unavailable' : 'valid', value: hr },
      { metric: 'hrv', status: hrv === null ? 'unavailable' : 'valid', value: hrv },
    ],
  };
}

export const day = (i: number) => new Date(Date.UTC(2026, 10, 1 + i)).toISOString().slice(0, 10);
