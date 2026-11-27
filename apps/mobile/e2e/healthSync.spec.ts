import { expect, request, test } from '@playwright/test';

/**
 * Health app sync screens (ADR 0009). The web build cannot reach Health
 * Connect or Apple Health, so the readings below are TEST FIXTURES uploaded
 * through the API as a phone would, tagged `source_app: 'e2e.fixture'`. They
 * are not measurements.
 */
const API = process.env.E2E_API_URL ?? 'http://localhost:4000';

test('synced SpO2 and blood pressure show with their source and can be deleted', async ({
  page,
}) => {
  const api = await request.newContext({ baseURL: API });
  const email = `e2e-sync-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const password = 'fixture health sync 2026';
  const reg = await api.post('/api/v1/auth/register', { data: { email, password } });
  expect(reg.ok()).toBeTruthy();
  const headers = { authorization: `Bearer ${(await reg.json()).access_token}` };
  for (const consent_type of ['processing', 'wellness_acknowledgement', 'health_sync'])
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
      reminders_enabled: false,
      heart_rate_affecting_substance: 'no',
    },
  });
  const at = new Date(Date.now() - 30 * 60_000).toISOString();
  const up = await api.post('/api/v1/health-sync/readings', {
    headers,
    data: {
      platform: 'health_connect',
      readings: [
        {
          metric: 'spo2',
          value: 97,
          measured_at: at,
          external_id: 'e2e-ox',
          source_app: 'e2e.fixture',
          source_name: 'Fixture Oximeter App',
          device_manufacturer: 'Fixture',
          device_model: 'Oximeter',
        },
        {
          metric: 'blood_pressure',
          value: 121,
          value_secondary: 79,
          measured_at: at,
          external_id: 'e2e-bp',
          source_app: 'e2e.fixture',
          source_name: 'Fixture Cuff App',
        },
      ],
    },
  });
  expect((await up.json()).inserted).toBe(2);

  await page.goto('/sign-in');
  await page.getByTestId('email').fill(email);
  await page.getByTestId('password').fill(password);
  await page.getByTestId('sign-in-submit').click();
  await expect(page.getByTestId('screen-today')).toBeVisible();

  await page.getByRole('link', { name: 'Trends', exact: true }).click();
  await expect(page.getByTestId('spo2-summary')).toContainText('97%');
  await expect(page.getByTestId('spo2-source')).toHaveText(
    'Fixture Oximeter · Fixture Oximeter App via Health Connect',
  );
  await expect(page.getByTestId('bp-source')).toHaveText('Fixture Cuff App via Health Connect');

  await page.goto('/health-readings');
  await expect(page.getByTestId('health-reading-row')).toHaveCount(2);
  await expect(page.getByTestId('health-reading-row').first()).toContainText('Your device');

  await page.goto('/settings');
  await expect(page.getByTestId('health-sync-section')).toBeVisible();
  await expect(page.getByTestId('health-sync-status')).toContainText(
    'Sync runs in the EdgeVitals app',
  );
  await page.getByTestId('health-sync-delete').click();
  await expect(page.getByTestId('health-sync-message')).toContainText('Synced readings deleted');

  await page.goto('/health-readings');
  await expect(page.getByTestId('health-readings-empty')).toBeVisible();
});
