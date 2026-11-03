/**
 * web-ops E2E (H01/K10/Q42/W07; SEC-STAFF browser part): WebAuthn enrolment and sign-in through the BFF with
 * Chromium's virtual authenticator (user verification on), session cookie flags (`__Host-`, HttpOnly, Secure,
 * SameSite=Strict; never readable by JavaScript), BFF allowlist and Origin check, environment banner, idle lock +
 * WebAuthn unlock, permission-scoped navigation, invitation flow, and axe (no serious/critical violations).
 */
import pg from 'pg';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { expectAccessible, stack, virtualAuthenticator } from './helpers.js';

test.describe.serial('staff sign-in and shell', () => {
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

  test('sign-in page is accessible and has no password field', async () => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await expectAccessible(page);
  });

  test('enrolment with an invitation and a user-verifying authenticator signs the admin in', async () => {
    await page.goto('/enrol');
    await expectAccessible(page);
    await page.getByLabel('Invitation').fill(stack().invitations[0] ?? '');
    await page.getByLabel('Name for this key').fill('virtual key');
    await page.getByRole('button', { name: 'Register security key' }).click();
    await expect(page).toHaveURL(/\/$/);
    // the overview's own title proves the /enrol -> / navigation (push + refresh) has settled before axe runs
    await expect(page).toHaveTitle('Wayvro Operations');
    await expect(page.getByTestId('environment-banner')).toHaveText('LOCAL — synthetic data');
    await expect(page.getByText('STAFF_ADMIN')).toBeVisible();
    await expect(page.getByRole('note')).toContainText('Two security keys are required');
    await expectAccessible(page);
  });

  test('the session token lives only in a __Host- HttpOnly Secure SameSite=Strict cookie', async () => {
    const cookies = await page.context().cookies();
    const session = cookies.find((c) => c.name === '__Host-wv_staff');
    expect(session).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict', path: '/' });
    expect(await page.evaluate(() => document.cookie)).not.toContain('wvs_');
    expect(await page.content()).not.toContain('wvs_');
  });

  test('the BFF forwards only declared admin routes and refuses cross-origin mutations', async () => {
    expect((await page.request.get('/bff/not-a-route')).status()).toBe(404);
    expect((await page.request.get('/bff/account/state')).status()).toBe(404);
    const forged = await page.request.post('/bff/staff-invitations', {
      headers: { origin: 'https://evil.example' },
      data: { displayName: 'X', workEmail: 'x@example.org' },
    });
    expect(forged.status()).toBe(403);
  });

  test('navigation follows server permissions; the admin invites a colleague (step-up via the authenticator)', async () => {
    await expect(page.getByRole('link', { name: 'Staff' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Audit' })).toHaveCount(0);
    await page.getByRole('link', { name: 'Staff' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Staff' })).toBeVisible();
    await expectAccessible(page);
    await page.getByLabel('Display name').fill('E2E Colleague');
    await page.getByLabel('Work e-mail').fill('e2e.colleague@example.org');
    await page.getByRole('button', { name: 'Create invitation' }).click();
    await expect(page.getByTestId('invitation-token')).toHaveText(/^wvi_[A-Za-z0-9_-]{43}$/);
    expect((await page.goto('/audit'))?.status()).toBe(404);
  });

  test('an idle session locks server-side and unlocks with the authenticator', async () => {
    const client = new pg.Client({ connectionString: stack().databaseUrl });
    await client.connect();
    try {
      // only this spec's admin: other specs (the reviewer journey) may run in parallel
      await client.query(
        `update staff.sessions set last_activity_at = now() - interval '20 minutes'
          where status = 'ACTIVE' and staff_id in (select id from staff.staff_accounts where work_email = 'e2e.admin.one@example.org')`,
      );
    } finally {
      await client.end();
    }
    await page.goto('/');
    await expect(page.getByTestId('lock-overlay')).toBeVisible();
    await expectAccessible(page);
    await page.getByRole('button', { name: 'Unlock with security key' }).click();
    await expect(page.getByTestId('lock-overlay')).toHaveCount(0);
    await expect(page.getByText('STAFF_ADMIN')).toBeVisible();
  });

  test('sign out, then sign in again with the discoverable credential', async () => {
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.getByRole('button', { name: 'Sign in with security key' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId('environment-banner')).toBeVisible();
  });
});
