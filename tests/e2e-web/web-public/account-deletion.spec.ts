/**
 * Web account-deletion page E2E (U06): explanation + form in English and Urdu, noindex, nonce CSP, no third-party
 * requests, display-level validation with announced errors, accessibility (axe: no serious/critical violations), and
 * the server-side forwarder's own refusals and fail-closed behaviour. Production build only.
 *
 * This project runs WITHOUT an API (playwright.config.ts points the forwarder at a closed port), so a valid submission
 * must end in the generic "not available" state. NOT covered here (needs the live API, P2.9 backend): the code step,
 * 401 invalid/expired code, 429 with retryAfterSeconds, 400 for a number the API rejects, and the generic confirmation.
 */
import { randomUUID } from 'node:crypto';
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type APIResponse, type Page } from '@playwright/test';

const ORIGIN = 'http://127.0.0.1:3210';
const SYNTHETIC_PHONE = '0300 0000000';
const VALID_OTP_BODY = { phone: SYNTHETIC_PHONE, browserId: 'e2e-browser-id-0000000001', locale: 'en' };

async function expectAccessible(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

test('the page explains deletion, is noindex, carries the nonce CSP and is accessible (en)', async ({ page }) => {
  const res = await page.goto('/account-deletion');
  expect(res?.status()).toBe(200);
  expect(res?.headers()['content-security-policy']).toMatch(/script-src[^;]*'nonce-/);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Delete your Wayvro account');
  for (const h of ['What deletion means', 'Grace period', 'What may be kept, and why', 'How it works', 'Request deletion']) {
    await expect(page.getByRole('heading', { level: 2, name: h })).toBeVisible();
  }
  await expect(page.getByText('The retention schedule is still pending legal review')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Read the privacy policy' })).toHaveAttribute('href', '/legal/privacy');
  await expect(page.getByLabel('Mobile number (+92)')).toHaveAttribute('autocomplete', 'tel');
  await expect(page.getByRole('button', { name: 'Send code' })).toBeEnabled();
  await expectAccessible(page);
});

test('the Urdu page is right-to-left, localised and accessible', async ({ page }) => {
  await page.goto('/account-deletion?lang=ur');
  await expect(page.locator('main')).toHaveAttribute('lang', 'ur');
  await expect(page.locator('main')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('اپنا وے ورو اکاؤنٹ ختم کریں');
  await expect(page.getByRole('button', { name: 'کوڈ بھیجیں' })).toBeEnabled();
  await expect(page.getByRole('link', { name: 'English' })).toHaveAttribute('href', '/account-deletion');
  await expectAccessible(page);
});

test('empty and impossible numbers are refused before anything is sent; the error is announced and focused', async ({ page }) => {
  const posted: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST') posted.push(r.url());
  });
  await page.goto('/account-deletion');
  const phone = page.getByLabel('Mobile number (+92)');
  const send = page.getByRole('button', { name: 'Send code' });

  await send.click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('Enter your mobile number.');
  await expect(phone).toHaveAttribute('aria-invalid', 'true');
  await expect(phone).toHaveAttribute('aria-describedby', 'deletion-phone-hint deletion-phone-error');
  await expect(phone).toBeFocused();
  await expectAccessible(page);

  await phone.fill('call me maybe');
  await phone.press('Enter');
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('Enter a valid Pakistani mobile number, for example 0300 1234567.');
  expect(posted).toEqual([]);
});

test('without a reachable API a valid submission ends in the generic "not available" state, never a confirmation', async ({ page }) => {
  const origins = new Set<string>();
  page.on('request', (r) => origins.add(new URL(r.url()).origin));
  await page.goto('/account-deletion');
  await page.getByLabel('Mobile number (+92)').fill(SYNTHETIC_PHONE);
  const answer = page.waitForResponse((r) => r.url().endsWith('/account-deletion/otp-challenges'));
  await page.getByRole('button', { name: 'Send code' }).click();
  expect((await answer).status()).toBe(503);
  await expect(page.getByTestId('deletion-form-error')).toHaveText('This service is not available right now. Please try again later.');
  await expect(page.getByRole('heading', { name: 'Enter the code' })).toHaveCount(0);
  await expect(page.getByTestId('deletion-done')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Send code' })).toBeEnabled();
  // no third-party request of any kind (scripts, fonts, analytics, the API itself)
  expect([...origins]).toEqual([ORIGIN]);
});

test.describe('forwarder refusals (same-origin route handlers, no API needed)', () => {
  const OTP = '/account-deletion/otp-challenges';
  const REQUEST = '/account-deletion/requests';
  const send = (request: APIRequestContext, path: string, data: string, headers: Record<string, string> = {}) =>
    request.post(path, { data, headers: { 'content-type': 'application/json', ...headers } });
  const codeOf = async (res: APIResponse): Promise<string> => ((await res.json()) as { error: { code: string } }).error.code;

  test('cross-site browser requests, non-JSON and oversized bodies are refused', async ({ request }) => {
    const body = JSON.stringify(VALID_OTP_BODY);
    const crossSite = await send(request, OTP, body, { 'sec-fetch-site': 'cross-site' });
    expect(crossSite.status()).toBe(403);
    expect(await codeOf(crossSite)).toBe('WAYVRO_E_FORBIDDEN');
    expect((await send(request, OTP, body, { 'content-type': 'text/plain' })).status()).toBe(415);
    expect((await send(request, OTP, JSON.stringify({ ...VALID_OTP_BODY, phone: 'x'.repeat(5000) }))).status()).toBe(413);
  });

  test('bodies that break the contract are refused with 400 before reaching the API', async ({ request }) => {
    const browserId = VALID_OTP_BODY.browserId;
    const cases: ReadonlyArray<readonly [string, string]> = [
      [OTP, 'not json'],
      [OTP, JSON.stringify({ ...VALID_OTP_BODY, browserId: 'short' })],
      [OTP, JSON.stringify({ ...VALID_OTP_BODY, extra: true })],
      [REQUEST, JSON.stringify({ challengeId: 'not-a-uuid', code: '123456', browserId })],
      [REQUEST, JSON.stringify({ challengeId: '00000000-0000-4000-8000-000000000000', code: '12345', browserId })],
    ];
    for (const [path, data] of cases) {
      const res = await send(request, path, data);
      expect(res.status(), data).toBe(400);
      expect(await codeOf(res)).toBe('WAYVRO_E_VALIDATION');
    }
  });

  test('a valid body with the API unreachable fails closed with a generic 503; other methods are not routed', async ({ request }) => {
    const res = await send(request, OTP, JSON.stringify(VALID_OTP_BODY), { 'idempotency-key': randomUUID() });
    expect(res.status()).toBe(503);
    expect(res.headers()['cache-control']).toContain('no-store');
    expect(await codeOf(res)).toBe('WAYVRO_E_DEPENDENCY_UNAVAILABLE');
    expect((await request.get(OTP)).status()).toBe(405);
  });
});
