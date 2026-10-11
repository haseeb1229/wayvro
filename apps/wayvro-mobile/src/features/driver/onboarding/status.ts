import { REVIEW_REASON_CATALOGUE, type AccountState, type DriverApplication } from '@wayvro/contracts';
import type { DriverStringKey } from '../i18n/driver-strings';

/**
 * Driver/Partner hub routing and status copy (P2.8; D04 state machine, K05 explanations). Everything is derived from
 * SERVER state — the account state's `driver` section and the current application with its `review` section — so a
 * restart, deep link or notification always lands on the same screen for the same server truth. The UI mode is never
 * an authorisation: these views only decide what to SHOW.
 */

type ApplicationState = DriverApplication['state'];
type Review = NonNullable<DriverApplication['review']>;
type Decision = NonNullable<Review['latestDecision']>;

/** Applicant may edit claims/vehicle/documents (mirrors the server's editable set). */
export const EDITABLE_STATES: ReadonlySet<ApplicationState> = new Set(['CONSENTED', 'DOCUMENTS_PENDING', 'NEEDS_INFO']);
/** No further evidence can be uploaded for these applications: their local queue items are abandoned (Q01). */
export const CLOSED_STATES: ReadonlySet<ApplicationState> = new Set([
  'SUBMITTED',
  'AUTO_CHECK_PENDING',
  'MANUAL_REVIEW',
  'REJECTED',
  'APPEALED',
  'REJECTED_FINAL',
  'WITHDRAWN',
  'EXPIRED_DRAFT',
]);

type ReasonCode = (typeof REVIEW_REASON_CATALOGUE)[keyof typeof REVIEW_REASON_CATALOGUE][number];
const KNOWN_REASONS: ReadonlySet<string> = new Set<ReasonCode>(Object.values(REVIEW_REASON_CATALOGUE).flat());
const isReasonCode = (code: string): code is ReasonCode => KNOWN_REASONS.has(code);
const reasonKey = (code: ReasonCode): DriverStringKey => `reason.${code}`;

export interface ReasonItem {
  readonly code: string;
  /** Copy for a catalogued code; null → only the reference code is shown (never a guessed explanation). */
  readonly key: DriverStringKey | null;
}

/** @internal exported for unit tests */
export function reasonItems(codes: readonly string[]): readonly ReasonItem[] {
  return codes.map((code) => ({ code, key: isReasonCode(code) ? reasonKey(code) : null }));
}

type StatusAction = 'appeal' | 'refresh' | 'start-again' | 'compliance';

export interface StatusModel {
  readonly tone: 'info' | 'warning' | 'error';
  readonly titleKey: DriverStringKey;
  readonly bodyKey: DriverStringKey;
  readonly reasons: readonly ReasonItem[];
  readonly decidedAt: string | null;
  readonly submittedAt: string | null;
  readonly actions: readonly StatusAction[];
  /** The decision an appeal would target (REJECTED, appealable, no open appeal). */
  readonly appealDecisionId: string | null;
  /** REJECTED_FINAL: support contact is a placeholder until launch. */
  readonly supportNote: boolean;
}

export type HubView =
  | { readonly kind: 'unavailable' }
  /** No application yet: explanation first (K14), then start. */
  | { readonly kind: 'intro' }
  /** DRAFT: explanation again, driver policies, then consent. */
  | { readonly kind: 'consent'; readonly application: DriverApplication }
  | { readonly kind: 'overview'; readonly application: DriverApplication; readonly needsInfo: readonly ReasonItem[] | null }
  | { readonly kind: 'status'; readonly application: DriverApplication; readonly status: StatusModel }
  | { readonly kind: 'compliance' };

const decisionOf = (application: DriverApplication): Decision | null => application.review?.latestDecision ?? null;

