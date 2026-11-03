/**
 * web-ops release controls (P3.4; A01/Q31/V10; T3-24/T3-25): two DISTINCT release managers (maker and checker) enrol
 * with user-verifying authenticators. The maker drafts and submits an app version policy and cannot approve it; the
 * checker approves and activates it after a confirmation. Maintenance is started by one person and ended only after a
 * second person approves; a runtime switch is stopped by one person and restored by maker-checker. A read-only AUDITOR
 * sees the page without any action. Every privileged call goes through a fresh WebAuthn step-up (handled by the BFF
 * client). axe on every screen. Staff are synthetic (../seed-release.mjs); requires migration 0010's RELEASE_MANAGER
 * role CHECK.
 */
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { expectAccessible, stack, virtualAuthenticator, type OpsStack } from './helpers.js';

interface ReleaseSeed {
  readonly makerInvitation: string;
  readonly checkerInvitation: string;
  readonly auditorInvitation: string;
}
const seed = (): ReleaseSeed => (stack() as OpsStack & { readonly release: ReleaseSeed }).release;

async function enrolled(browser: Browser, invitation: string, nickname: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await virtualAuthenticator(page);
  await page.goto('/enrol');
  await page.getByLabel('Invitation').fill(invitation);
  await page.getByLabel('Name for this key').fill(nickname);
  await page.getByRole('button', { name: 'Register security key' }).click();
  await expect(page).toHaveURL(/\/$/);
  return { context, page };
}

async function openRelease(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Release controls', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Release controls' })).toBeVisible();
  await expect(page.getByTestId('switch-rider.quotes')).toBeVisible();
}

test.describe.serial('release managers: maker-checker release controls', () => {
  let maker: { context: BrowserContext; page: Page };
  let checker: { context: BrowserContext; page: Page };
  test.beforeAll(async ({ browser }) => {
    maker = await enrolled(browser, seed().makerInvitation, 'release maker key');
    checker = await enrolled(browser, seed().checkerInvitation, 'release checker key');
  });
  test.afterAll(async () => {
    await maker.context.close();
    await checker.context.close();
  });

  test('a release manager sees the Release controls navigation and an accessible page', async () => {
    await expect(maker.page.getByText('RELEASE_MANAGER')).toBeVisible();
    for (const hidden of ['Staff', 'Review queue', 'Compliance', 'Support']) {
      await expect(maker.page.getByRole('link', { name: hidden, exact: true })).toHaveCount(0);
    }
    await openRelease(maker.page);
    await expect(maker.page.getByTestId('maintenance-state')).toHaveText(/not active/);
    await expectAccessible(maker.page);
  });

  test('the maker drafts and submits a version policy and cannot approve it', async () => {
    const { page } = maker;
    const form = page.getByRole('form', { name: 'Draft a policy' });
    await form.getByLabel('Platform').selectOption('ANDROID');
    await form.getByLabel('Minimum supported build').fill('0');
    await form.getByLabel('Recommended build').fill('5');
    await form.getByRole('button', { name: 'Create draft' }).click();
    const row = page.getByTestId('policy-ANDROID-1');
    await expect(row.getByTestId('policy-status')).toHaveText('DRAFT');
    await row.getByRole('button', { name: 'Submit for approval' }).click();
    await expect(row.getByTestId('policy-status')).toHaveText('PENDING_APPROVAL');
    await expect(row.getByRole('button', { name: 'Approve' })).toHaveCount(0);
    await row.getByRole('button', { name: 'Preview impact' }).click();
    await expect(page.getByTestId('policy-preview')).toContainText('Passes every guardrail.');
    await expectAccessible(page);
  });

  test('a different release manager approves, then activates after a confirmation', async () => {
    const { page } = checker;
    await openRelease(page);
    const row = page.getByTestId('policy-ANDROID-1');
    await row.getByRole('button', { name: 'Approve' }).click();
    await expect(row.getByTestId('policy-status')).toHaveText('APPROVED');
    page.once('dialog', (d) => void d.accept());
    await row.getByRole('button', { name: 'Activate now' }).click();
    await expect(row.getByTestId('policy-status')).toHaveText('ACTIVE');
    await expectAccessible(page);
  });

  test('maintenance: one person starts it; ending it needs a second person', async () => {
    const m = maker.page;
    await m.reload();
    m.once('dialog', (d) => void d.accept());
    await m.getByRole('button', { name: 'Start maintenance' }).click();
    await expect(m.getByTestId('maintenance-state')).toHaveText(/ACTIVE/);
    m.once('dialog', (d) => void d.accept('MAINTENANCE_DONE'));
    await m.getByRole('button', { name: 'Request end of maintenance' }).click();
    const own = m.getByTestId('pending-restore').filter({ hasText: 'platform.maintenance' });
    await expect(own).toContainText('Your request');
    await expect(own.getByRole('button', { name: 'Approve' })).toHaveCount(0);
    await expectAccessible(m);

    const c = checker.page;
    await c.reload();
    await c.getByTestId('pending-restore').filter({ hasText: 'platform.maintenance' }).getByRole('button', { name: 'Approve' }).click();
    await expect(c.getByTestId('maintenance-state')).toHaveText(/not active/);
  });

  test('a runtime switch: one person stops it now; restoring is maker-checker', async () => {
    const m = maker.page;
    await m.reload();
    const stop = m.getByRole('form', { name: 'Stop a capability' });
    await stop.getByLabel('Switch').selectOption('rider.quotes');
    await stop.getByLabel('Scope').selectOption('ALL');
    await stop.getByLabel('Reason code').fill('OPS_INCIDENT');
    m.once('dialog', (d) => void d.accept());
    await stop.getByRole('button', { name: 'Stop now' }).click();
    const row = m.getByTestId('switch-rider.quotes');
    await expect(row.getByTestId('switch-state')).toHaveText('DISABLED');
    m.once('dialog', (d) => void d.accept('INCIDENT_RESOLVED'));
    await row.getByRole('button', { name: 'Request restore' }).click();
    await expect(m.getByTestId('pending-restore').filter({ hasText: 'rider.quotes' })).toContainText('Your request');

    const c = checker.page;
    await c.reload();
    await c.getByTestId('pending-restore').filter({ hasText: 'rider.quotes' }).getByRole('button', { name: 'Approve' }).click();
    await expect(c.getByTestId('switch-rider.quotes').getByTestId('switch-state')).toHaveText('ENABLED');
    await expectAccessible(c);
  });
});

test('a read-only AUDITOR sees release controls without any action', async ({ browser }) => {
  const auditor = await enrolled(browser, seed().auditorInvitation, 'release auditor key');
  try {
    await openRelease(auditor.page);
    for (const action of ['Create draft', 'Stop now', 'Start maintenance', 'Request restore', 'Activate now', 'Approve']) {
      await expect(auditor.page.getByRole('button', { name: action })).toHaveCount(0);
    }
    // the API itself refuses the permission (the UI hiding the form is not the control)
    const direct = await auditor.page.request.post('/bff/switches/safe-state-changes', {
      headers: { origin: new URL(auditor.page.url()).origin },
      data: { key: 'rider.quotes', scope: 'ALL', reasonCode: 'OPS_INCIDENT' },
    });
    expect(direct.status()).toBe(403);
    expect((await direct.json()) as unknown).toMatchObject({ error: { code: 'WAYVRO_E_FORBIDDEN' } });
    await expectAccessible(auditor.page);
  } finally {
    await auditor.context.close();
  }
});
