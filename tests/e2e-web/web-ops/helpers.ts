/** Shared web-ops E2E helpers: the stack file written by ../ops-stack.mjs, axe checks and Chromium's virtual authenticator. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AxeBuilder } from '@axe-core/playwright';
import { expect, type CDPSession, type Page } from '@playwright/test';

const ROOT = join(import.meta.dirname, '..', '..', '..');

export interface OpsStack {
  readonly databaseUrl: string;
  readonly invitations: string[];
  readonly reviewerInvitation: string;
  readonly caseId: string;
  /** ../seed-support.mjs: synthetic support journey (staff invitations, a rider with sessions, a driver-KYC recovery). */
  readonly support: {
    readonly supportInvitation: string;
    readonly auditorInvitation: string;
    readonly riderPhone: string;
    readonly riderAccountId: string;
    readonly driverAccountId: string;
    readonly recoveryId: string;
  };
}

export const stack = (): OpsStack => JSON.parse(readFileSync(join(ROOT, 'build-logs', 'e2e-ops.json'), 'utf8')) as OpsStack;

/**
 * WCAG 2.1 A/AA: no serious or critical violations.
 *
 * P3.0 (Web E2E flake on staff.spec.ts, PR #7): the scan must run on a SETTLED page. web-ops pages are dynamic
 * (`connection()`), so Next.js 16 streams their metadata and a client navigation (`router.push('/')` followed by
 * `router.refresh()`) can briefly leave the document without its `<title>`; an axe run inside that window reported
 * `document-title` although the settled page has its title. Waiting for a non-empty title is a deterministic page-ready
 * condition, not a sleep: a page that never gets a title still fails here (bounded by the expect timeout), and the axe
 * `document-title` rule stays enabled.
 */
export async function expectAccessible(page: Page): Promise<void> {
  await expect(page).toHaveTitle(/\S/);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

/** A user-verifying platform authenticator for this page's browser context (synthetic credentials only). */
export async function virtualAuthenticator(page: Page): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return cdp;
}
