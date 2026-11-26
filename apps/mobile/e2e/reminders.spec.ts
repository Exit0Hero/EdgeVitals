import { expect, request, test } from '@playwright/test';

const API = process.env.E2E_API_URL ?? 'http://localhost:4000';

test('after travel, the stored time zone follows the device; web explains reminders need the app', async ({
  page,
}) => {
  const api = await request.newContext({ baseURL: API });
  const email = `e2e-tz-${Date.now()}@example.test`;
  const password = 'travel zone 2026';
  const reg = await api.post('/api/v1/auth/register', { data: { email, password } });
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
  // Set up in New York; the browser runs in UTC (playwright.config.ts).
  await api.put('/api/v1/me/schedule', {
    headers,
    data: {
      morning_time: '07:15',
      evening_time: '21:00',
      timezone: 'America/New_York',
      reminders_enabled: true,
    },
  });

  await page.goto('/sign-in');
  await page.getByTestId('email').fill(email);
  await page.getByTestId('password').fill(password);
  await page.getByTestId('sign-in-submit').click();
  await expect(page.getByTestId('screen-today')).toBeVisible();
  await expect
    .poll(async () => (await (await api.get('/api/v1/me', { headers })).json()).schedule.timezone)
    .toBe('UTC');
  const me = await (await api.get('/api/v1/me', { headers })).json();
  expect(me.schedule.morning_time.slice(0, 5)).toBe('07:15'); // local wall-clock time kept

  await page.getByTestId('open-settings').click();
  await expect(page.getByTestId('reminder-note')).toContainText('iPhone and Android');
  await api.dispose();
});
