'use client';

import {
  AccountSupportSummarySchema,
  RecoveryAssistanceSchema,
  SUPPORT_ACCESS_REASONS,
  SupportSessionRevocationResultSchema,
  type AccountSupportSummary,
} from '@wayvro/contracts';
import { useLayoutEffect, useRef, useState, type SubmitEvent } from 'react';
import { STRINGS } from '../content/strings';
import { BffError, bff } from './client';

const S = STRINGS.support;
type Reason = (typeof SUPPORT_ACCESS_REASONS)[number];
type SummaryRequest = { readonly phone: string; readonly reasonCode: Reason } | { readonly accountId: string; readonly reasonCode: Reason };
type RevokeTarget = { readonly scope: 'ALL' } | { readonly scope: 'ONE'; readonly sessionId: string };
type Recovery = NonNullable<AccountSupportSummary['recovery']>;

/** Recovery kinds backed by a proof the server can review (the server still decides whether assistance applies). */
const ASSISTABLE: ReadonlySet<Recovery['kind']> = new Set<Recovery['kind']>(['LOST_PHONE_DRIVER_KYC', 'DORMANT_NUMBER']);

/** User-safe message for a failed call: stable status classes only, never the server's or provider's text. */
function failure(e: unknown): string {
  if (!(e instanceof BffError)) return STRINGS.errors.generic;
  switch (e.status) {
    case 400:
      return STRINGS.errors.validation;
    case 403:
      return STRINGS.errors.forbidden;
    case 404:
      return STRINGS.errors.notFound;
    case 409:
      return STRINGS.errors.conflict;
    case 429:
      return STRINGS.errors.rateLimited;
    case 503:
      return STRINGS.errors.unavailable;
    default:
      return STRINGS.errors.generic;
  }
}

const reasonOf = (v: FormDataEntryValue | null): Reason | null => SUPPORT_ACCESS_REASONS.find((r) => r === v) ?? null;
const str = (v: FormDataEntryValue | null): string => (typeof v === 'string' ? v.trim() : '');
const yesNo = (v: boolean): string => (v ? S.yes : S.no);

async function fetchSummary(body: SummaryRequest): Promise<AccountSupportSummary> {
  return AccountSupportSummarySchema.parse(await bff<unknown>('POST', 'account-summaries', body));
}

/** Required reason from the closed list; no reason is preselected so every access names its own. */
function ReasonSelect({ id }: { readonly id: string }) {
  return (
    <>
      <label htmlFor={id}>{S.reason}</label>
      <select id={id} name="reasonCode" required defaultValue="">
        <option value="" disabled>
          {S.reasonPlaceholder}
        </option>
        {SUPPORT_ACCESS_REASONS.map((r) => (
          <option key={r} value={r}>
            {S.reasons[r]}
          </option>
        ))}
      </select>
    </>
  );
}

/**
 * Masked account summary for support / Trust & Safety (staff matrix §4). One account at a time, always for a recorded
 * reason; the page renders exactly the contract's privacy-minimised fields. Revocation and recovery assistance are
 * offered only when the server-provided permissions include them (UX only — the API authorises and audits every call).
 */
export function SupportConsole({ canRevoke, canAssist }: { readonly canRevoke: boolean; readonly canAssist: boolean }) {
  const [by, setBy] = useState<'phone' | 'accountId'>('phone');
  const [summary, setSummary] = useState<AccountSupportSummary | null>(null);
  const [reason, setReason] = useState<Reason | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<RevokeTarget | null>(null);
  const subject = useRef<HTMLInputElement>(null);
  const latest = useRef(0);

  const load = (body: SummaryRequest, onLoaded: () => void) => {
    const request = ++latest.current;
    setBusy(true);
    setError(null);
    fetchSummary(body)
      .then((s) => {
        if (request !== latest.current) return;
        setSummary(s);
        setReason(body.reasonCode);
        onLoaded();
      })
      .catch((e: unknown) => {
        if (request === latest.current) setError(failure(e));
      })
      .finally(() => {
        if (request === latest.current) setBusy(false);
      });
  };

  const onLookup = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const reasonCode = reasonOf(f.get('reasonCode'));
    const value = str(f.get('subject'));
    if (reasonCode === null || value === '') return;
    setNotice(null);
    setSummary(null);
    load(by === 'phone' ? { phone: value, reasonCode } : { accountId: value, reasonCode }, () => {
      // the typed number is not kept on screen once the masked summary is shown
      if (subject.current) subject.current.value = '';
    });
  };

  const refresh = () => {
    if (summary && reason) load({ accountId: summary.accountId, reasonCode: reason }, () => undefined);
  };

  return (
    <section aria-labelledby="support-heading">
      <h1 id="support-heading">{S.heading}</h1>
      <p>{S.note}</p>
      <form onSubmit={onLookup} aria-labelledby="lookup-heading">
        <h2 id="lookup-heading">{S.lookupHeading}</h2>
        <label htmlFor="lookup-by">{S.lookupBy}</label>
        <select
          id="lookup-by"
          value={by}
          onChange={(e) => {
            setBy(e.target.value === 'accountId' ? 'accountId' : 'phone');
          }}
        >
          <option value="phone">{S.byPhone}</option>
          <option value="accountId">{S.byAccount}</option>
        </select>
        <label htmlFor="lookup-subject">{by === 'phone' ? S.phone : S.accountId}</label>
        {by === 'phone' ? (
          <input key="phone" ref={subject} id="lookup-subject" name="subject" type="tel" inputMode="tel" autoComplete="off" required maxLength={40} />
        ) : (
          <input key="accountId" ref={subject} id="lookup-subject" name="subject" autoComplete="off" required pattern="[0-9a-fA-F-]{36}" spellCheck={false} />
        )}
        <ReasonSelect id="lookup-reason" />
        <button type="submit" disabled={busy}>
          {S.lookUp}
        </button>
      </form>
      {busy ? <p role="status">{S.loading}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {notice ? (
        <p role="status" data-testid="support-notice">
          {notice}
        </p>
      ) : null}
      {summary ? (
        <SummaryView
          summary={summary}
          canRevoke={canRevoke}
          canAssist={canAssist}
          onRevoke={(target) => {
            setNotice(null);
            setRevoking(target);
          }}
        />
      ) : null}
      {summary && revoking ? (
        <RevokeDialog
          accountId={summary.accountId}
          target={revoking}
          onCancel={() => {
            setRevoking(null);
          }}
          onDone={(count) => {
            setRevoking(null);
            setNotice(`${S.revoked} ${String(count)}`);
            refresh();
          }}
        />
      ) : null}
    </section>
  );
}

