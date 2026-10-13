/**
 * web-ops geo administration (Phase 3, P3.2; I11 cost controls, A06 aliases): two DISTINCT CATALOG_MANAGER staff
 * (../seed-geo.mjs). A provider budget goes draft → submit → approval by the OTHER manager (the maker is never offered
 * it) → activation; a DECREASE of the budget in force — the safe direction — is approved and activated by its drafter
 * alone (fresh WebAuthn step-up), which retires the previous version. The hourly usage table shows the seeded synthetic
 * rollups; a Roman-Urdu landmark alias is proposed by one manager and approved by the other. axe on every screen;
 * synthetic provider key `geo-e2e` only.
 */
import pg from 'pg';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { expectAccessible, stack, virtualAuthenticator, type OpsStack } from './helpers.js';

interface GeoSeed {
  readonly makerInvitation: string;
  readonly makerId: string;
  readonly checkerInvitation: string;
  readonly checkerId: string;
}
const seed = (): GeoSeed => (stack() as OpsStack & { readonly geo: GeoSeed }).geo;

async function query<T extends Record<string, unknown>>(sql: string, params: readonly unknown[]): Promise<T[]> {
  const client = new pg.Client({ connectionString: stack().databaseUrl });
  await client.connect();
  try {
    return (await client.query<T>(sql, [...params])).rows;
  } finally {
    await client.end();
  }
}

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

async function draftBudget(page: Page, daily: string, monthly: string, costUsd: string): Promise<void> {
  const form = page.getByRole('form', { name: 'Draft a budget' });
  await form.getByLabel('Provider key').fill('geo-e2e');
  await form.getByLabel('SKU').selectOption('AUTOCOMPLETE');
  await form.getByLabel('Daily calls').fill(daily);
  await form.getByLabel('Monthly calls').fill(monthly);
  await form.getByLabel('Monthly cost cap (USD)').fill(costUsd);
  await form.getByRole('button', { name: 'Create draft' }).click();
}

const row = (page: Page, version: number) => page.getByTestId(`budget-geo-e2e-AUTOCOMPLETE-v${String(version)}`);
const label = (version: number) => `geo-e2e AUTOCOMPLETE v${String(version)}`;

