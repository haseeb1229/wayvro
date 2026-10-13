/**
 * web-ops catalog journey (Phase 3, P3.1; E08/H10/R28): two DISTINCT CATALOG_MANAGER staff (../seed-catalog.mjs).
 * The maker drafts a synthetic zone set, sees the GeoJSON validation report refuse swapped coordinates (nothing
 * imported), imports valid synthetic geometry, sets daily hours and submits; the maker is never offered an approval of
 * their own draft; the checker approves (fresh WebAuthn step-up through the virtual authenticator) and activates. The
 * same maker-checker flow runs for a vehicle eligibility rule. An ENABLE request is refused fail-closed while no ACTIVE
 * rate card exists for the product (the E2E stack seeds none: ../seed-pricing.mjs leaves its COMFORT fixture card
 * RETIRED and pricing.spec activates only COMFORT) and the refusal reason is shown as text. The zone-set version is
 * read from the database (../seed-pricing.mjs holds a RETIRED synthetic LHR zone set for its quote fixture), never
 * assumed. axe on every screen; synthetic data only.
 */
import pg from 'pg';
import { expect, test, type BrowserContext, type Dialog, type Page } from '@playwright/test';
import { expectAccessible, stack, virtualAuthenticator } from './helpers.js';

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

/** Answers the next browser dialogs (confirm/prompt) in order with the given values. */
function answerDialogs(page: Page, answers: readonly string[]): void {
  const queue = [...answers];
  const handler = (d: Dialog) => {
    const next = queue.shift();
    void d.accept(next);
    if (queue.length === 0) page.off('dialog', handler);
  };
  page.on('dialog', handler);
}

const ring = (x0: number, y0: number, x1: number, y1: number) => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
  [x0, y0],
];
const feature = (coordinates: unknown, properties: Record<string, unknown>) => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates }, properties });
const SWAPPED = JSON.stringify({
  type: 'FeatureCollection',
  features: [feature([ring(31.4, 74.2, 31.65, 74.5)], { code: 'SVC', kind: 'SERVICE_AREA', nameEn: 'Synthetic', nameUr: 'مصنوعی' })],
});
const VALID = JSON.stringify({
  type: 'FeatureCollection',
  features: [
    feature([ring(74.2, 31.4, 74.5, 31.65)], { code: 'SVC', kind: 'SERVICE_AREA', nameEn: 'Synthetic service area', nameUr: 'مصنوعی' }),
    feature([ring(74.3, 31.575, 74.32, 31.59)], { code: 'EXC', kind: 'EXCLUSION', nameEn: 'Synthetic exclusion', nameUr: 'مصنوعی' }),
  ],
});