function status(
  application: DriverApplication,
  titleKey: DriverStringKey,
  bodyKey: DriverStringKey,
  extra: Partial<Pick<StatusModel, 'tone' | 'reasons' | 'actions' | 'appealDecisionId' | 'supportNote'>> = {},
): StatusModel {
  return {
    tone: extra.tone ?? 'info',
    titleKey,
    bodyKey,
    reasons: extra.reasons ?? [],
    decidedAt: decisionOf(application)?.decidedAt ?? null,
    submittedAt: application.submittedAt,
    actions: extra.actions ?? ['refresh'],
    appealDecisionId: extra.appealDecisionId ?? null,
    supportNote: extra.supportNote ?? false,
  };
}

/** The status shown for an application that is not editable (review, decisions, terminal states). @internal exported for unit tests */
export function statusModel(application: DriverApplication, onboardingAvailable: boolean): StatusModel {
  const decision = decisionOf(application);
  const inPerson = application.review?.inPersonRequired === true || decision?.decision === 'REQUIRE_IN_PERSON';
  const startAgain: readonly StatusAction[] = onboardingAvailable ? ['start-again'] : [];
  switch (application.state) {
    case 'SUBMITTED':
    case 'AUTO_CHECK_PENDING':
      return status(application, 'status.received.title', 'status.received.body');
    case 'MANUAL_REVIEW':
      return inPerson
        ? status(application, 'status.inPerson.title', 'status.inPerson.body', { tone: 'warning', reasons: reasonItems(decision?.reasonCodes ?? []) })
        : status(application, 'status.inReview.title', 'status.inReview.body');
    case 'REJECTED': {
      const appealable = decision !== null && decision.decision === 'REJECT' && decision.appealable && (application.review?.openAppealId ?? null) === null;
      return status(application, 'status.rejected.title', appealable ? 'status.rejected.body' : 'status.rejected.bodyNoAppeal', {
        tone: 'error',
        reasons: reasonItems(decision?.reasonCodes ?? []),
        actions: appealable ? ['appeal', 'refresh'] : ['refresh'],
        appealDecisionId: appealable ? decision.decisionId : null,
      });
    }
    case 'APPEALED':
      return status(application, 'status.appealed.title', 'status.appealed.body');
    case 'REJECTED_FINAL':
      return status(application, 'status.final.title', 'status.final.body', {
        tone: 'error',
        reasons: reasonItems(decision?.reasonCodes ?? []),
        actions: [],
        supportNote: true,
      });
    case 'VERIFIED':
      return status(application, 'status.verified.title', 'status.verified.body', { actions: ['compliance', 'refresh'] });
    case 'WITHDRAWN':
      return status(application, 'status.withdrawn.title', 'status.withdrawn.body', { actions: startAgain });
    case 'EXPIRED_DRAFT':
      return status(application, 'status.expired.title', 'status.expired.body', { actions: startAgain });
    case 'DRAFT':
    case 'CONSENTED':
    case 'DOCUMENTS_PENDING':
    case 'NEEDS_INFO':
      return status(application, 'overview.title', 'overview.body');
  }
}

/**
 * Which Driver/Partner screen the hub shows. A driver profile (verified driver) always opens the compliance view;
 * otherwise the application state decides. `application` is null when the account has none.
 */
export function hubView(driver: AccountState['driver'], application: DriverApplication | null): HubView {
  if (driver.profile !== null) return { kind: 'compliance' };
  if (application === null) return driver.onboardingAvailable ? { kind: 'intro' } : { kind: 'unavailable' };
  switch (application.state) {
    case 'DRAFT':
      return { kind: 'consent', application };
    case 'CONSENTED':
    case 'DOCUMENTS_PENDING':
      return { kind: 'overview', application, needsInfo: null };
    case 'NEEDS_INFO': {
      const decision = decisionOf(application);
      return { kind: 'overview', application, needsInfo: reasonItems(decision?.decision === 'NEEDS_INFO' ? decision.reasonCodes : []) };
    }
    case 'SUBMITTED':
    case 'AUTO_CHECK_PENDING':
    case 'MANUAL_REVIEW':
    case 'REJECTED':
    case 'APPEALED':
    case 'REJECTED_FINAL':
    case 'VERIFIED':
    case 'WITHDRAWN':
    case 'EXPIRED_DRAFT':
      return { kind: 'status', application, status: statusModel(application, driver.onboardingAvailable) };
  }
}
