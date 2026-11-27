import { expect, test } from '@playwright/test';
import { onboard, shot } from './helpers';

// The finger scan needs a phone's back camera and flash. On the web it must
// say so and offer the face scan, never start measuring.
test('finger scan option explains itself and falls back to the face scan on the web', async ({
  page,
}) => {
  await onboard(page);
  await page.getByTestId('run-morning').click();
  await page.getByTestId('sleep-4').click();
  await page.getByTestId('energy-3').click();
  await page.getByTestId('alcohol-no').click();
  await page.getByTestId('next-scan').click();

  await expect(page.getByTestId('screen-prepare')).toBeVisible();
  await page.getByTestId('scan-type-finger').click();
  await expect(page.getByText('Cover the back camera and flash')).toBeVisible();
  await expect(page.getByText(/stops by itself after about a minute/)).toBeVisible();
  await shot(page, '07b-prepare-finger');
  await page.getByTestId('start-scan').click();

  await expect(page.getByTestId('screen-finger-scan')).toBeVisible();
  await expect(page.getByTestId('finger-camera-unavailable')).toContainText(
    /needs the EdgeVitals app on a phone with a flash/,
  );
  await shot(page, '08b-finger-unavailable');
  await page.getByTestId('finger-use-face').click();
  await expect(page.getByTestId('screen-scan')).toBeVisible();
  await page.getByTestId('cancel-scan').click();
  await expect(page.getByTestId('screen-today')).toBeVisible();
});
