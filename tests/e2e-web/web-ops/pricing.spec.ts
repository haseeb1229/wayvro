/**
 * web-ops pricing administration (Phase 3, P3.3; H06/E05/B06; T3-23/T3-31/T3-33): two DISTINCT PRICING_MANAGER staff
 * and a read-only AUDITOR (../seed-pricing.mjs). The checker drafts a placeholder tax policy that only the maker may
 * approve; the maker drafts a synthetic LHR/COMFORT rate card with every component value and submits it; the maker is
 * never offered the approval and the API itself refuses a direct self-approval (403 MAKER_IS_CHECKER); the checker
 * approves with a reason (fresh WebAuthn step-up through the virtual authenticator) and activates it. A rollback to the
 * seeded RETIRED card creates a NEW pending version with a diff against the ACTIVE card; the preview tool compares
 * cards over the default synthetic benchmark set; the support quote lookup shows districts and exact PKR amounts and
 * never a coordinate. axe on every screen; synthetic data only. Card versions are read back, never assumed.
 */
import pg from 'pg';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { expectAccessible, stack, virtualAuthenticator, type OpsStack } from './helpers.js';

interface PricingSeed {
  readonly makerInvitation: string;
  readonly makerId: string;
  readonly checkerInvitation: string;
  readonly checkerId: string;
  readonly auditorInvitation: string;
  readonly fixtureCardVersion: number;
  readonly quoteId: string;
  readonly quoteGroupId: string;
  readonly pickup: { readonly lat: string; readonly lng: string };
  readonly dropoff: { readonly lat: string; readonly lng: string };
}
const seed = (): PricingSeed => (stack() as OpsStack & { readonly pricing: PricingSeed }).pricing;

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

async function openPricing(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Pricing', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Pricing' })).toBeVisible();
  await expect(page.getByTestId('tax-policy-E2E-SYNTH-TAX-v1')).toBeVisible();
}

const COMFORT = (version: number) => `LHR COMFORT v${String(version)}`;

