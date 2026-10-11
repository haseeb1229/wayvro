/**
 * web-ops support journey (Phase-2 closure; staff matrix §4; W07/H08/K17/A11): a SUPPORT_AGENT enrols with a
 * user-verifying authenticator and sees the Support navigation; looks up ONE account by phone for a recorded reason and
 * sees only the masked summary (the full number never reaches the page); signs out one session, then all sessions,
 * each after a destructive confirmation with a reason and a fresh staff step-up through the authenticator; hands a
 * proof-bearing driver-KYC recovery to human review without deciding it. A role without the support permissions (an
 * AUDITOR) gets neither the navigation nor the page nor the API. axe on every screen. The seeded accounts, numbers and
 * driver are synthetic (../seed-support.mjs).
 */
import pg from 'pg';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { expectAccessible, stack, virtualAuthenticator } from './helpers.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function query<T extends Record<string, unknown>>(sql: string, params: readonly unknown[]): Promise<T[]> {
  const client = new pg.Client({ connectionString: stack().databaseUrl });
  await client.connect();
  try {
    return (await client.query<T>(sql, [...params])).rows;
  } finally {
    await client.end();
  }
}

async function enrol(page: Page, invitation: string, nickname: string): Promise<void> {
  await page.goto('/enrol');
  await page.getByLabel('Invitation').fill(invitation);
  await page.getByLabel('Name for this key').fill(nickname);
  await page.getByRole('button', { name: 'Register security key' }).click();
  await expect(page).toHaveURL(/\/$/);
}

