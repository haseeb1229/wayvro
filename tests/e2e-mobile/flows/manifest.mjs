/*
 * SP-08 flow manifest (docs/phase3/PHASE3_SP08_CROSS_MODE_E2E.md §5; PHASE3_TEST_STRATEGY §4.14). One row per runnable
 * matrix entry; tests/e2e-mobile/run-flows.mjs reads it. Tiers: `pr` = PR smoke (API 35, Mobile E2E job), `full` = the
 * manual workflow_dispatch matrix (API 29 + 35, .github/workflows/mobile-full.yml). Every SP-08 row that has no flow
 * here is listed with its reason (NOT TESTABLE / manual-device only) so nothing disappears silently.
 *
 *   file / sequence  Maestro file(s) under flows/; a sequence interleaves server-state hooks (run-flows.mjs `hooks`)
 *   before / after   hooks around the flow (`after` always runs, also on failure)
 *   checks           host-side assertions after a passing flow (run-flows.mjs `checks`)
 *   requires         `pricing`: NOT RUN (with the reason) when the stack seeded no ACTIVE synthetic rate card
 *   apiLevels        flows that tap OS permission dialogs run on API 35 only (SP-08 §6)
 *   inv07            INV-07 flows: never quarantined; FLAKY fails the run
 */
const hygiene = (opts = {}) => ({ name: 'riderHygiene', locationAllowed: false, locationAsked: false, ...opts });