function SummaryView({
  summary,
  canRevoke,
  canAssist,
  onRevoke,
}: {
  readonly summary: AccountSupportSummary;
  readonly canRevoke: boolean;
  readonly canAssist: boolean;
  readonly onRevoke: (target: RevokeTarget) => void;
}) {
  return (
    <section aria-labelledby="summary-heading" data-testid="account-summary">
      <h2 id="summary-heading">{S.summaryHeading}</h2>
      <dl>
        <dt>{S.account}</dt>
        <dd>{summary.accountId}</dd>
        <dt>{S.status}</dt>
        <dd>{summary.status}</dd>
        <dt>{S.maskedPhone}</dt>
        <dd data-testid="masked-phone">{summary.maskedPhone ?? S.noPhone}</dd>
        <dt>{S.createdOn}</dt>
        <dd>
          <time dateTime={summary.createdOn}>{summary.createdOn}</time>
        </dd>
        <dt>{S.riderProfile}</dt>
        <dd>{yesNo(summary.riderProfile)}</dd>
        <dt>{S.driverApplication}</dt>
        <dd>{summary.driver.applicationState ?? S.none}</dd>
        <dt>{S.driverProfile}</dt>
        <dd>{summary.driver.profileState ?? S.none}</dd>
        <dt>{S.driverCity}</dt>
        <dd>{summary.driver.cityCode ?? S.none}</dd>
        <dt>{S.deviceCount}</dt>
        <dd>{summary.deviceCount}</dd>
        <dt>{S.deletion}</dt>
        <dd>{summary.deletion?.status ?? S.none}</dd>
        <dt>{S.requiredActions}</dt>
        <dd>{summary.requiredActions.length > 0 ? summary.requiredActions.join(', ') : S.none}</dd>
      </dl>

      <h3>{S.factorsHeading}</h3>
      <dl>
        <dt>{S.linkedOidc}</dt>
        <dd>{yesNo(summary.strongRecoveryFactors.linkedOidc)}</dd>
        <dt>{S.driverKyc}</dt>
        <dd>{yesNo(summary.strongRecoveryFactors.driverKyc)}</dd>
      </dl>

      <h3>{S.restrictionsHeading}</h3>
      {summary.restrictions.length === 0 ? (
        <p>{S.restrictionsEmpty}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th scope="col">{S.scope}</th>
              <th scope="col">{S.reasonClass}</th>
              <th scope="col">{S.reasonCode}</th>
              <th scope="col">{S.restrictionStatus}</th>
            </tr>
          </thead>
          <tbody>
            {summary.restrictions.map((r, i) => (
              <tr key={`${r.scope}-${r.reasonCode}-${String(i)}`}>
                <td>{r.scope}</td>
                <td>{r.reasonClass}</td>
                <td>{r.reasonCode}</td>
                <td>{r.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3>{S.sessionsHeading}</h3>
      {summary.sessions.length === 0 ? (
        <p data-testid="sessions-empty">{S.sessionsEmpty}</p>
      ) : (
        <>
          <table>
            <thead>
              <tr>
                <th scope="col">{S.platform}</th>
                <th scope="col">{S.assurance}</th>
                <th scope="col">{S.sessionCreated}</th>
                <th scope="col">{S.sessionLastUsed}</th>
                {canRevoke ? <th scope="col">{S.actions}</th> : null}
              </tr>
            </thead>
            <tbody>
              {summary.sessions.map((s) => (
                <tr key={s.id} data-testid="support-session-row">
                  <td>{s.platform}</td>
                  <td>{s.assurance}</td>
                  <td>
                    <time dateTime={s.createdAt}>{s.createdAt}</time>
                  </td>
                  <td>
                    <time dateTime={s.lastUsedAt}>{s.lastUsedAt}</time>
                  </td>
                  {canRevoke ? (
                    <td>
                      <button
                        type="button"
                        aria-label={`${S.revokeOne}: ${s.platform}, ${s.createdAt}`}
                        onClick={() => {
                          onRevoke({ scope: 'ONE', sessionId: s.id });
                        }}
                      >
                        {S.revokeOne}
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
          {canRevoke ? (
            <button
              type="button"
              onClick={() => {
                onRevoke({ scope: 'ALL' });
              }}
            >
              {S.revokeAll}
            </button>
          ) : null}
        </>
      )}

      {summary.recovery ? <RecoveryView key={summary.recovery.id} recovery={summary.recovery} canAssist={canAssist} /> : null}
    </section>
  );
}

/**
 * Destructive confirmation for an on-behalf sign-out: a modal dialog (focus kept inside, Escape cancels, focus returns
 * to the opener) with a required reason. The API demands a fresh staff step-up, which `bff` performs with the
 * security key and then retries once with the same idempotency key.
 */
function RevokeDialog({
  accountId,
  target,
  onCancel,
  onDone,
}: {
  readonly accountId: string;
  readonly target: RevokeTarget;
  readonly onCancel: () => void;
  readonly onDone: (revokedCount: number) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useLayoutEffect(() => {
    const d = dialog.current;
    d?.showModal();
    return () => {
      d?.close();
    };
  }, []);
  const submit = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    const reasonCode = reasonOf(new FormData(e.currentTarget).get('reasonCode'));
    if (reasonCode === null) return;
    setPending(true);
    setError(null);
    const body = target.scope === 'ONE' ? { scope: 'ONE', sessionId: target.sessionId, reasonCode } : { scope: 'ALL', reasonCode };
    bff<unknown>('POST', `accounts/${accountId}/session-revocations`, body)
      .then((raw) => {
        onDone(SupportSessionRevocationResultSchema.parse(raw).revokedCount);
      })
      .catch((err: unknown) => {
        setPending(false);
        setError(failure(err));
      });
  };
  return (
    <dialog
      ref={dialog}
      aria-labelledby="revoke-heading"
      aria-describedby="revoke-body"
      data-testid="revoke-dialog"
      onCancel={(e) => {
        e.preventDefault();
        if (!pending) onCancel();
      }}
    >
      <form onSubmit={submit}>
        <h2 id="revoke-heading">{target.scope === 'ONE' ? S.revokeOneHeading : S.revokeAllHeading}</h2>
        <p id="revoke-body">{S.revokeBody}</p>
        <ReasonSelect id="revoke-reason" />
        {error ? <p role="alert">{error}</p> : null}
        <button type="submit" disabled={pending}>
          {S.confirmRevoke}
        </button>
        <button type="button" disabled={pending} onClick={onCancel}>
          {S.cancel}
        </button>
      </form>
    </dialog>
  );
}

/** The account's open recovery request (display only) and, for proof-bearing kinds, the hand-off to human review. */
function RecoveryView({ recovery, canAssist }: { readonly recovery: Recovery; readonly canAssist: boolean }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ readonly reviewCaseId: string; readonly opened: boolean; readonly priority: number } | null>(null);
  const submit = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    const reasonCode = reasonOf(new FormData(e.currentTarget).get('reasonCode'));
    if (reasonCode === null) return;
    setPending(true);
    setError(null);
    bff<unknown>('POST', `account-recoveries/${recovery.id}/assistance`, { reasonCode })
      .then((raw) => {
        setResult(RecoveryAssistanceSchema.parse(raw));
      })
      .catch((err: unknown) => {
        setError(failure(err));
      })
      .finally(() => {
        setPending(false);
      });
  };
  return (
    <section aria-labelledby="recovery-heading" data-testid="support-recovery">
      <h3 id="recovery-heading">{S.recoveryHeading}</h3>
      <dl>
        <dt>{S.recoveryKind}</dt>
        <dd>{S.recoveryKinds[recovery.kind]}</dd>
        <dt>{S.recoveryStatus}</dt>
        <dd>{recovery.status}</dd>
      </dl>
      {ASSISTABLE.has(recovery.kind) ? (
        <>
          <p role="note">{S.recoveryNote}</p>
          {canAssist && result === null ? (
            <form onSubmit={submit} aria-labelledby="assist-heading">
              <h4 id="assist-heading">{S.assist}</h4>
              <ReasonSelect id="assist-reason" />
              <button type="submit" disabled={pending}>
                {S.assist}
              </button>
            </form>
          ) : null}
        </>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {result ? (
        <div data-testid="assist-result">
          <p role="status">{S.assisted}</p>
          <dl>
            <dt>{S.reviewCase}</dt>
            <dd data-testid="assist-case-id">{result.reviewCaseId}</dd>
            <dt>{S.opened}</dt>
            <dd>{yesNo(result.opened)}</dd>
            <dt>{S.priority}</dt>
            <dd>{result.priority}</dd>
          </dl>
        </div>
      ) : null}
    </section>
  );
}
