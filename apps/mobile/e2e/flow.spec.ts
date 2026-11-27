import { expect, test } from '@playwright/test';
import { onboard, shot } from './helpers';

test('onboarding leads to an empty, honest Today screen', async ({ page }) => {
  await onboard(page);
  await expect(page.getByTestId('baseline-progress')).toBeVisible();
  // No scores before the 14-day baseline.
  await expect(page.getByTestId('recovery-hero')).toHaveCount(0);
  await shot(page, '05-today-empty');
});

test('a camera with no face never produces readings', async ({ page }) => {
  // The static server applies the production Content-Security-Policy; the
  // MediaPipe detector must load under it without any violation.
  const cspViolations: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy|Content-Security-Policy/i.test(m.text()))
      cspViolations.push(m.text());
  });
  await onboard(page);
  await page.getByTestId('run-morning').click();
  await expect(page.getByTestId('screen-checkin-morning')).toBeVisible();
  await page.getByTestId('sleep-4').click();
  await page.getByTestId('energy-3').click();
  await page.getByTestId('alcohol-no').click();
  await shot(page, '06-checkin-morning');
  await page.getByTestId('next-scan').click();

  await expect(page.getByTestId('screen-prepare')).toBeVisible();
  await shot(page, '07-prepare');
  await page.getByTestId('start-scan').click();
  await expect(page.getByTestId('screen-scan')).toBeVisible();
  // The fake camera streams a test pattern; the detector must report no face.
  await expect(page.getByTestId('quality-status')).toContainText(
    /Looking for your face|can’t see your face/,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(4000);
  await expect(page.getByTestId('quality-status')).not.toContainText(/failed|error/i);
  expect(cspViolations).toEqual([]);
  await shot(page, '08-scan-no-face');
  // No usable signal means no progress toward a result.
  expect(
    await page.getByTestId('scan-progress').evaluate((el) => (el as HTMLElement).style.width),
  ).toBe('0%');
  await page.getByTestId('cancel-scan').click();
  await expect(page.getByTestId('screen-today')).toBeVisible();
});

test('demo results are labelled simulated and stay out of Today and Trends', async ({ page }) => {
  await onboard(page);
  await page.getByTestId('run-morning').click();
  await page.getByTestId('sleep-4').click();
  await page.getByTestId('energy-3').click();
  await page.getByTestId('alcohol-no').click();
  await page.getByTestId('next-scan').click();
  await page.getByTestId('start-scan').click();
  await page.getByTestId('demo-results').click();

  await expect(page.getByTestId('screen-results')).toBeVisible();
  await expect(page.getByTestId('demo-banner')).toBeVisible();
  await expect(page.getByTestId('row-spo2')).toContainText('Not available');
  await expect(page.getByTestId('row-blood_pressure')).toContainText('Not available');
  await shot(page, '09-results-demo');
  await page.getByTestId('done').click();

  // Simulated results never count: the baseline does not advance and the
  // morning assessment is still due.
  await expect(page.getByTestId('screen-today')).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Baseline day 0 of 14' })).toBeVisible();
  await expect(page.getByTestId('run-morning')).toBeVisible();
  await expect(page.getByTestId('last-assessment')).toHaveCount(0);

  await page.goto('/assessment/check-in?kind=evening');
  await expect(page.getByTestId('screen-checkin-evening')).toBeVisible();
  await page.getByTestId('stress-2').click();
  await page.getByTestId('energy-3').click();
  await expect(page.getByTestId('next-scan')).toBeEnabled();
  await shot(page, '11-checkin-evening');
  await page.goto('/today');

  await page.getByRole('link', { name: 'Trends', exact: true }).click();
  await expect(page.getByTestId('screen-trends')).toBeVisible();
  await expect(page.getByTestId('sample-count')).toBeVisible();
  // Demo readings are simulated and never count toward real trends.
  await expect(page.getByTestId('sample-count')).toContainText('0 readings');
  await shot(page, '12-trends');
});