test.describe.serial('geo controls: maker-checker budgets and aliases', () => {
  let maker: { context: BrowserContext; page: Page };
  let checker: { context: BrowserContext; page: Page };
  test.beforeAll(async ({ browser }) => {
    maker = await enrolled(browser, seed().makerInvitation, 'geo maker key');
    checker = await enrolled(browser, seed().checkerInvitation, 'geo checker key');
  });
  test.afterAll(async () => {
    await maker.context.close();
    await checker.context.close();
  });

  test('a catalog manager sees the Geo controls navigation and an accessible page', async () => {
    const { page } = maker;
    await expect(page.getByText('CATALOG_MANAGER')).toBeVisible();
    await page.getByRole('link', { name: 'Geo controls', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Geo controls' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Provider budgets' })).toBeVisible();
    await expectAccessible(page);
  });

  test('the maker drafts and submits an INITIAL budget and is never offered its approval', async () => {
    const m = maker.page;
    await draftBudget(m, '1000', '20000', '50');
    await expect(row(m, 1).getByTestId('budget-status')).toHaveText('DRAFT');
    await expect(row(m, 1)).toContainText('INITIAL');
    await expect(row(m, 1)).toContainText('USD 50.00');
    await row(m, 1)
      .getByRole('button', { name: `Submit for approval ${label(1)}` })
      .click();
    await expect(row(m, 1).getByTestId('budget-status')).toHaveText('PENDING_APPROVAL');
    await expect(m.getByRole('button', { name: `Approve ${label(1)}` })).toHaveCount(0);
    await expect(m.getByRole('button', { name: `Approve decrease ${label(1)}` })).toHaveCount(0);
    await expectAccessible(m);
  });

  test('the checker approves (fresh step-up) and activates; the database records two distinct staff', async () => {
    const c = checker.page;
    await c.goto('/geo');
    await row(c, 1)
      .getByRole('button', { name: `Approve ${label(1)}` })
      .click();
    await expect(row(c, 1).getByTestId('budget-status')).toHaveText('APPROVED');
    c.once('dialog', (d) => void d.accept());
    await row(c, 1)
      .getByRole('button', { name: `Activate ${label(1)}` })
      .click();
    await expect(row(c, 1).getByTestId('budget-status')).toHaveText('ACTIVE');
    await expectAccessible(c);
    const rows = await query<{ status: string; drafted_by_staff_id: string; approved_by_staff_id: string }>(
      `select status, drafted_by_staff_id, approved_by_staff_id from geo.provider_budgets where provider_key = 'geo-e2e' and sku = 'AUTOCOMPLETE' and version = 1`,
      [],
    );
    expect(rows).toEqual([{ status: 'ACTIVE', drafted_by_staff_id: seed().makerId, approved_by_staff_id: seed().checkerId }]);
  });

  test('a DECREASE of the budget in force is approved and activated by its drafter alone', async () => {
    const m = maker.page;
    await m.reload();
    await draftBudget(m, '500', '10000', '25.5');
    await expect(row(m, 2)).toContainText('DECREASE');
    await expect(row(m, 2)).toContainText('USD 25.50');
    await row(m, 2)
      .getByRole('button', { name: `Submit for approval ${label(2)}` })
      .click();
    await expect(row(m, 2).getByTestId('budget-status')).toHaveText('PENDING_APPROVAL');
    m.once('dialog', (d) => void d.accept());
    await row(m, 2)
      .getByRole('button', { name: `Approve decrease ${label(2)}` })
      .click();
    await expect(row(m, 2).getByTestId('budget-status')).toHaveText('APPROVED');
    m.once('dialog', (d) => void d.accept());
    await row(m, 2)
      .getByRole('button', { name: `Activate ${label(2)}` })
      .click();
    await expect(row(m, 2).getByTestId('budget-status')).toHaveText('ACTIVE');
    await expect(row(m, 1).getByTestId('budget-status')).toHaveText('RETIRED');
    const rows = await query<{ change_kind: string; drafted_by_staff_id: string; approved_by_staff_id: string }>(
      `select change_kind, drafted_by_staff_id, approved_by_staff_id from geo.provider_budgets where provider_key = 'geo-e2e' and sku = 'AUTOCOMPLETE' and version = 2`,
      [],
    );
    expect(rows).toEqual([{ change_kind: 'DECREASE', drafted_by_staff_id: seed().makerId, approved_by_staff_id: seed().makerId }]);
  });

  test('the hourly usage table shows aggregate rollups only', async () => {
    const m = maker.page;
    const form = m.getByRole('form', { name: 'Hourly usage' });
    await form.getByLabel('Range').selectOption('DAY');
    await form.getByLabel('Provider key (optional)').fill('geo-e2e');
    await form.getByRole('button', { name: 'Show usage' }).click();
    const table = m.getByTestId('geo-usage');
    await expect(table.getByRole('row')).toHaveCount(4);
    await expect(table).toContainText('AUTOCOMPLETE');
    await expect(table.getByRole('row', { name: /geo-e2e AUTOCOMPLETE 42 17/ })).toBeVisible();
    await expectAccessible(m);
  });

  test('a Roman-Urdu landmark alias is proposed by one manager and approved by the other', async () => {
    const m = maker.page;
    const form = m.getByRole('form', { name: 'Propose an alias' });
    await form.getByLabel('Language').selectOption('ur-Latn');
    await form.getByLabel('Alias (as riders type it)').fill('Badshahi');
    await form.getByLabel('Canonical search text').fill('Badshahi Mosque Lahore');
    await form.getByLabel('Source').selectOption('FOUNDER');
    await form.getByRole('button', { name: 'Create draft' }).click();
    const own = m.getByTestId('alias-row').filter({ hasText: 'badshahi mosque lahore' });
    await expect(own.getByTestId('alias-status')).toHaveText('PROPOSED');
    await expect(m.getByRole('button', { name: 'Approve alias Badshahi' })).toHaveCount(0);
    await expectAccessible(m);

    const c = checker.page;
    await c.reload();
    const theirs = c.getByTestId('alias-row').filter({ hasText: 'badshahi mosque lahore' });
    await theirs.getByRole('button', { name: 'Approve alias Badshahi' }).click();
    await expect(theirs.getByTestId('alias-status')).toHaveText('ACTIVE');
    await expectAccessible(c);
  });
});
