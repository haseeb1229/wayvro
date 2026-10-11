/**
 * Driver/Partner application state machine (D04/K05; data model §4.5). Only listed transitions are accepted, each by
 * a named actor class. There is NO automated edge into VERIFIED: only a human REVIEWER decision reaches it (K04/K05,
 * docs/12 gate "driver cannot become active on a face score"). Terminal states are absorbing.
 */
/** @internal exported for property tests */
export const APPLICATION_STATES = [
  'DRAFT',
  'CONSENTED',
  'DOCUMENTS_PENDING',
  'SUBMITTED',
  'AUTO_CHECK_PENDING',
  'MANUAL_REVIEW',
  'NEEDS_INFO',
  'REJECTED',
  'APPEALED',
  'REJECTED_FINAL',
  'VERIFIED',
  'WITHDRAWN',
  'EXPIRED_DRAFT',
] as const;
export type ApplicationState = (typeof APPLICATION_STATES)[number];
export type TransitionActor = 'APPLICANT' | 'SYSTEM' | 'REVIEWER';

/** @internal exported for property tests */
export const TERMINAL_APPLICATION_STATES: ReadonlySet<ApplicationState> = new Set(['REJECTED_FINAL', 'VERIFIED', 'WITHDRAWN', 'EXPIRED_DRAFT']);

/** States in which the applicant may still edit claims, vehicles and documents. */
export const EDITABLE_APPLICATION_STATES: ReadonlySet<ApplicationState> = new Set(['DRAFT', 'CONSENTED', 'DOCUMENTS_PENDING', 'NEEDS_INFO']);

const TRANSITIONS: ReadonlyArray<readonly [ApplicationState, ApplicationState, TransitionActor]> = [
  ['DRAFT', 'CONSENTED', 'APPLICANT'],
  ['CONSENTED', 'DOCUMENTS_PENDING', 'APPLICANT'],
  ['DOCUMENTS_PENDING', 'SUBMITTED', 'APPLICANT'],
  ['NEEDS_INFO', 'SUBMITTED', 'APPLICANT'],
  ['SUBMITTED', 'AUTO_CHECK_PENDING', 'SYSTEM'],
  ['AUTO_CHECK_PENDING', 'MANUAL_REVIEW', 'SYSTEM'],
  ['MANUAL_REVIEW', 'NEEDS_INFO', 'REVIEWER'],
  ['MANUAL_REVIEW', 'REJECTED', 'REVIEWER'],
  ['MANUAL_REVIEW', 'VERIFIED', 'REVIEWER'],
  ['REJECTED', 'APPEALED', 'APPLICANT'],
  ['APPEALED', 'MANUAL_REVIEW', 'REVIEWER'],
  ['APPEALED', 'REJECTED_FINAL', 'REVIEWER'],
  ['DRAFT', 'WITHDRAWN', 'APPLICANT'],
  ['CONSENTED', 'WITHDRAWN', 'APPLICANT'],
  ['DOCUMENTS_PENDING', 'WITHDRAWN', 'APPLICANT'],
  ['NEEDS_INFO', 'WITHDRAWN', 'APPLICANT'],
  ['DRAFT', 'EXPIRED_DRAFT', 'SYSTEM'],
  ['CONSENTED', 'EXPIRED_DRAFT', 'SYSTEM'],
  ['DOCUMENTS_PENDING', 'EXPIRED_DRAFT', 'SYSTEM'],
];

export function canTransition(from: ApplicationState, to: ApplicationState, actor: TransitionActor): boolean {
  return TRANSITIONS.some(([f, t, a]) => f === from && t === to && a === actor);
}

/** Every (from, to, actor) the machine accepts (property tests, docs). @internal */
export function allTransitions(): ReadonlyArray<readonly [ApplicationState, ApplicationState, TransitionActor]> {
  return TRANSITIONS;
}
