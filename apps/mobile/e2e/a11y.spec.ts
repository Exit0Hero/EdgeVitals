import AxeBuilder from '@axe-core/playwright';
import { expect, request, test, type Page } from '@playwright/test';

/**
 * Automated WCAG 2.1 A/AA checks (axe-core) on every main screen of the web
 * build. Automated checks catch roughly a third of issues; screen-reader and
 * dynamic-type passes on devices are still needed.
 */
const API = process.env.E2E_API_URL ?? 'http://localhost:4000';

async function check(page: Page, name: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const summary = results.violations.map(
    (v) =>
      `${name}: ${v.id} (${v.impact}) ${v.help} -> ${v.nodes
        .slice(0, 3)
        .map((n) => n.target.join(' '))
        .join(' | ')}`,
  );
  expect(summary, summary.join('\n')).toEqual([]);
}

test('onboarding screens have no automatically detectable WCAG A/AA violations', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByTestId('screen-welcome')).toBeVisible();
  await check(page, 'welcome');
  await page.getByTestId('get-started').click();
  await expect(page.getByTestId('screen-consent')).toBeVisible();
  await check(page, 'consent');
  await page.getByTestId('consent-processing').click();
  await page.getByTestId('consent-wellness').click();
  await page.getByTestId('agree-continue').click();
  await expect(page.getByTestId('screen-account')).toBeVisible();
  await check(page, 'account');
  await page.getByTestId('email').fill(`e2e-a11y-${Date.now()}@example.test`);
  await page.getByTestId('password').fill('accessible 2026 pass');
  await page.getByTestId('create-account').click();
  await expect(page.getByTestId('screen-about')).toBeVisible();
  await check(page, 'about');
  await page.getByTestId('birth-year').fill('1990');
  await page.getByTestId('sex-female').click();
  await page.getByTestId('height').fill('168');
  await page.getByTestId('weight').fill('62');
  await page.getByTestId('continue').click();
  await expect(page.getByTestId('screen-rhythm')).toBeVisible();
  await check(page, 'rhythm');
  await page.getByTestId('start-baseline').click();
  await expect(page.getByTestId('screen-today')).toBeVisible();
  await check(page, 'today');

  await page.getByTestId('run-morning').click();
  await expect(page.getByTestId('screen-checkin-morning')).toBeVisible();
  await check(page, 'check-in');
  await page.getByTestId('sleep-4').click();
  await page.getByTestId('energy-3').click();
  await page.getByTestId('alcohol-no').click();
  await page.getByTestId('next-scan').click();
  await expect(page.getByTestId('screen-prepare')).toBeVisible();
  await check(page, 'prepare');
  await page.getByTestId('start-scan').click();
  await expect(page.getByTestId('screen-scan')).toBeVisible();
  await page.waitForTimeout(2000);
  await check(page, 'scan');
  await page.getByTestId('demo-results').click();
  await expect(page.getByTestId('screen-results')).toBeVisible();
  await check(page, 'results');
  await page.getByTestId('done').click();

  await page.getByRole('link', { name: 'Trends', exact: true }).click();
  await expect(page.getByTestId('screen-trends')).toBeVisible();
  await check(page, 'trends');
  await page.goto('/settings');
  await expect(page.getByTestId('screen-settings')).toBeVisible();
  await check(page, 'settings');
  await page.goto('/privacy');
  await check(page, 'privacy');
});

test('sign-in screen', async ({ page }) => {
  await page.goto('/sign-in');
  await expect(page.getByTestId('screen-sign-in')).toBeVisible();
  await check(page, 'sign-in');
  void request;
  void API;
});