test.describe.serial('catalog manager maker-checker journey', () => {
  let maker: Page;
  let checker: Page;
  let makerContext: BrowserContext;
  let checkerContext: BrowserContext;
  /** The zone-set version this journey drafts (`v<n>`), read from the database before the draft. */
  let zv = '';
  test.beforeAll(async ({ browser }) => {
    makerContext = await browser.newContext();
    checkerContext = await browser.newContext();
    maker = await makerContext.newPage();
    checker = await checkerContext.newPage();
    await virtualAuthenticator(maker);
    await virtualAuthenticator(checker);
  });
  test.afterAll(async () => {
    await makerContext.close();
    await checkerContext.close();
  });

  test('both managers enrol and see the Catalog and Zones navigation only', async () => {
    await enrol(maker, stack().catalog.makerInvitation, 'maker key');
    await enrol(checker, stack().catalog.checkerInvitation, 'checker key');
    await expect(maker.getByText('CATALOG_MANAGER')).toBeVisible();
    for (const visible of ['Catalog', 'Zones']) await expect(maker.getByRole('link', { name: visible, exact: true })).toBeVisible();
    for (const hidden of ['Staff', 'Audit', 'Review queue', 'Compliance', 'Support'])
      await expect(maker.getByRole('link', { name: hidden, exact: true })).toHaveCount(0);
    await expectAccessible(maker);
  });

  test('the maker drafts a synthetic zone set; swapped coordinates are refused with a validation report; valid geometry imports', async () => {
    await maker.getByRole('link', { name: 'Zones', exact: true }).click();
    await expect(maker.getByRole('heading', { level: 1, name: 'Zone sets' })).toBeVisible();
    await expectAccessible(maker);
    const next = await query<{ next: number }>(`select coalesce(max(version), 0) + 1 as next from catalog.zone_sets where city_code = 'LHR'`, []);
    zv = `v${String(next[0]?.next ?? 1)}`;
    const draft = maker.getByRole('form', { name: 'Draft a zone set' });
    await draft.getByLabel('Source reference').fill('SYNTHETIC — not real Lahore boundaries (E2E)');
    await draft.getByRole('button', { name: 'Create draft' }).click();
    await maker.getByRole('button', { name: `Open ${zv}` }).click();
    const detail = maker.getByTestId('zone-set-detail');
    await expect(detail.getByRole('heading', { name: `LHR ${zv} — DRAFT` })).toBeVisible();
    const importForm = maker.getByRole('form', { name: 'Import GeoJSON' });
    await importForm.getByLabel('GeoJSON FeatureCollection (WGS84, [longitude, latitude])').fill(SWAPPED);
    await importForm.getByRole('button', { name: 'Validate and import' }).click();
    await expect(maker.getByTestId('import-report')).toContainText('AXIS_ORDER_SWAPPED');
    await expectAccessible(maker);
    await importForm.getByLabel('GeoJSON FeatureCollection (WGS84, [longitude, latitude])').fill(VALID);
    await importForm.getByRole('button', { name: 'Validate and import' }).click();
    await expect(detail.getByTestId('zone-SVC')).toContainText('SERVICE_AREA');
    await expect(detail.getByTestId('zone-EXC')).toContainText('EXCLUSION');
    await maker.getByRole('form', { name: 'Daily service hours' }).getByRole('button', { name: 'Set the same hours every day' }).click();
    await expect(detail.getByText('06:00–23:00').first()).toBeVisible();
    await maker.getByRole('button', { name: `Submit for approval ${zv}` }).click();
    await expect(maker.getByTestId(`zone-set-${zv}`)).toContainText('PENDING_APPROVAL');
    // the maker is never offered the approval of their own draft (the API refuses it as well)
    await expect(maker.getByRole('button', { name: `Approve ${zv}` })).toHaveCount(0);
  });

  test('the checker approves with a fresh step-up and activates; the database records two distinct staff', async () => {
    await checker.goto('/zones');
    await expect(checker.getByTestId(`zone-set-${zv}`)).toContainText('PENDING_APPROVAL');
    await checker.getByRole('button', { name: `Approve ${zv}` }).click();
    await expect(checker.getByTestId(`zone-set-${zv}`)).toContainText('APPROVED');
    answerDialogs(checker, ['']);
    await checker.getByRole('button', { name: `Activate ${zv}` }).click();
    await expect(checker.getByTestId(`zone-set-${zv}`)).toContainText('ACTIVE');
    await expectAccessible(checker);
    const rows = await query<{ status: string; drafted_by_staff_id: string; approved_by_staff_id: string }>(
      `select status, drafted_by_staff_id, approved_by_staff_id from catalog.zone_sets where city_code = 'LHR' and version = $1`,
      [Number(zv.slice(1))],
    );
    expect(rows).toEqual([{ status: 'ACTIVE', drafted_by_staff_id: stack().catalog.makerId, approved_by_staff_id: stack().catalog.checkerId }]);
  });

  test('an eligibility rule goes through the same maker-checker lifecycle', async () => {
    await maker.getByRole('link', { name: 'Catalog', exact: true }).click();
    await expect(maker.getByRole('heading', { level: 1, name: 'Service catalog' })).toBeVisible();
    await expectAccessible(maker);
    const form = maker.getByRole('form', { name: 'Draft a rule' });
    await form.getByLabel('Product', { exact: true }).fill('ECONOMY');
    await form.getByLabel('Source', { exact: true }).fill('SYNTHETIC — not a Punjab/Lahore regulatory value');
    await form.getByLabel('Maximum vehicle age (years)').fill('15');
    await form.getByLabel('Synthetic (local/test only)').check();
    await form.getByRole('button', { name: 'Create draft' }).click();
    await maker.getByRole('button', { name: 'Submit for approval ECONOMY v1' }).click();
    await expect(maker.getByTestId('rule-ECONOMY-v1')).toContainText('PENDING_APPROVAL');
    await expect(maker.getByRole('button', { name: 'Approve ECONOMY v1' })).toHaveCount(0);
    await checker.goto('/catalog');
    await checker.getByRole('button', { name: 'Approve ECONOMY v1' }).click();
    await expect(checker.getByTestId('rule-ECONOMY-v1')).toContainText('APPROVED');
    answerDialogs(checker, ['']);
    await checker.getByRole('button', { name: 'Activate ECONOMY v1' }).click();
    await expect(checker.getByTestId('rule-ECONOMY-v1')).toContainText('ACTIVE');
  });

  test('an ENABLE request without an ACTIVE rate card is refused fail-closed, and the reason is shown as text', async () => {
    await maker.goto('/catalog');
    await expect(maker.getByTestId('city-product-LHR-BIKE')).toContainText('DISABLED_LEGAL_GATE');
    await expect(maker.getByRole('button', { name: 'Request enable BIKE' })).toHaveCount(0);
    answerDialogs(maker, ['COUNSEL-MEMO-SYNTHETIC-E2E', 'LAUNCH_READY']);
    await maker.getByRole('button', { name: 'Request enable ECONOMY' }).click();
    await expect(maker.getByRole('alert').filter({ hasText: 'PREREQ_RATE_CARD_MISSING' })).toBeVisible();
    await expect(maker.getByTestId('city-product-LHR-ECONOMY')).toContainText('NOT_CONFIGURED');
    await expectAccessible(maker);
  });
});
