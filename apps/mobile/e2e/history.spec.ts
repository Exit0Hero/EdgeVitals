import AxeBuilder from '@axe-core/playwright';
import { expect, request, test, type APIRequestContext } from '@playwright/test';
import pg from 'pg';

/**
 * Screens that need weeks of history (Today with scores, Trends with a chart).
 *
 * TEST FIXTURES ONLY: the values below are hand-written numbers submitted to a
 * local development database and labelled `algorithm_name: 'e2e-fixture'`.
 * They are not measurements. The spec refuses to run against anything but a
 * local database.
 */
const DB = process.env.E2E_DATABASE_URL;
const API = process.env.E2E_API_URL ?? 'http://localhost:4000';
const shots = process.env.E2E_SCREENSHOTS;

test.skip(!DB, 'set E2E_DATABASE_URL to a local database to run history tests');
test.beforeAll(() => {
  if (DB && !/@(localhost|127\.0\.0\.1)[:/]/.test(DB))
    throw new Error('history fixtures only run against a local database');
});

const m = (metric: string, value: number | null, unit: string) => ({
  metric,
  status: value === null ? 'unavailable' : 'valid',
  value,
  unit,
  quality_score: value === null ? null : 0.8,
  quality_flags: [],
  reason: value === null ? 'unsupported_method' : null,
  method: 'camera_rppg',
  algorithm_name: 'e2e-fixture',
  algorithm_version: '0.0.0',
  config_version: 'e2e',
  validation: 'unvalidated',
  measured_at: new Date().toISOString(),
});

async function seed(api: APIRequestContext, email: string, password: string, days: number) {
  const reg = await api.post('/api/v1/auth/register', { data: { email, password } });
  expect(reg.ok()).toBeTruthy();
  const headers = { authorization: `Bearer ${(await reg.json()).access_token}` };
  for (const consent_type of ['processing', 'wellness_acknowledgement'])
    await api.post('/api/v1/me/consents', {
      headers,
      data: { consent_type, granted: true, policy_version: '2026-11-26.1', source: 'e2e' },
    });
  await api.patch('/api/v1/me/profile', {
    headers,
    data: { birth_year: 1990, sex_at_birth: 'female', height_cm: 168, weight_kg: 62 },
  });
  await api.put('/api/v1/me/schedule', {
    headers,
    data: {
      morning_time: '07:15',
      evening_time: '21:00',
      timezone: 'UTC',
      reminders_enabled: true,
      heart_rate_affecting_substance: 'no',
    },
  });

  const db = new pg.Client({ connectionString: DB });
  await db.connect();
  try {
    for (let i = days - 1; i >= 0; i--) {
      const good = i % 4 !== 1;
      const a = await api.post('/api/v1/assessments', {
        headers,
        data: { kind: 'morning', scheduled_for: new Date().toISOString(), timezone: 'UTC' },
      });
      const { id } = await a.json();
      await api.post(`/api/v1/assessments/${id}/check-in`, {
        headers,
        data: {
          kind: 'morning',
          sleep_quality: good ? 4 : 2,
          energy_rating: good ? 4 : 2,
          alcohol_previous_evening: false,
        },
      });
      const res = await api.post(`/api/v1/assessments/${id}/measurements`, {
        headers,
        data: {
          outcome: 'completed',
          measurements: [
            m('heart_rate', good ? 57 + (i % 3) : 63, 'bpm'),
            m('hrv', good ? 52 + (i % 5) : 43 + (i % 3), 'ms'),
            m('breathing_rate', 13 + (i % 2), '/min'),
            m('spo2', null, '%'),
            m('blood_pressure', null, 'mmHg'),
          ],
        },
      });
      expect(res.ok()).toBeTruthy();
      await db.query(
        `UPDATE assessments SET started_at = date_trunc('day', now()) - ($2::int * interval '1 day') + interval '7 hours 12 minutes',
           scheduled_for = date_trunc('day', now()) - ($2::int * interval '1 day') + interval '7 hours 15 minutes' WHERE id = $1`,
        [id, i],
      );
    }
  } finally {
    await db.end();
  }
}

test('a mature history shows scores, a trend chart and an insight', async ({ page }) => {
  const api = await request.newContext({ baseURL: API });
  const email = `e2e-history-${Date.now()}@example.test`;
  const password = 'fixture history 2026';
  await seed(api, email, password, 23);

  await page.goto('/sign-in');
  await page.getByTestId('email').fill(email);
  await page.getByTestId('password').fill(password);
  await page.getByTestId('sign-in-submit').click();
  await expect(page.getByTestId('screen-today')).toBeVisible();
  await expect(page.getByTestId('recovery-hero')).toBeVisible();
  await expect(page.getByTestId('streak')).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/10-today-mature.png`, fullPage: true });

  await page.getByRole('link', { name: 'Trends', exact: true }).click();
  await expect(page.getByTestId('trend-average')).toContainText('ms');
  await expect(page.getByTestId('sample-count')).toContainText('23 readings');
  if (shots) await page.screenshot({ path: `${shots}/12-trends-mature.png` });

  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);

  await page.getByTestId('metric-breathing_rate').click();
  await expect(page.getByTestId('trend-average')).toContainText('/min');

  await page.getByTestId('metric-recovery').click();
  await expect(page.getByTestId('trend-average')).not.toHaveText('—');
  await api.dispose();
});
