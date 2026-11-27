import { expect, type Page } from '@playwright/test';

const shots = process.env.E2E_SCREENSHOTS;
export const shot = async (page: Page, name: string) => {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: false });
};

export async function onboard(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('screen-welcome')).toBeVisible();
  await shot(page, '01-welcome');
  await page.getByTestId('get-started').click();

  await expect(page.getByTestId('screen-consent')).toBeVisible();
  await expect(page.getByTestId('agree-continue')).toBeDisabled();
  await page.getByTestId('consent-processing').click();
  await page.getByTestId('consent-wellness').click();
  await shot(page, '02-consent');
  await page.getByTestId('agree-continue').click();

  await expect(page.getByTestId('screen-account')).toBeVisible();
  await page
    .getByTestId('email')
    .fill(`e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`);
  await page.getByTestId('password').fill('correct horse 42 staple');
  await page.getByTestId('create-account').click();

  await expect(page.getByTestId('screen-about')).toBeVisible();
  await page.getByTestId('birth-year').fill('1990');
  await page.getByTestId('sex-female').click();
  await page.getByTestId('height').fill('168');
  await page.getByTestId('weight').fill('62');
  await shot(page, '03-about');
  await page.getByTestId('continue').click();

  await expect(page.getByTestId('screen-rhythm')).toBeVisible();
  await page.getByTestId('morning-time').fill('07:15');
  await shot(page, '04-rhythm');
  await page.getByTestId('start-baseline').click();
  await expect(page.getByTestId('screen-today')).toBeVisible();
}
