import { PolicyKeySchema, type AccountState } from '@wayvro/contracts';
import { z } from 'zod';
import { driverHomeAvailable, homeOf, modeAvailability, type AppMode, type ModeHome } from '../mode/availability';

/**
 * Intent router (V08; ADR-048; UX doc §7; T3-17/T3-18). Every navigation that does not start from a tap on a visible
 * control — restoration, in-app banners, system-delivered paths (`+native-intent`) and, later, notifications — goes
 * through ONE allowlist of intent kinds carrying ids only (never a route, URL, amount, role or mode). The router only
 * chooses where to look: the target screen's own server call proves ownership, and the server re-authorises everything.
 */
const Uuid = z.uuid();

export const IntentSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('OPEN_RIDER_HOME') }),
  z.strictObject({ kind: z.literal('OPEN_QUOTE'), quoteGroupId: Uuid }),
  z.strictObject({ kind: z.literal('OPEN_DRIVER_HOME') }),
  z.strictObject({ kind: z.literal('OPEN_DRIVER_APPLICATION') }),
  z.strictObject({ kind: z.literal('OPEN_DRIVER_COMPLIANCE') }),
  z.strictObject({ kind: z.literal('OPEN_DOCUMENT_RENEWAL'), documentId: Uuid }),
  z.strictObject({ kind: z.literal('OPEN_RESTRICTION_APPEAL'), restrictionId: Uuid }),
  z.strictObject({ kind: z.literal('OPEN_ACCOUNT_SECURITY') }),
  z
    .strictObject({
      kind: z.literal('OPEN_LEGAL'),
      policyKey: PolicyKeySchema.optional(),
      version: z
        .string()
        .regex(/^[1-9][0-9]{0,5}$/)
        .optional(),
    })
    .refine((v) => (v.policyKey === undefined) === (v.version === undefined), { message: 'policyKey and version go together' }),
]);
export type Intent = z.infer<typeof IntentSchema>;
/** @internal exported for unit tests */
export type IntentKind = Intent['kind'];

/** @internal exported for the exhaustive tests. */
export const INTENT_KINDS: readonly IntentKind[] = [
  'OPEN_RIDER_HOME',
  'OPEN_QUOTE',
  'OPEN_DRIVER_HOME',
  'OPEN_DRIVER_APPLICATION',
  'OPEN_DRIVER_COMPLIANCE',
  'OPEN_DOCUMENT_RENEWAL',
  'OPEN_RESTRICTION_APPEAL',
  'OPEN_ACCOUNT_SECURITY',
  'OPEN_LEGAL',
];

/**
 * Phase-3 refusal reasons only. NOT_FOUND_OR_NOT_OWNED is reported by the target screen after its own server call
 * (403/404). Phase 4 adds DRIVER_OBLIGATION_ACTIVE and RIDER_TRIP_ACTIVE additively.
 */
type RefusalReason = 'INTENT_UNKNOWN' | 'INTENT_MALFORMED' | 'MODE_NOT_AVAILABLE' | 'ACCOUNT_RESTRICTED' | 'NOT_FOUND_OR_NOT_OWNED';

type DeferReason = 'SIGN_IN' | 'REQUIRED_ACTION' | 'APP_POLICY';

/** A route target the router pushes on top of the mode home (path + string params; never a raw external URL). */
interface IntentTarget {
  readonly pathname: string;
  readonly params?: Readonly<Record<string, string>>;
}

export type IntentResolution =
  | { readonly kind: 'route'; readonly mode: AppMode; readonly home: ModeHome; readonly target: IntentTarget | null; readonly switched: boolean }
  | { readonly kind: 'defer'; readonly until: DeferReason }
  | { readonly kind: 'refuse'; readonly reason: RefusalReason };

export interface IntentContext {
  /** HARD_UPDATE / MAINTENANCE ⇒ blocked. */
  readonly appPolicy: 'ok' | 'blocked';
  readonly session: { readonly status: 'signed-out' } | { readonly status: 'signed-in'; readonly account: AccountState };
  /** The mode the user is in now. */
  readonly mode: AppMode;
}

const KNOWN_KINDS: ReadonlySet<string> = new Set(INTENT_KINDS);

function classifyInvalid(raw: unknown): RefusalReason {
  const kind = typeof raw === 'object' && raw !== null ? (raw as { readonly kind?: unknown }).kind : undefined;
  return typeof kind === 'string' && KNOWN_KINDS.has(kind) ? 'INTENT_MALFORMED' : 'INTENT_UNKNOWN';
}