export const FLOWS = [
  {
    id: 'pr-01-signin-rider-home',
    sp08: '#1, #12',
    accounts: ['A'],
    tiers: ['pr', 'full'],
    inv07: true,
    file: 'pr-01-signin-rider-home.yaml',
    checks: [hygiene()],
  },
  { id: 'pr-02-restore-rider', sp08: '#2', accounts: ['A'], tiers: ['pr', 'full'], file: 'pr-02-restore-rider.yaml' },
  { id: 'pr-03-driver-switch-restore', sp08: '#2, #4, NAV-01', accounts: ['C'], tiers: ['pr', 'full'], file: 'pr-03-driver-switch-restore.yaml' },
  {
    id: 'pr-04-earn-entry-rider-only',
    sp08: '#4',
    accounts: ['A'],
    tiers: ['pr', 'full'],
    inv07: true,
    file: 'pr-04-earn-entry-rider-only.yaml',
    checks: [hygiene()],
  },
  { id: 'pr-05-driver-role-restricted', sp08: '#4, NAV-02', accounts: ['D'], tiers: ['pr', 'full'], file: 'pr-05-driver-role-restricted.yaml' },
  { id: 'pr-06-account-restricted', sp08: '#4, NAV-05', accounts: ['E'], tiers: ['pr', 'full'], file: 'pr-06-account-restricted.yaml' },
  {
    id: 'pr-07-location-denied',
    sp08: '#10, LOC-03',
    accounts: ['A'],
    tiers: ['pr', 'full'],
    apiLevels: [35],
    file: 'pr-07-location-denied.yaml',
    checks: [hygiene({ locationAsked: true })],
  },
  { id: 'pr-08-search-autocomplete', sp08: '#14 (search), SRCH-01', accounts: ['A'], tiers: ['pr', 'full'], file: 'pr-08-search-autocomplete.yaml' },
  {
    id: 'pr-09-rider-hygiene-driver',
    sp08: '#12, RIDER-HYGIENE-01',
    accounts: ['B'],
    tiers: ['pr', 'full'],
    inv07: true,
    file: 'pr-09-rider-hygiene-driver.yaml',
    checks: [hygiene()],
  },
  { id: 'pr-10-quote-options', sp08: '#14, QUOTE-01', accounts: ['A'], tiers: ['pr', 'full'], requires: ['pricing'], file: 'pr-10-quote-options.yaml' },
  { id: 'pr-11-quote-restore', sp08: '#3, NAV-03', accounts: ['A'], tiers: ['pr', 'full'], requires: ['pricing'], file: 'pr-11-quote-restore.yaml' },
  { id: 'pr-12-kyc-onboarding', sp08: '#18', accounts: ['APPLICANT'], tiers: ['pr', 'full'], file: 'pr-12-kyc-onboarding.yaml' },
  {
    id: 'pr-13-version-hard',
    sp08: '#21 (HARD), UPD-02',
    accounts: ['A'],
    tiers: ['pr', 'full'],
    sequence: [{ maestro: 'pr-13a-version-hard-sign-in.yaml' }, { hook: 'activateHardUpdatePolicy' }, { maestro: 'pr-13b-version-hard-blocked.yaml' }],
    after: ['retireUpdatePolicies'],
  },
  { id: 'pr-14-signout-wipe', sp08: '#25', accounts: ['C', 'A'], tiers: ['pr', 'full'], file: 'pr-14-signout-wipe.yaml' },

  // ── full matrix only (manual workflow_dispatch, FA-16) ───────────────────────────────────────────────────────────
  { id: 'n-01-pending-application', sp08: '#4 (F), NAV-06', accounts: ['F'], tiers: ['full'], file: 'n-01-pending-application.yaml' },
  { id: 'n-02-expired-documents', sp08: '#4 (G), #20, ONB-02', accounts: ['G'], tiers: ['full'], file: 'n-02-expired-documents.yaml' },
  { id: 'n-03-back-stack', sp08: '#5', accounts: ['A'], tiers: ['full'], file: 'n-03-back-stack.yaml' },
  {
    id: 'n-04-location-precise',
    sp08: '#8, LOC-01',
    accounts: ['A'],
    tiers: ['full'],
    apiLevels: [35],
    file: 'n-04-location-precise.yaml',
    checks: [hygiene({ locationAllowed: true, locationAsked: true })],
  },
  { id: 'n-05-location-approximate', sp08: '#9, LOC-02', accounts: ['A'], tiers: ['full'], apiLevels: [35], file: 'n-05-location-approximate.yaml' },
  {
    id: 'n-06-location-revoked-background',
    sp08: '#11, LOC-05',
    accounts: ['A'],
    tiers: ['full'],
    apiLevels: [35],
    sequence: [{ maestro: 'n-06a-location-grant.yaml' }, { hook: 'revokeLocation' }, { maestro: 'n-06b-location-revoked.yaml' }],
  },
  { id: 'n-07-lazy-driver-modules', sp08: '#13', accounts: ['A'], tiers: ['full'], inv07: true, file: 'n-07-lazy-driver-modules.yaml', checks: [hygiene()] },
  { id: 'n-08-quote-expiry', sp08: '#15', accounts: ['A'], tiers: ['full'], requires: ['pricing'], file: 'n-08-quote-expiry.yaml' },
  { id: 'n-09-quote-refusals', sp08: '#16, QUOTE-02', accounts: ['A'], tiers: ['full'], requires: ['pricing'], file: 'n-09-quote-refusals.yaml' },
  {
    id: 'n-10-rider-quotes-switch-off',
    sp08: '#22',
    accounts: ['A', 'C'],
    tiers: ['full'],
    before: ['disableRiderQuotes'],
    file: 'n-10-rider-quotes-switch-off.yaml',
    after: ['enableRiderQuotes'],
  },
  { id: 'n-11-lite-mode', sp08: '#24, LITE-01', accounts: ['A'], tiers: ['full'], file: 'n-11-lite-mode.yaml' },
  {
    id: 'n-12-screenshots-urdu-font',
    sp08: '#26, RTL-01, A11Y-01 (capture; review is manual)',
    accounts: ['A'],
    tiers: ['full'],
    sequence: [{ maestro: 'n-12-screenshots-urdu-font.yaml' }, { hook: 'fontScale200' }, { maestro: 'n-12b-screenshots-font-200.yaml' }],
    after: ['fontScaleReset'],
  },
  { id: 'n-13-compliance-renewal', sp08: '#20', accounts: ['B'], tiers: ['full'], file: 'n-13-compliance-renewal.yaml' },
  {
    id: 'n-14-kyc-upload',
    sp08: '#19',
    accounts: ['APPLICANT'],
    tiers: ['full'],
    manualOnly:
      'needs a seeded emulator gallery image + photo-picker automation and the sanitiser/ClamAV/worker pipeline; not automated in Phase 3 (recorded NOT RUN, never PASS)',
  },
  { id: 'n-15-rate-limit', sp08: '#17', accounts: ['A'], tiers: ['full'], requires: ['pricing'], file: 'n-15-rate-limit.yaml' },
  {
    id: 'n-16-driver-onboarding-switch-off',
    sp08: '#23',
    accounts: ['A', 'F', 'C'],
    tiers: ['full'],
    notTestable:
      'driver.onboarding is a static feature-flag registry entry (packages/config/src/flags.ts), not a runtime switch: no runtime OFF state exists to set in Phase 3',
  },
  {
    id: 'n-17-external-links',
    sp08: '#7',
    accounts: [],
    tiers: ['full'],
    notTestable: 'no external URL scheme in release builds (CON-P3-07, F-P3-01); router unit tests cover parsing; activated after EG-15',
  },
];
