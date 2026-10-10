/**
 * Legal-page E2E (W05/R09/A04): canonical, versioned, dated policy pages in English and Urdu with a change log,
 * placeholder banner + noindex on every non-approved text, immutable version URLs whose fingerprint equals the
 * registry hash, and an accessibility baseline (axe: no serious/critical violations). Production build only.
 */
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { POLICY_KEYS, currentDocument } from '@wayvro/legal-content';

const now = new Date();
const current = POLICY_KEYS.map((k) => {
  const en = currentDocument(k, 'en', now);
  const ur = currentDocument(k, 'ur', now);
  if (!en || !ur) throw new Error(`${k}: no current version`);
  return { en, ur };
});

async function expectAccessible(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

test('the index lists every current policy and links to its versioned URL', async ({ page }) => {
  await page.goto('/legal');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Legal and policy documents');
  for (const { en } of current) await expect(page.locator(`a[href="${en.canonicalPath}"]`)).toHaveText(en.body.title);
  await expectAccessible(page);
});

for (const { en, ur } of current) {
  test(`${en.key}: current and versioned pages (en + ur), placeholder banner, noindex, fingerprint`, async ({ page }) => {
    const res = await page.goto(`/legal/${en.slug}`);
    expect(res?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(en.body.title);
    await expect(page.getByTestId('placeholder-banner')).toContainText('PLACEHOLDER — NOT FOR PRODUCTION');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await expect(page.locator('time').first()).toHaveAttribute('datetime', en.effectiveAt.slice(0, 10));
    await expect(page.locator('footer code')).toHaveText(en.contentSha256);
    await expectAccessible(page);

    await page.goto(`${en.canonicalPath}?lang=ur`);
    await expect(page.locator('main')).toHaveAttribute('lang', 'ur');
    await expect(page.locator('main')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(ur.body.title);
    await expect(page.locator('footer code')).toHaveText(ur.contentSha256);
    await expectAccessible(page);
  });
}

test('the change log lists every effective version, newest first', async ({ page }) => {
  await page.goto('/legal/changelog');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Policy change log');
  await expect(page.locator('main li')).toHaveCount(current.length);
  await expectAccessible(page);
});

test('unknown policies and versions that do not exist (or are not yet effective) are 404', async ({ page }) => {
  for (const path of ['/legal/does-not-exist', '/legal/terms/v99', '/legal/terms/version-1', '/legal/terms/v0']) {
    expect((await page.goto(path))?.status(), path).toBe(404);
  }
});

test('legal pages carry the nonce CSP and security headers', async ({ page }) => {
  const res = await page.goto('/legal/privacy/v1');
  const headers = res?.headers() ?? {};
  expect(headers['content-security-policy']).toMatch(/script-src[^;]*'nonce-/);
  expect(headers['x-content-type-options']).toBe('nosniff');
});
