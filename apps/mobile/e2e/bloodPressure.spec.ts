import { expect, test } from '@playwright/test';
import { onboard } from './helpers';

test('cuff blood pressure is logged, listed and deletable; experimental SpO2 is opt-in', async ({
  page,
}) => {
  await onboard(page);

  await page.goto('/blood-pressure');
  await expect(page.getByTestId('screen-blood-pressure')).toBeVisible();
  await page.getByTestId('bp-systolic').fill('80');
  await page.getByTestId('bp-diastolic').fill('90');
  await page.getByTestId('bp-save').click();
  await expect(page.getByText('Diastolic must be lower than systolic')).toBeVisible();
  await expect(page.getByTestId('bp-row')).toHaveCount(0);

  await page.getByTestId('bp-systolic').fill('122');
  await page.getByTestId('bp-diastolic').fill('78');
  await page.getByTestId('bp-pulse').fill('66');
  await page.getByTestId('bp-save').click();
  await expect(page.getByTestId('bp-row')).toHaveCount(1);
  await expect(page.getByTestId('bp-row')).toContainText('122/78 mmHg');
  await expect(page.getByTestId('bp-row')).toContainText('From your cuff');

  await page.reload();
  await expect(page.getByTestId('bp-row')).toHaveCount(1);
  await page.getByRole('button', { name: 'Delete reading 122 over 78' }).click();
  await expect(page.getByTestId('bp-row')).toHaveCount(0);

  await page.goto('/settings');
  await expect(page.getByText('Experimental estimates')).toBeVisible();
  await expect(page.getByTestId('experimental-spo2-off')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('experimental-spo2-on').click();
  await page.reload();
  await expect(page.getByTestId('experimental-spo2-on')).toHaveAttribute('aria-checked', 'true');
});
