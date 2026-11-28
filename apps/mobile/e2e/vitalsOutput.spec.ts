import { expect, request, test } from '@playwright/test';

/**
 * Every vital on the results and Today screens shows either a value or a
 * specific reason, never an unexplained dash.
 *
 * TEST FIXTURES ONLY: hand-written values submitted to the local API and
 * labelled `algorithm_name: 'e2e-fixture'`. They are not measurements. The
 * shape copies a real finger scan where heart rate passed and PRV and
 * breathing were withheld for signal quality.
 */
const API = process.env.E2E_API_URL ?? 'http://localhost:4000';
const shots = process.env.E2E_SCREENSHOTS;

const m = (metric: string, value: number | null, unit: string, reason: string | null) => ({
  metric,
  status: value === null ? 'unavailable' : 'valid',
  value,
  unit,
  quality_score: value === null ? null : 0.8,
  quality_flags: ['finger_scan'],
  reason,
  method: 'finger_ppg',
  algorithm_name: 'e2e-fixture',
  algorithm_version: '0.0.0',
  config_version: 'e2e',
  validation: 'unvalidated',
  measured_at: new Date().toISOString(),
});

test('a partial finger scan explains each vital that has no value', async ({ page }) => {
  const api = await request.newContext({ baseURL: API });
  const email = `e2e-vitals-${Date.now()}@example.test`;
  const password = 'fixture vitals 2026';
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
  const { id } = await (
    await api.post('/api/v1/assessments', {
      headers,
      data: { kind: 'morning', scheduled_for: new Date().toISOString(), timezone: 'UTC' },
    })
  ).json();
  await api.post(`/api/v1/assessments/${id}/check-in`, {
    headers,
    data: { kind: 'morning', sleep_quality: 4, energy_rating: 3, alcohol_previous_evening: false },
  });
  const res = await api.post(`/api/v1/assessments/${id}/measurements`, {
    headers,
    data: {
      outcome: 'completed',
      measurements: [
        m('heart_rate', 86, 'bpm', null),
        m('hrv', null, 'ms', 'low_signal_quality'),
        m('breathing_rate', null, '/min', 'low_signal_quality'),
        m('spo2', null, '%', 'unsupported_method'),
        m('blood_pressure', null, 'mmHg', 'unsupported_method'),
      ],
    },
  });
  expect(res.ok()).toBeTruthy();
  expect((await res.json()).status).toBe('partial');

  await page.goto('/sign-in');
  await page.getByTestId('email').fill(email);
  await page.getByTestId('password').fill(password);
  await page.getByTestId('sign-in-submit').click();
  await expect(page.getByTestId('screen-today')).toBeVisible();

  // Today: last assessment tiles carry the specific reason.
  await expect(page.getByTestId('vital-heart_rate')).toContainText('86');
  await expect(page.getByTestId('vital-hrv')).toContainText('Signal too weak');
  await expect(page.getByTestId('vital-blood_pressure')).toContainText('Not available');
  if (shots) await page.screenshot({ path: `${shots}/vitals-today.png`, fullPage: true });

  await page.goto(`/assessment/results?id=${id}`);
  await expect(page.getByTestId('screen-results')).toBeVisible();
  await expect(page.getByTestId('row-heart_rate')).toContainText('86');
  await expect(page.getByTestId('row-hrv')).toContainText('Signal too weak');
  await expect(page.getByTestId('row-breathing_rate')).toContainText('Signal too weak');
  await expect(page.getByTestId('row-spo2')).toContainText('Not available');
  await expect(page.getByTestId('missing-hrv')).toContainText('Heart rate passed');
  await expect(page.getByTestId('missing-breathing_rate')).toBeVisible();
  await expect(page.getByTestId('missing-spo2')).toContainText('finger scan does not estimate');
  await expect(page.getByTestId('missing-blood_pressure')).toContainText('cuff');
  await expect(page.getByTestId('results-log-bp')).toBeVisible();
  if (shots) {
    await page.screenshot({ path: `${shots}/vitals-results.png` });
    await page.getByTestId('missing-vitals').scrollIntoViewIfNeeded();
    await page.getByTestId('missing-vitals').screenshot({ path: `${shots}/vitals-why.png` });
  }
  await api.dispose();
});
