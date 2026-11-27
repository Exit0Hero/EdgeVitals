import type {
  BaselineProgress,
  DailyScores,
  Insight,
  ReportProgress,
  RelativeStatus,
  TrendSeries,
} from '@edgevitals/domain';
import { tokenStore } from '../lib/secureStore';

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000').replace(
  /\/$/,
  '',
);
const REFRESH_KEY = 'ev.refresh';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
  get offline() {
    return this.status === 0;
  }
}

type Listener = (signedIn: boolean) => void;

/** Minimal typed client with access-token refresh and a single in-flight refresh. */
class Client {
  private access: string | null = null;
  private refreshing: Promise<boolean> | null = null;
  private listeners = new Set<Listener>();

  onAuthChange(l: Listener) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  private emit(v: boolean) {
    this.listeners.forEach((l) => l(v));
  }

  async restore(): Promise<boolean> {
    if (this.access) return true;
    return this.tryRefresh();
  }

  async setTokens(t: { access_token: string; refresh_token: string }) {
    this.access = t.access_token;
    await tokenStore.set(REFRESH_KEY, t.refresh_token);
    this.emit(true);
  }

  async clear() {
    this.access = null;
    await tokenStore.remove(REFRESH_KEY);
    this.emit(false);
  }

  private tryRefresh(): Promise<boolean> {
    this.refreshing ??= (async () => {
      const rt = await tokenStore.get(REFRESH_KEY);
      if (!rt) return false;
      try {
        const t = await this.raw<{ access_token: string; refresh_token: string }>(
          'POST',
          '/api/v1/auth/refresh',
          {
            refresh_token: rt,
          },
        );
        await this.setTokens(t);
        return true;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) await this.clear();
        return false;
      }
    })().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async raw<T>(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${API_URL}${path}`, {
        method,
        headers: {
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(this.access ? { authorization: `Bearer ${this.access}` } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError(
        0,
        'offline',
        'You appear to be offline. Check your connection and try again.',
      );
    }
    if (res.status === 204) return undefined as T;
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = (json as { error?: { code?: string; message?: string; details?: unknown } }).error;
      throw new ApiError(
        res.status,
        e?.code ?? 'error',
        e?.message ?? 'Something went wrong',
        e?.details,
      );
    }
    return json as T;
  }

  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<T> {
    try {
      return await this.raw<T>(method, path, body, headers);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401 && !path.startsWith('/api/v1/auth/')) {
        if (await this.tryRefresh()) return this.raw<T>(method, path, body, headers);
        await this.clear();
      }
      throw e;
    }
  }
}

export const client = new Client();

// ───────── types ─────────
export interface ConsentState {
  active: boolean;
  record_id: string | null;
  policy_version: string | null;
}
export interface Me {
  id: string;
  email: string;
  profile: {
    birth_year: number;
    sex_at_birth: 'female' | 'male';
    height_cm: number;
    weight_kg: number;
  } | null;
  schedule: {
    morning_time: string;
    evening_time: string;
    timezone: string;
    reminders_enabled: boolean;
    heart_rate_affecting_substance: 'no' | 'yes' | 'skip' | null;
  } | null;
  consents: Record<
    'processing' | 'wellness_acknowledgement' | 'anonymous_improvement',
    ConsentState
  >;
  required_consents_granted: boolean;
  onboarding_complete: boolean;
}
export interface MeasurementOut {
  metric: 'heart_rate' | 'hrv' | 'breathing_rate' | 'spo2' | 'blood_pressure';
  status: 'valid' | 'unavailable' | 'invalid' | 'simulated';
  value: number | null;
  value_secondary: number | null;
  unit: string;
  quality_score: number | null;
  reason: string | null;
  method: string;
  algorithm_name: string;
  algorithm_version: string;
  validation: string;
  measured_at: string;
}
export interface Assessment {
  id: string;
  kind: 'morning' | 'evening';
  status: string;
  started_at: string;
  completed_at: string | null;
  timezone: string;
  attempt_number: number;
  demo: boolean;
  check_in: {
    kind: 'morning' | 'evening';
    sleep_quality: number | null;
    energy_rating: number;
    stress_rating: number | null;
    alcohol_previous_evening: boolean | null;
  } | null;
  measurements: MeasurementOut[];
}
export interface VitalsSummary {
  assessment_id: string;
  kind: 'morning' | 'evening';
  started_at: string;
  status: string;
  metrics: {
    metric: MeasurementOut['metric'];
    status: string;
    value: number | null;
    value_secondary?: number | null;
    method?: string | null;
    relative: RelativeStatus;
  }[];
}
export interface Dashboard {
  date: string;
  timezone: string;
  streak: number;
  baseline: BaselineProgress;
  today: {
    morning: { assessment_id: string; status: string } | null;
    evening: { assessment_id: string; status: string } | null;
  };
  scores: DailyScores;
  score_usual: { recovery: number | null; stress: number | null; energy: number | null };
  last_assessment: VitalsSummary | null;
  morning_vitals: VitalsSummary | null;
  progress: {
    recovery: TrendSeries | null;
    resting_heart_rate: { first: number; recent: number; sample_count: number } | null;
    hrv: { first: number; recent: number; sample_count: number } | null;
  };
  insight: Insight | null;
  report: ReportProgress;
}
export type Trends = TrendSeries & {
  insight: Insight | null;
  summaries: {
    resting_heart_rate: { value: number | null; relative: RelativeStatus; sample_count: number };
    /** Latest licensed-SDK reading in the period (ADR 0007), else nulls. */
    blood_pressure: {
      value: number | null;
      value_secondary: number | null;
      measured_at: string | null;
      source: string | null;
      relative: 'unavailable';
      reason: string | null;
    };
  };
};

export interface CuffReading {
  id: string;
  systolic: number;
  diastolic: number;
  pulse_bpm: number | null;
  measured_at: string;
  created_at: string;
}

// ───────── endpoints ─────────
type Tokens = { access_token: string; refresh_token: string };
export const api = {
  register: (email: string, password: string) =>
    client.request<Tokens>('POST', '/api/v1/auth/register', { email, password }),
  login: (email: string, password: string) =>
    client.request<Tokens>('POST', '/api/v1/auth/login', { email, password }),
  logout: (refresh_token: string) =>
    client.request<void>('POST', '/api/v1/auth/logout', { refresh_token }),
  config: () =>
    client.request<{ hosting_region: string | null; demo_mode_enabled: boolean }>(
      'GET',
      '/api/v1/config',
    ),
  me: () => client.request<Me>('GET', '/api/v1/me'),
  grantConsent: (consent_type: string, granted: boolean, policy_version: string) =>
    client.request('POST', '/api/v1/me/consents', {
      consent_type,
      granted,
      policy_version,
      source: 'mobile-app',
    }),
  withdrawConsent: (id: string) => client.request('POST', `/api/v1/me/consents/${id}/withdraw`),
  saveProfile: (p: NonNullable<Me['profile']>) => client.request('PATCH', '/api/v1/me/profile', p),
  saveSchedule: (s: NonNullable<Me['schedule']>) => client.request('PUT', '/api/v1/me/schedule', s),
  createAssessment: (
    kind: 'morning' | 'evening',
    scheduled_for: string,
    timezone: string,
    idempotencyKey: string,
    demo = false,
  ) =>
    client.request<Assessment>(
      'POST',
      '/api/v1/assessments',
      { kind, scheduled_for, timezone, ...(demo ? { demo: true } : {}) },
      { 'idempotency-key': idempotencyKey },
    ),
  getAssessment: (id: string) => client.request<Assessment>('GET', `/api/v1/assessments/${id}`),
  setStatus: (id: string, status: string) =>
    client.request<Assessment>('PATCH', `/api/v1/assessments/${id}/status`, { status }),
  checkIn: (id: string, body: unknown) =>
    client.request<Assessment>('POST', `/api/v1/assessments/${id}/check-in`, body),
  submitMeasurements: (id: string, body: unknown) =>
    client.request<Assessment>('POST', `/api/v1/assessments/${id}/measurements`, body),
  dashboard: () => client.request<Dashboard>('GET', '/api/v1/dashboard/today'),
  cuffReadings: (days = 90) =>
    client.request<{ items: CuffReading[] }>('GET', `/api/v1/blood-pressure?days=${days}`),
  addCuffReading: (r: {
    systolic: number;
    diastolic: number;
    pulse_bpm: number | null;
    measured_at: string;
  }) => client.request<CuffReading>('POST', '/api/v1/blood-pressure', r),
  deleteCuffReading: (id: string) => client.request<void>('DELETE', `/api/v1/blood-pressure/${id}`),
  trends: (metric: string, period: string) =>
    client.request<Trends>('GET', `/api/v1/trends?metric=${metric}&period=${period}`),
  requestExport: (key: string) =>
    client.request<{ id: string; status: string }>('POST', '/api/v1/me/export', undefined, {
      'idempotency-key': key,
    }),
  exportUrl: (id: string) => `${API_URL}/api/v1/me/export/${id}/download`,
  downloadExport: (id: string) =>
    client.request<unknown>('GET', `/api/v1/me/export/${id}/download`),
  deleteAccount: (password: string) =>
    client.request<{ id: string; status: string }>('POST', '/api/v1/me/deletion-request', {
      confirm: 'DELETE',
      password,
    }),
};