test.describe.serial('support agent journey', () => {
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

  test('the support agent enrols and sees only the Support navigation', async () => {
    await enrol(page, stack().support.supportInvitation, 'support key');
    await expect(page.getByText('SUPPORT_AGENT')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Support', exact: true })).toBeVisible();
    for (const hidden of ['Staff', 'Audit', 'Review queue', 'Appeals', 'Restrictions', 'Compliance', 'Expiry roster']) {
      await expect(page.getByRole('link', { name: hidden, exact: true })).toHaveCount(0);
    }
    await expectAccessible(page);
  });

  test('the BFF forwards only the declared support methods and refuses cross-origin calls', async () => {
    const { riderAccountId, riderPhone } = stack().support;
    expect((await page.request.get('/bff/account-summaries')).status()).toBe(404);
    expect((await page.request.get(`/bff/accounts/${riderAccountId}/session-revocations`)).status()).toBe(404);
    const forged = await page.request.post('/bff/account-summaries', {
      headers: { origin: 'https://evil.example' },
      data: { phone: riderPhone, reasonCode: 'CUSTOMER_CONTACT_VERIFIED' },
    });
    expect(forged.status()).toBe(403);
  });

  test('looks up an account by phone for a recorded reason and sees only the masked summary', async () => {
    const { riderPhone } = stack().support;
    await page.getByRole('link', { name: 'Support', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Account support' })).toBeVisible();
    await expectAccessible(page);
    const lookup = page.getByRole('form', { name: 'Look up an account' });
    await lookup.getByLabel('Phone number (as the customer gave it)').fill(riderPhone);
    await lookup.getByLabel('Reason for access').selectOption('CUSTOMER_CONTACT_VERIFIED');
    await lookup.getByRole('button', { name: 'Look up' }).click();
    await expect(page.getByTestId('masked-phone')).toHaveText(`+92 3** *** **${riderPhone.slice(-2)}`);
    await expect(page.getByTestId('support-session-row')).toHaveCount(2);
    // the typed number is cleared and the full number appears nowhere in the document, in any common format
    await expect(lookup.getByLabel('Phone number (as the customer gave it)')).toHaveValue('');
    const html = await page.content();
    const national = riderPhone.slice(3);
    for (const form of [riderPhone, national, `0${national}`]) expect(html).not.toContain(form);
    await expectAccessible(page);
  });

  test('cancelling the confirmation with Escape changes nothing', async () => {
    await page.getByRole('button', { name: 'Sign out all sessions', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Sign out every session?' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('support-session-row')).toHaveCount(2);
  });

  test('signs out one session after a destructive confirmation with a reason (fresh step-up)', async () => {
    await page
      .getByRole('button', { name: /^Sign out this session/ })
      .first()
      .click();
    const dialog = page.getByRole('dialog', { name: 'Sign out this session?' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('no phone number, sign-in method or credential moves')).toBeVisible();
    await expectAccessible(page);
    await dialog.getByLabel('Reason for access').selectOption('CUSTOMER_CONTACT_VERIFIED');
    await dialog.getByRole('button', { name: 'Confirm sign-out' }).click();
    await expect(page.getByTestId('support-notice')).toHaveText('Sessions signed out: 1');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('support-session-row')).toHaveCount(1);
  });

  test('signs out every remaining session; the account sees the support revocation', async () => {
    const { riderAccountId } = stack().support;
    await page.getByRole('button', { name: 'Sign out all sessions', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Sign out every session?' });
    await dialog.getByLabel('Reason for access').selectOption('CUSTOMER_CONTACT_VERIFIED');
    await dialog.getByRole('button', { name: 'Confirm sign-out' }).click();
    await expect(page.getByTestId('support-notice')).toHaveText(/^Sessions signed out: [1-9][0-9]*$/);
    await expect(page.getByTestId('sessions-empty')).toBeVisible();
    await expectAccessible(page);
    const sessions = await query<{ status: string; revoke_reason: string | null }>(
      `select status, revoke_reason from identity.sessions where account_id = $1`,
      [riderAccountId],
    );
    expect(sessions).toEqual([
      { status: 'REVOKED', revoke_reason: 'STAFF_ON_BEHALF' },
      { status: 'REVOKED', revoke_reason: 'STAFF_ON_BEHALF' },
    ]);
    const events = await query<{ n: string }>(
      `select count(*) n from identity.security_events where account_id = $1 and type = 'SESSIONS_REVOKED_BY_SUPPORT'`,
      [riderAccountId],
    );
    expect(Number(events[0]?.n)).toBeGreaterThanOrEqual(1);
  });

  test('hands a proof-bearing driver recovery to human review without deciding it', async () => {
    const { driverAccountId, recoveryId } = stack().support;
    const lookup = page.getByRole('form', { name: 'Look up an account' });
    await lookup.getByLabel('Look up by').selectOption('accountId');
    await lookup.getByLabel('Account id', { exact: true }).fill(driverAccountId);
    await lookup.getByLabel('Reason for access').selectOption('RECOVERY_ASSISTANCE');
    await lookup.getByRole('button', { name: 'Look up' }).click();
    const recovery = page.getByTestId('support-recovery');
    await expect(recovery).toContainText('Lost phone (driver identity check)');
    await expect(recovery).toContainText('MANUAL_REVIEW');
    await expect(recovery.getByRole('note')).toContainText('Support never decides a recovery');
    await expectAccessible(page);
    await recovery.getByLabel('Reason for access').selectOption('RECOVERY_ASSISTANCE');
    await recovery.getByRole('button', { name: 'Send to recovery review' }).click();
    await expect(page.getByTestId('assist-result')).toContainText('Sent to recovery review.');
    await expect(page.getByTestId('assist-case-id')).toHaveText(UUID);
    await expect(page.getByTestId('assist-result')).toContainText(/New review case opened\s*Yes/);
    await expectAccessible(page);
    // a human review case exists; the recovery itself is still undecided and no phone moved
    const cases = await query<{ kind: string; status: string; city_code: string }>(
      `select kind, status, city_code from compliance.review_cases where phone_change_request_id = $1`,
      [recoveryId],
    );
    expect(cases).toEqual([{ kind: 'ACCOUNT_RECOVERY', status: 'OPEN', city_code: 'ZZE' }]);
    const request = await query<{ status: string }>(`select status from identity.phone_change_requests where id = $1`, [recoveryId]);
    expect(request).toEqual([{ status: 'MANUAL_REVIEW' }]);
    const phone = await query<{ phone_last4: string }>(`select phone_last4 from identity.account_phones where account_id = $1 and status = 'VERIFIED'`, [
      driverAccountId,
    ]);
    expect(phone).toEqual([{ phone_last4: '0418' }]);
  });
});

test.describe.serial('roles without support permissions', () => {
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

  test('an auditor sees no Support navigation, page or API', async () => {
    await enrol(page, stack().support.auditorInvitation, 'auditor key');
    await expect(page.getByText('AUDITOR', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Audit', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Support', exact: true })).toHaveCount(0);
    await expectAccessible(page);
    expect((await page.goto('/support'))?.status()).toBe(404);
    const denied = await page.request.post('/bff/account-summaries', {
      headers: { origin: new URL(page.url()).origin },
      data: { phone: stack().support.riderPhone, reasonCode: 'SAFETY_REPORT' },
    });
    expect(denied.status()).toBe(403);
  });
});