const route = (mode: AppMode, current: AppMode, target: IntentTarget | null): IntentResolution => ({
  kind: 'route',
  mode,
  home: homeOf(mode),
  target,
  switched: mode !== current,
});

/**
 * Resolves an untrusted intent against FRESH server state. Order: validation → app policy → session → required
 * actions (never bypasses AccountGate) → per-kind availability. A driver intent switches to Driver mode only when the
 * server offers a driver home (entry HUB); otherwise it is refused, never routed into the driver graph.
 */
export function resolveIntent(raw: unknown, ctx: IntentContext): IntentResolution {
  const parsed = IntentSchema.safeParse(raw);
  if (!parsed.success) return { kind: 'refuse', reason: classifyInvalid(raw) };
  if (ctx.appPolicy === 'blocked') return { kind: 'defer', until: 'APP_POLICY' };
  if (ctx.session.status === 'signed-out') return { kind: 'defer', until: 'SIGN_IN' };
  const { account } = ctx.session;
  if (account.requiredActions.length > 0) return { kind: 'defer', until: 'REQUIRED_ACTION' };

  const availability = modeAvailability(account);
  const driverHome = driverHomeAvailable(availability);
  // Account-wide targets keep the current mode, unless that mode's home is gone.
  const here: AppMode = ctx.mode === 'DRIVER' && driverHome ? 'DRIVER' : 'RIDER';
  const intent = parsed.data;
  switch (intent.kind) {
    case 'OPEN_RIDER_HOME':
      return route('RIDER', ctx.mode, null);
    case 'OPEN_QUOTE':
      if (availability.rider.blockers.includes('ACCOUNT_RESTRICTED')) return { kind: 'refuse', reason: 'ACCOUNT_RESTRICTED' };
      return route('RIDER', ctx.mode, { pathname: '/ride/quote', params: { group: intent.quoteGroupId } });
    case 'OPEN_DRIVER_HOME':
      return driverHome ? route('DRIVER', ctx.mode, null) : { kind: 'refuse', reason: 'MODE_NOT_AVAILABLE' };
    case 'OPEN_DRIVER_APPLICATION':
      if (driverHome) return route('DRIVER', ctx.mode, { pathname: '/earn' });
      // Onboarding opens on top of the Rider home; no mode switch without a driver profile.
      return availability.driver.entry === 'ONBOARDING' && availability.driver.available
        ? route('RIDER', ctx.mode, { pathname: '/earn' })
        : { kind: 'refuse', reason: 'MODE_NOT_AVAILABLE' };
    case 'OPEN_DRIVER_COMPLIANCE':
      return driverHome ? route('DRIVER', ctx.mode, { pathname: '/earn/compliance' }) : { kind: 'refuse', reason: 'MODE_NOT_AVAILABLE' };
    case 'OPEN_DOCUMENT_RENEWAL':
      return driverHome
        ? route('DRIVER', ctx.mode, { pathname: '/earn/renewal', params: { document: intent.documentId } })
        : { kind: 'refuse', reason: 'MODE_NOT_AVAILABLE' };
    case 'OPEN_RESTRICTION_APPEAL':
      return route(here, ctx.mode, { pathname: '/account/appeal', params: { restriction: intent.restrictionId } });
    case 'OPEN_ACCOUNT_SECURITY':
      return route(here, ctx.mode, { pathname: '/account' });
    case 'OPEN_LEGAL':
      return route(
        here,
        ctx.mode,
        intent.policyKey === undefined || intent.version === undefined ? { pathname: '/legal' } : { pathname: `/legal/${intent.policyKey}/${intent.version}` },
      );
  }
}

/** Navigation steps for a routed intent: land on the mode home first (unless already there), then push the target. */
export type NavigationStep = { readonly op: 'replace'; readonly href: ModeHome } | { readonly op: 'push'; readonly target: IntentTarget };

export function navigationSteps(resolution: Extract<IntentResolution, { kind: 'route' }>, currentHome: ModeHome | null): readonly NavigationStep[] {
  const steps: NavigationStep[] = currentHome === resolution.home ? [] : [{ op: 'replace', href: resolution.home }];
  if (resolution.target !== null) steps.push({ op: 'push', target: resolution.target });
  return steps;
}
