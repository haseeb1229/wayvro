/**
 * web-ops reviewer journey (P2.7; H02/W07/K04/K05): a KYC reviewer enrols with a user-verifying authenticator, sees
 * only the review navigation their permissions allow, claims a case from the scoped queue, reads the masked case,
 * views one evidence image through the reason-for-access dialog (one-time token, step-up, watermark burned into a
 * canvas — no image URL, no download), and records a NEEDS_INFO decision with checklist and catalogue reasons. axe on
 * every screen. The seeded application and image are synthetic (../seed-review.mjs).
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { expectAccessible, stack, virtualAuthenticator } from './helpers.js';

test.describe.serial('KYC reviewer journey', () => {
  let page: Page;
  let context: BrowserContext;
  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
    await virtualAuthenticator(page);
  });
  test.afterAll(async () => {
    await context.close();
  });

  test('the reviewer enrols and sees only review navigation', async () => {
    await page.goto('/enrol');
    await page.getByLabel('Invitation').fill(stack().reviewerInvitation);
    await page.getByLabel('Name for this key').fill('reviewer key');
    await page.getByRole('button', { name: 'Register security key' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText('KYC_REVIEWER')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Review queue' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Expiry roster' })).toBeVisible();
    for (const hidden of ['Staff', 'Audit', 'Appeals', 'Compliance']) await expect(page.getByRole('link', { name: hidden, exact: true })).toHaveCount(0);
  });

  test('claims the seeded case from the scoped queue and reads the masked case', async () => {
    await page.getByRole('link', { name: 'Review queue' }).click();
    await expect(page.getByRole('heading', { name: 'Review queue' })).toBeVisible();
    await expectAccessible(page);
    await expect(page.getByTestId('review-case-row')).toHaveCount(1);
    await page.getByRole('button', { name: 'Claim' }).click();
    await expect(page).toHaveURL(new RegExp(`/review/${stack().caseId}$`));
    await expect(page.getByText('Synthetic E2E Applicant')).toBeVisible();
    await expect(page.getByText('0001')).toBeVisible();
    await expect(page.getByText('35202-0000000-1')).toHaveCount(0);
    await expect(page.getByRole('note')).toContainText('PLACEHOLDER requirement set');
    await expectAccessible(page);
  });

  test('views evidence once, for a recorded reason, with the watermark burned in', async () => {
    const contentRequests: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/content')) contentRequests.push(r.url());
    });
    await page.getByRole('button', { name: 'View' }).click();
    const dialog = page.getByTestId('evidence-viewer');
    await expect(dialog.getByText('Every view is logged with your reason')).toBeVisible();
    await expectAccessible(page);
    await dialog.getByLabel('Reason').selectOption('CASE_REVIEW');
    await dialog.getByRole('button', { name: 'Show evidence' }).click();
    const canvas = dialog.getByTestId('evidence-canvas');
    await expect(canvas).toBeVisible();
    await expect.poll(async () => canvas.evaluate((c: HTMLCanvasElement) => c.width)).toBe(480);
    await expect(dialog.getByTestId('watermark')).toContainText('CONFIDENTIAL — viewed by E2E Reviewer');
    expect(await page.locator('img[src*="evidence-views"]').count()).toBe(0);
    expect(contentRequests).toHaveLength(1);
    // the token is single-use: the same content URL now answers 410
    const replay = await page.request.get(contentRequests[0] ?? '');
    expect(replay.status()).toBe(410);
    await dialog.getByRole('button', { name: 'Close' }).click();
  });

  test('records a NEEDS_INFO decision with checklist and catalogue reasons', async () => {
    page.once('dialog', (d) => {
      void d.accept();
    });
    await page.getByRole('combobox', { name: 'Decision', exact: true }).selectOption('NEEDS_INFO');
    await page.getByLabel('SELFIE_UNCLEAR').check();
    await page.getByLabel('CNIC_FRONT').check();
    await page.getByRole('button', { name: 'Record decision' }).click();
    await expect(page.getByTestId('decision-recorded')).toHaveText('Decision recorded.');
    await expectAccessible(page);
    // the decided case has left the queue; the reviewer's claim ended with the decision
    await page.getByRole('main').getByRole('link', { name: 'Review queue' }).click();
    await expect(page.getByText('No cases.')).toBeVisible();
  });
});