test.describe.serial('pricing managers: maker-checker tax policies and rate cards', () => {
  let maker: { context: BrowserContext; page: Page };
  let checker: { context: BrowserContext; page: Page };
  let card: { id: string; version: number };
  test.beforeAll(async ({ browser }) => {
    maker = await enrolled(browser, seed().makerInvitation, 'pricing maker key');
    checker = await enrolled(browser, seed().checkerInvitation, 'pricing checker key');
  });
  test.afterAll(async () => {
    await maker.context.close();
    await checker.context.close();
  });

  test('a pricing manager sees the Pricing navigation and an accessible page with the seeded configuration', async () => {
    const { page } = maker;
    await expect(page.getByText('PRICING_MANAGER')).toBeVisible();
    for (const hidden of ['Staff', 'Audit', 'Review queue', 'Compliance', 'Support', 'Release controls', 'Geo controls']) {
      await expect(page.getByRole('link', { name: hidden, exact: true })).toHaveCount(0);
    }
    await openPricing(page);
    await expect(page.getByTestId('tax-policy-E2E-SYNTH-TAX-v1').getByTestId('tax-status')).toHaveText('APPROVED');
    await expect(page.getByTestId(`rate-card-LHR-COMFORT-v${String(seed().fixtureCardVersion)}`).getByTestId('rate-card-status')).toContainText('RETIRED');
    await expectAccessible(page);
  });

  test('the checker drafts and submits a placeholder tax policy; only the other pricing manager approves it', async () => {
    const c = checker.page;
    await openPricing(c);
    const form = c.getByRole('form', { name: 'Draft a tax policy' });
    await form.getByLabel('Code (e.g. PK-PB-SALES-TAX)').fill('E2E-TAX-PH');
    await form.getByLabel('Rate in basis points (100 = 1%)').fill('500');
    await form.getByRole('button', { name: 'Create draft' }).click();
    const row = c.getByTestId('tax-policy-E2E-TAX-PH-v1');
    await expect(row.getByTestId('tax-status')).toHaveText('DRAFT');
    await row.getByRole('button', { name: 'Submit for approval E2E-TAX-PH v1' }).click();
    await expect(row.getByTestId('tax-status')).toHaveText('PENDING_APPROVAL');
    await expect(c.getByRole('button', { name: 'Approve E2E-TAX-PH v1' })).toHaveCount(0);

    const m = maker.page;
    await m.reload();
    await m.getByRole('button', { name: 'Approve E2E-TAX-PH v1' }).click();
    await expect(m.getByTestId('tax-policy-E2E-TAX-PH-v1').getByTestId('tax-status')).toHaveText('APPROVED');
  });

  test('the maker drafts a rate card with every component and submits it; self-approval is never offered and the API refuses it', async () => {
    const m = maker.page;
    const form = m.getByRole('form', { name: 'Draft a rate card' });
    await form.getByLabel('Product', { exact: true }).fill('COMFORT');
    await form.getByLabel('Source reference').fill('SYNTHETIC — E2E rate card (not a Wayvro price)');
    await form.getByLabel('Synthetic (local/test only)').check();
    await form.getByLabel('Base fare (PKR)').fill('160');
    await form.getByLabel('Per kilometre (PKR)').fill('52');
    await form.getByLabel('Per minute (PKR)').fill('7.50');
    await form.getByLabel('Minimum fare (PKR)').fill('360');
    await form.getByLabel('Booking fee (PKR)').fill('10');
    await form.getByLabel('Airport pickup fee (PKR)').fill('200');
    await form.getByLabel('Rounding step (PKR)').fill('10');
    await form.getByLabel('Rounding mode').selectOption('HALF_UP');
    await form.getByLabel('Tolls').selectOption('EXCLUDED_DISCLOSED');
    await form.getByLabel('Tax policy').selectOption({ label: 'E2E-TAX-PH v1 — APPROVED — 5.00%' });
    await form.getByLabel('Quote validity (seconds)').fill('300');
    await form.getByLabel('Maximum distance (metres)').fill('60000');
    await form.getByLabel('Maximum duration (seconds)').fill('7200');
    await form.getByRole('button', { name: 'Create draft' }).click();

    const detail = m.getByTestId('rate-card-detail');
    await expect(detail.getByRole('heading', { name: /LHR COMFORT v\d+ — DRAFT/ })).toBeVisible();
    const rows = await query<{ id: string; version: number }>(
      `select id, version from pricing.rate_cards where city_code = 'LHR' and product_code = 'COMFORT' and drafted_by_staff_id = $1 order by version desc limit 1`,
      [seed().makerId],
    );
    const drafted = rows[0];
    if (!drafted) throw new Error('the drafted rate card is missing');
    card = drafted;
    const values = detail.getByTestId('rate-card-values');
    await expect(values).toContainText('PKR 160.00');
    await expect(values).toContainText('PKR 7.50');
    await expect(values).toContainText('Excluded and disclosed to the rider');
    await expect(detail).toContainText('There is no other ACTIVE card for this city and product.');
    await expectAccessible(m);

    await detail.getByRole('button', { name: `Submit for approval ${COMFORT(card.version)}` }).click();
    await expect(detail.getByRole('heading', { name: `Rate card ${COMFORT(card.version)} — PENDING_APPROVAL (synthetic)` })).toBeVisible();
    await expect(detail.getByTestId('pricing-preview')).toContainText('DEFAULT_SYNTHETIC_V1');
    await expect(detail.getByTestId('pricing-preview')).toContainText('PKR');
    await expect(m.getByRole('button', { name: `Approve ${COMFORT(card.version)}` })).toHaveCount(0);

    // the API refuses the maker's own approval even when the UI is bypassed (the hidden button is not the control)
    const direct = await m.request.post(`/bff/pricing/rate-cards/${card.id}/approval`, {
      headers: { origin: new URL(m.url()).origin },
      data: { decision: 'APPROVE', reasonCode: 'E2E_SELF_APPROVAL' },
    });
    expect(direct.status()).toBe(403);
    expect((await direct.json()) as unknown).toMatchObject({ error: { code: 'WAYVRO_E_FORBIDDEN', details: { reasonCodes: ['MAKER_IS_CHECKER'] } } });
    await expectAccessible(m);
  });

  test('the checker approves with a reason and activates; the database records two distinct staff', async () => {
    const c = checker.page;
    await c.reload();
    await c.getByRole('button', { name: `Open ${COMFORT(card.version)}` }).click();
    const detail = c.getByTestId('rate-card-detail');
    await expect(detail.getByRole('heading', { name: `Rate card ${COMFORT(card.version)} — PENDING_APPROVAL (synthetic)` })).toBeVisible();
    await expect(detail).toContainText('Within the sanity envelope.');
    await expectAccessible(c);
    c.once('dialog', (d) => void d.accept('E2E_REVIEWED'));
    await detail.getByRole('button', { name: `Approve ${COMFORT(card.version)}` }).click();
    await expect(detail.getByRole('heading', { name: `Rate card ${COMFORT(card.version)} — APPROVED (synthetic)` })).toBeVisible();
    await expect(detail).toContainText('E2E_REVIEWED');
    c.once('dialog', (d) => void d.accept());
    await detail.getByRole('button', { name: `Activate now ${COMFORT(card.version)}` }).click();
    await expect(detail.getByRole('heading', { name: `Rate card ${COMFORT(card.version)} — ACTIVE (synthetic)` })).toBeVisible();
    await expect(c.getByTestId(`rate-card-LHR-COMFORT-v${String(card.version)}`).getByTestId('rate-card-status')).toContainText('ACTIVE');
    await expectAccessible(c);
    const rows = await query<{ status: string; drafted_by_staff_id: string; approved_by_staff_id: string; approval_reason_code: string }>(
      `select status, drafted_by_staff_id, approved_by_staff_id, approval_reason_code from pricing.rate_cards where id = $1`,
      [card.id],
    );
    expect(rows).toEqual([
      { status: 'ACTIVE', drafted_by_staff_id: seed().makerId, approved_by_staff_id: seed().checkerId, approval_reason_code: 'E2E_REVIEWED' },
    ]);
  });

  test('a rollback creates a NEW pending version with a diff against the ACTIVE card; the other manager decides it', async () => {
    const c = checker.page;
    const fixture = seed().fixtureCardVersion;
    await c.getByRole('button', { name: `Open ${COMFORT(fixture)}` }).click();
    const detail = c.getByTestId('rate-card-detail');
    await expect(detail.getByRole('heading', { name: `Rate card ${COMFORT(fixture)} — RETIRED (synthetic)` })).toBeVisible();
    c.once('dialog', (d) => void d.accept());
    await detail.getByRole('button', { name: `Roll back to ${COMFORT(fixture)}` }).click();
    await expect(detail.getByRole('heading', { name: /LHR COMFORT v\d+ — PENDING_APPROVAL/ })).toBeVisible();
    const diff = detail.getByTestId('rate-card-diff');
    await expect(diff.getByRole('row', { name: /Base fare \(PKR\)/ })).toContainText('PKR 160.00');
    await expect(diff.getByRole('row', { name: /Base fare \(PKR\)/ })).toContainText('PKR 150.00');
    const rollback = (
      await query<{ id: string; version: number }>(
        `select id, version from pricing.rate_cards where city_code = 'LHR' and product_code = 'COMFORT' and drafted_by_staff_id = $1 and supersedes_id is not null`,
        [seed().checkerId],
      )
    )[0];
    if (!rollback) throw new Error('the rollback version is missing');
    await expect(c.getByRole('button', { name: `Approve ${COMFORT(rollback.version)}` })).toHaveCount(0);
    await expectAccessible(c);

    const m = maker.page;
    await m.reload();
    await m.getByRole('button', { name: `Open ${COMFORT(rollback.version)}` }).click();
    m.once('dialog', (d) => void d.accept('E2E_NOT_NEEDED'));
    await m
      .getByTestId('rate-card-detail')
      .getByRole('button', { name: `Reject ${COMFORT(rollback.version)}` })
      .click();
    await expect(
      m.getByTestId('rate-card-detail').getByRole('heading', { name: `Rate card ${COMFORT(rollback.version)} — REJECTED (synthetic)` }),
    ).toBeVisible();
  });

  test('the preview tool compares cards over the default synthetic benchmark set', async () => {
    const c = checker.page;
    await c.reload();
    const tool = c.getByRole('region', { name: 'Price preview' });
    await tool.getByRole('checkbox', { name: `Compare ${COMFORT(seed().fixtureCardVersion)} (RETIRED)` }).check();
    await tool.getByRole('checkbox', { name: `Compare ${COMFORT(card.version)} (ACTIVE)` }).check();
    await tool.getByRole('button', { name: 'Run preview' }).click();
    const table = tool.getByTestId('pricing-preview');
    await expect(table).toContainText('DEFAULT_SYNTHETIC_V1');
    await expect(table).toContainText('Difference vs the first card');
    await expectAccessible(c);
  });

  test('the support quote lookup shows districts and exact amounts, never a coordinate; unknown ids are refused', async () => {
    const c = checker.page;
    const lookup = c.getByRole('form', { name: 'Quote lookup (support)' });
    await lookup.getByLabel('Id', { exact: true }).fill(seed().quoteGroupId);
    await lookup.getByLabel('Reason for access').selectOption({ label: 'Fare dispute' });
    await lookup.getByRole('button', { name: 'Look up' }).click();
    const view = c.getByTestId('quote-view');
    await expect(view).toContainText('LHR-LAHORE');
    await expect(view.getByTestId('quote-option-COMFORT')).toContainText('PKR 470.00');
    await expect(view.getByTestId('quote-option-COMFORT')).toContainText('BASE PKR 150.00');
    await expect(view.getByTestId('quote-option-COMFORT')).toContainText('DISTANCE PKR 245.00');
    const shown = await c.getByRole('region', { name: 'Quote lookup (support)' }).innerText();
    for (const coordinate of [seed().pickup.lat, seed().pickup.lng, seed().dropoff.lat, seed().dropoff.lng, 'POINT']) {
      expect(shown).not.toContain(coordinate);
    }
    await expectAccessible(c);

    await lookup.getByLabel('Look up by').selectOption('quoteId');
    await lookup.getByLabel('Id', { exact: true }).fill('00000000-0000-7000-8000-0000000000e2');
    await lookup.getByRole('button', { name: 'Look up' }).click();
    await expect(c.getByRole('alert').filter({ hasText: 'No matching record was found.' })).toBeVisible();
    await expect(c.getByTestId('quote-view')).toHaveCount(0);
  });
});

test('a read-only AUDITOR sees pricing without any action or quote lookup', async ({ browser }) => {
  const auditor = await enrolled(browser, seed().auditorInvitation, 'pricing auditor key');
  try {
    await openPricing(auditor.page);
    for (const action of ['Create draft', 'Look up', 'Run preview', 'Approve', 'Activate now']) {
      await expect(auditor.page.getByRole('button', { name: action })).toHaveCount(0);
    }
    // the API itself refuses the permission (the UI hiding the form is not the control)
    const direct = await auditor.page.request.post('/bff/pricing/tax-policies', {
      headers: { origin: new URL(auditor.page.url()).origin },
      data: { code: 'E2E-AUDITOR', jurisdictionCode: 'PK', rateBp: 0, appliesTo: ['BASE'], inclusive: false, isPlaceholder: true },
    });
    expect(direct.status()).toBe(403);
    expect((await direct.json()) as unknown).toMatchObject({ error: { code: 'WAYVRO_E_FORBIDDEN' } });
    await expectAccessible(auditor.page);
  } finally {
    await auditor.context.close();
  }
});
