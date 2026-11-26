import { expect, test } from '@playwright/test';

test('deleting the account needs DELETE and the password; a wrong password keeps you signed in', async ({
  page,
}) => {
  const email = `e2e-del-${Date.now()}@example.test`;
  const password = 'delete me 2026';
  await page.goto('/');
  await page.getByTestId('get-started').click();
  await page.getByTestId('consent-processing').click();
  await page.getByTestId('consent-wellness').click();
  await page.getByTestId('agree-continue').click();
  await page.getByTestId('email').fill(email);
  await page.getByTestId('password').fill(password);
  await page.getByTestId('create-account').click();
  await page.getByTestId('birth-year').fill('1990');
  await page.getByTestId('sex-female').click();
  await page.getByTestId('height').fill('168');
  await page.getByTestId('weight').fill('62');
  await page.getByTestId('continue').click();
  await page.getByTestId('start-baseline').click();
  await expect(page.getByTestId('screen-today')).toBeVisible();

  await page.getByTestId('open-settings').click();
  await page.getByTestId('delete-confirm').fill('DELETE');
  await expect(page.getByTestId('delete-account')).toBeDisabled();
  await page.getByTestId('delete-password').fill('not my password 1');
  await page.getByTestId('delete-account').click();
  await expect(page.getByText('Password is incorrect')).toBeVisible();
  await expect(page.getByTestId('screen-settings')).toBeVisible();

  await page.getByTestId('delete-password').fill(password);
  await page.getByTestId('delete-account').click();
  await expect(page.getByTestId('screen-welcome')).toBeVisible();

  // The account is gone: signing in fails.
  await page.goto('/sign-in');
  await page.getByTestId('email').fill(email);
  await page.getByTestId('password').fill(password);
  await page.getByTestId('sign-in-submit').click();
  await expect(page.getByText('Email or password is incorrect')).toBeVisible();
});
