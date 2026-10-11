'use client';

import {
  APPEAL_OUTCOME_REASONS,
  AdminAppealListSchema,
  CHECKLIST_ITEMS_V1,
  EvidenceAccessLogSchema,
  ExpiryRosterSchema,
  IDENTITY_MATCH_ASSESSMENTS,
  REVIEW_DECISIONS,
  REVIEW_REASON_CATALOGUE,
  ReviewCaseDetailSchema,
  ReviewCaseListSchema,
} from '@wayvro/contracts';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { STRINGS } from '../content/strings';
import { BffError, bff } from './client';

const R = STRINGS.review;
// stable parsers (contract schemas validate every response in the browser too)
const parseCaseList = (v: unknown) => ReviewCaseListSchema.parse(v);
const parseCase = (v: unknown) => ReviewCaseDetailSchema.parse(v);
const parseAppeals = (v: unknown) => AdminAppealListSchema.parse(v);
const parseRoster = (v: unknown) => ExpiryRosterSchema.parse(v);
const parseAccessLog = (v: unknown) => EvidenceAccessLogSchema.parse(v);
type CaseDetail = ReturnType<typeof parseCase>;
const V = STRINGS.viewer;
const message = (e: unknown): string =>
  e instanceof BffError && e.status === 403
    ? STRINGS.errors.forbidden
    : e instanceof BffError && (e.status === 409 || e.status === 410)
      ? STRINGS.errors.conflict
      : STRINGS.errors.generic;

/** Loads `path` whenever `version` changes and validates it with the contract schema; `live` guards unmounts. */
function useBff<T>(path: string | null, version: number, parse: (raw: unknown) => T): { data: T | null; error: string | null } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (path === null) return;
    let live = true;
    bff<unknown>('GET', path)
      .then((r) => {
        if (live) {
          setData(parse(r));
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (live) setError(message(e));
      });
    return () => {
      live = false;
    };
  }, [path, version, parse]);
  return { data, error };
}

/** Review queue: scoped, paginated (cursor), claim → case page. */
export function ReviewQueue() {
  const router = useRouter();
  const [mine, setMine] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const query = `review-cases?limit=20${mine ? '&mine=true' : ''}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
  const { data, error } = useBff(query, 0, parseCaseList);
  const claim = (id: string) => {
    setStatus(null);
    bff('POST', `review-cases/${id}/claim`, {})
      .then(() => {
        router.push(`/review/${id}`);
      })
      .catch((e: unknown) => {
        setStatus(message(e));
      });
  };
  return (
    <section aria-labelledby="queue-heading">
      <h2 id="queue-heading">{R.heading}</h2>
      <p>{R.note}</p>
      <label>
        <input
          type="checkbox"
          checked={mine}
          onChange={(e) => {
            setMine(e.target.checked);
            setCursor(null);
          }}
        />{' '}
        {R.mine}
      </label>
      {(error ?? status) ? <p role="alert">{error ?? status}</p> : null}
      {data && data.items.length === 0 ? <p>{R.empty}</p> : null}
      {data && data.items.length > 0 ? (
        <table>
          <thead>
            <tr>
              <th scope="col">{R.kind}</th>
              <th scope="col">{R.status}</th>
              <th scope="col">{R.priority}</th>
              <th scope="col">{R.signals}</th>
              <th scope="col">{R.created}</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((c) => (
              <tr key={c.id} data-testid="review-case-row">
                <td>{R.kinds[c.kind]}</td>
                <td>
                  {c.status}
                  {c.inPersonRequired ? ' · in person' : ''}
                </td>
                <td>{c.priority}</td>
                <td>{c.openSignals}</td>
                <td>{c.createdAt}</td>
                <td>
                  {c.assignedToMe ? (
                    <Link href={`/review/${c.id}`}>{R.open}</Link>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        claim(c.id);
                      }}
                    >
                      {R.claim}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {data?.nextCursor ? (
        <button
          type="button"
          onClick={() => {
            setCursor(data.nextCursor);
          }}
        >
          {R.more}
        </button>
      ) : null}
    </section>
  );
}

/** One fetch per one-time token (effects may run twice in development; a second fetch would be refused with 410). */
const images = new Map<string, Promise<Blob>>();
function oneTimeImage(token: string): Promise<Blob> {
  let pending = images.get(token);
  if (!pending) {
    pending = fetch(`/bff/evidence-views/${token}/content`, { credentials: 'same-origin', cache: 'no-store' }).then(async (res) => {
      if (!res.ok) throw new BffError(res.status, 'WAYVRO_E_GONE');
      return res.blob();
    });
    images.set(token, pending);
    // the decoded copy is dropped from memory shortly after it was drawn
    setTimeout(() => images.delete(token), 60_000);
  }
  return pending;
}

/**
 * Draws the one-time image onto a canvas with the per-view watermark burned into the pixels (fetched once as a blob;
 * never an <img> URL that could be re-fetched, cached or opened in a new tab). Screenshots cannot be prevented.
 */
function EvidenceCanvas({
  token,
  watermark,
  label,
  onError,
}: {
  readonly token: string;
  readonly watermark: string;
  readonly label: string;
  readonly onError: (m: string) => void;
}) {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (!canvas) return;
    let live = true;
    oneTimeImage(token)
      .then(async (blob) => {
        const bitmap = await createImageBitmap(blob);
        if (!live) return;
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(bitmap, 0, 0);
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = '#c00';
        ctx.font = `${String(Math.max(16, Math.round(bitmap.width / 30)))}px sans-serif`;
        for (let y = 40; y < bitmap.height; y += Math.max(80, Math.round(bitmap.height / 6))) ctx.fillText(watermark, 16, y);
        bitmap.close();
      })
      .catch((e: unknown) => {
        if (live) onError(message(e));
      });
    return () => {
      live = false;
    };
  }, [canvas, token, watermark, onError]);
  return (
    <canvas
      ref={setCanvas}
      role="img"
      aria-label={label}
      data-testid="evidence-canvas"
      onContextMenu={(e) => {
        e.preventDefault();
      }}
      style={{ maxWidth: '100%' }}
    />
  );
}

/** One-time evidence view: reason first (dialog), then the image with a per-view watermark; no download control. */
function EvidenceViewer({ evidenceId, viewer, onClose }: { readonly evidenceId: string; readonly viewer: string; readonly onClose: () => void }) {
  const [reason, setReason] = useState<keyof typeof V.reasons>('CASE_REVIEW');
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [at, setAt] = useState('');
  const show = () => {
    setError(null);
    bff<{ viewToken: string }>('POST', 'evidence-views', { evidenceId, reasonCode: reason })
      .then((r) => {
        setAt(new Date().toISOString());
        setToken(r.viewToken);
      })
      .catch((e: unknown) => {
        setError(message(e));
      });
  };
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="viewer-heading" data-testid="evidence-viewer">
      <h3 id="viewer-heading">{V.reasonHeading}</h3>
      {token === null ? (
        <>
          <p>{V.reasonBody}</p>
          <label>
            {V.reason}{' '}
            <select
              value={reason}
              onChange={(e) => {
                setReason(e.target.value as keyof typeof V.reasons);
              }}
            >
              {Object.entries(V.reasons).map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={show}>
            {V.show}
          </button>
        </>
      ) : (
        <figure className="evidence">
          <EvidenceCanvas token={token} watermark={`${V.watermark} ${viewer} · ${at}`} label={`Evidence ${evidenceId}`} onError={setError} />
          <figcaption data-testid="watermark">
            {V.watermark} {viewer} · {at}
          </figcaption>
        </figure>
      )}
      {error ? <p role="alert">{error}</p> : null}
      <button type="button" onClick={onClose}>
        {token === null ? V.cancel : V.close}
      </button>
    </div>
  );
}

type Decision = (typeof REVIEW_DECISIONS)[number];

function DecisionForm({ detail, onDone }: { readonly detail: CaseDetail; readonly onDone: (msg: string) => void }) {
  const [decision, setDecision] = useState<Decision>('NEEDS_INFO');
  const [reasons, setReasons] = useState<string[]>([]);
  const [checklist, setChecklist] = useState<Record<string, string>>(Object.fromEntries(CHECKLIST_ITEMS_V1.map((i) => [i, 'CONFIRMED'])));
  const [identity, setIdentity] = useState<string>('');
  const [relied, setRelied] = useState<string[]>([]);
  const [signals, setSignals] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const open = detail.duplicateSignals.filter((s) => s.status === 'OPEN');
  const toggle = (list: string[], value: string) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  const submit = () => {
    if (!window.confirm(R.confirmRecord)) return;
    setError(null);
    const signalResolutions = Object.entries(signals).map(([signalId, outcome]) => ({ signalId, outcome }));
    bff('POST', `review-cases/${detail.id}/decisions`, {
      expectedVersion: detail.version,
      decision,
      reasonCodes: reasons,
      checklist: { schemaVersion: 1, items: checklist },
      ...(identity ? { identityMatch: identity } : {}),
      evidenceIds: relied,
      ...(signalResolutions.length > 0 ? { signalResolutions } : {}),
    })
      .then(() => {
        onDone(R.recorded);
      })
      .catch((err: unknown) => {
        setError(message(err));
      });
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      aria-labelledby="decision-heading"
    >
      <h3 id="decision-heading">{R.decisionHeading}</h3>
      <label>
        {R.decision}{' '}
        <select
          value={decision}
          onChange={(e) => {
            setDecision(e.target.value as Decision);
            setReasons([]);
          }}
        >
          {REVIEW_DECISIONS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </label>
      <fieldset>
        <legend>{R.reasons}</legend>
        {REVIEW_REASON_CATALOGUE[decision].map((code) => (
          <label key={code}>
            <input
              type="checkbox"
              checked={reasons.includes(code)}
              onChange={() => {
                setReasons(toggle(reasons, code));
              }}
            />{' '}
            {code}
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>{R.checklist}</legend>
        {CHECKLIST_ITEMS_V1.map((item) => (
          <label key={item}>
            {item}{' '}
            <select
              value={checklist[item]}
              onChange={(e) => {
                setChecklist({ ...checklist, [item]: e.target.value });
              }}
            >
              <option value="CONFIRMED">CONFIRMED</option>
              <option value="NOT_CONFIRMED">NOT_CONFIRMED</option>
              <option value="NOT_APPLICABLE">NOT_APPLICABLE</option>
            </select>
          </label>
        ))}
      </fieldset>
      <label>
        {R.identity}{' '}
        <select
          value={identity}
          onChange={(e) => {
            setIdentity(e.target.value);
          }}
        >
          <option value="">—</option>
          {IDENTITY_MATCH_ASSESSMENTS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </label>
      <fieldset>
        <legend>{R.reliedOn}</legend>
        {detail.evidence
          .filter((e) => e.status === 'ACCEPTED')
          .map((e) => (
            <label key={e.evidenceId}>
              <input
                type="checkbox"
                checked={relied.includes(e.evidenceId)}
                onChange={() => {
                  setRelied(toggle(relied, e.evidenceId));
                }}
              />{' '}
              {e.kind}
            </label>
          ))}
      </fieldset>
      {open.length > 0 ? (
        <fieldset>
          <legend>{R.signalOutcome}</legend>
          {open.map((s) => (
            <label key={s.id}>
              {s.signal}{' '}
              <select
                value={signals[s.id] ?? ''}
                onChange={(e) => {
                  setSignals({ ...signals, [s.id]: e.target.value });
                }}
              >
                <option value="">—</option>
                <option value="CLEARED">CLEARED</option>
                <option value="CONFIRMED_FRAUD">CONFIRMED_FRAUD</option>
              </select>
            </label>
          ))}
        </fieldset>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      <button type="submit">{R.record}</button>
    </form>
  );
}

/**
 * ACCOUNT_RECOVERY: what is being recovered (display only). The approval rules — in-person identity check first, then
 * a second senior reviewer — are enforced by the server; the note only tells the reviewer what the server will require.
 */
function RecoverySection({ recovery }: { readonly recovery: CaseDetail['recovery'] }) {
  return (
    <section aria-labelledby="recovery-heading" data-testid="recovery-section">
      <h3 id="recovery-heading">{R.recoveryHeading}</h3>
      <p role="note">{R.recoveryApprovalNote}</p>
      {recovery ? (
        <dl>
          <dt>{R.recoveryKind}</dt>
          <dd>{R.recoveryKinds[recovery.kind]}</dd>
          <dt>{R.recoveryNewPhone}</dt>
          <dd>{recovery.maskedNewPhone ?? '—'}</dd>
          <dt>{R.recoveryRequestedAt}</dt>
          <dd>
            <time dateTime={recovery.requestedAt}>{recovery.requestedAt}</time>
          </dd>
        </dl>
      ) : null}
    </section>
  );
}

/** REVERIFICATION: the risk triggers behind the hold, shown as plain labels (no client-side interpretation). */
function RiskTriggers({ triggers }: { readonly triggers: readonly string[] }) {
  return (
    <section aria-labelledby="risk-triggers-heading" data-testid="risk-triggers">
      <h3 id="risk-triggers-heading">{R.riskTriggersHeading}</h3>
      {triggers.length === 0 ? (
        <p>{R.riskTriggersNone}</p>
      ) : (
        <ul>
          {triggers.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Case page: masked claims, documents, evidence (one-time views), signals, decisions, decision form, second approval. */
export function ReviewCase({ caseId, viewer, canSecondApprove }: { readonly caseId: string; readonly viewer: string; readonly canSecondApprove: boolean }) {
  const [version, setVersion] = useState(0);
  const [viewing, setViewing] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [decided, setDecided] = useState<string | null>(null);
  const { data: c, error } = useBff(decided === null ? `review-cases/${caseId}` : null, version, parseCase);
  const refresh = (msg: string | null = null) => {
    setNotice(msg);
    setVersion((v) => v + 1);
  };
  const act = (fn: () => Promise<unknown>) => {
    fn()
      .then(() => {
        refresh();
      })
      .catch((e: unknown) => {
        setNotice(message(e));
      });
  };
  // after a decision the claim ends (least privilege): confirm and lead back to the queue instead of re-reading the case
  if (decided !== null)
    return (
      <section aria-labelledby="decided-heading">
        <h2 id="decided-heading">{R.caseHeading}</h2>
        <p role="status" data-testid="decision-recorded">
          {decided}
        </p>
        <Link href="/review">{R.heading}</Link>
      </section>
    );
  if (error) return <p role="alert">{error}</p>;
  if (!c) return null;
  const docType = (documentId: string) => c.documents.find((d) => d.id === documentId)?.documentType ?? '';
  return (
    <section aria-labelledby="case-heading">
      <h2 id="case-heading">
        {R.caseHeading} · {R.kinds[c.kind]} · {c.status}
      </h2>
      {notice ? <p role="status">{notice}</p> : null}
      {c.leaseExpiresAt ? (
        <p>
          {R.leaseUntil} {c.leaseExpiresAt}{' '}
          <button
            type="button"
            onClick={() => {
              act(() => bff('POST', `review-cases/${c.id}/release`, {}));
            }}
          >
            {R.release}
          </button>
        </p>
      ) : null}
      {c.requirementSet?.isPlaceholder ? <p role="note">{R.placeholderSet}</p> : null}
      {c.subjectDocumentId ? <p role="note">{R.renewalSubject}</p> : null}
      {c.kind === 'ACCOUNT_RECOVERY' ? <RecoverySection recovery={c.recovery ?? null} /> : null}
      {c.kind === 'REVERIFICATION' ? <RiskTriggers triggers={c.riskTriggers ?? []} /> : null}
      <h3>{R.claims}</h3>
      <dl>
        <dt>{R.legalName}</dt>
        <dd>{c.application.claims.legalName ?? '—'}</dd>
        <dt>{R.cnic}</dt>
        <dd>{c.application.claims.cnicLast4 ?? '—'}</dd>
        <dt>{R.dob}</dt>
        <dd>{c.application.claims.dateOfBirth ?? '—'}</dd>
        <dt>{R.ageCheck}</dt>
        <dd>{c.application.ageCheck.outcome}</dd>
      </dl>
      <h3>{R.documents}</h3>
      <ul>
        {c.documents.map((d) => (
          <li key={d.id}>
            {d.documentType} · {d.status}
            {d.numberLast4 ? ` · …${d.numberLast4}` : ''}
            {d.licenceClass ? ` · ${d.licenceClass}` : ''}
            {d.claimedExpiresOn ? ` · ${d.claimedExpiresOn}` : ''}
            {d.id === c.subjectDocumentId ? <strong>{` · ${R.renewalMarker}`}</strong> : null}
          </li>
        ))}
      </ul>
      <h3>{R.vehicles}</h3>
      <ul>
        {c.vehicles.map((v) => (
          <li key={v.id}>
            {v.plateDisplay} · {v.make} {v.model} {v.modelYear} · {v.ownershipType}
          </li>
        ))}
      </ul>
      <h3>{R.evidence}</h3>
      <ul>
        {c.evidence.map((e) => (
          <li key={e.evidenceId}>
            {docType(e.documentId)} · {e.kind} · {e.status} · {e.captureSource}{' '}
            {e.status === 'ACCEPTED' ? (
              <button
                type="button"
                onClick={() => {
                  setViewing(e.evidenceId);
                }}
              >
                {R.view}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {viewing ? (
        <EvidenceViewer
          evidenceId={viewing}
          viewer={viewer}
          onClose={() => {
            setViewing(null);
          }}
        />
      ) : null}
      {c.captureChallenge ? (
        <p>
          {R.challenge}: {c.captureChallenge.challengeCode} · {c.captureChallenge.status}
        </p>
      ) : null}
      <h3>{R.signalsHeading}</h3>
      <ul>
        {c.duplicateSignals.map((s) => (
          <li key={s.id}>
            {s.signal} · {s.status}
          </li>
        ))}
      </ul>
      {c.appeal ? (
        <>
          <h3>{R.appeal}</h3>
          <blockquote>{c.appeal.statement}</blockquote>
        </>
      ) : null}
      <h3>{R.decisions}</h3>
      <ul>
        {c.decisions.map((d) => (
          <li key={d.id}>
            {d.decision} · {d.reasonCodes.join(', ')} · {d.decidedAt} · {d.secondApproval}
            {d.secondApproval === 'PENDING' && canSecondApprove && !d.decidedByMe ? (
              <>
                {' '}
                <button
                  type="button"
                  onClick={() => {
                    act(() => bff('POST', `review-decisions/${d.id}/second-approvals`, { outcome: 'APPROVED' }));
                  }}
                >
                  {R.secondApprove}
                </button>{' '}
                <button
                  type="button"
                  onClick={() => {
                    act(() => bff('POST', `review-decisions/${d.id}/second-approvals`, { outcome: 'REJECTED' }));
                  }}
                >
                  {R.secondReject}
                </button>
              </>
            ) : null}
          </li>
        ))}
      </ul>
      {c.status === 'CLAIMED' && c.leaseExpiresAt ? (
        <DecisionForm
          detail={c}
          onDone={(msg) => {
            setDecided(msg);
          }}
        />
      ) : null}
    </section>
  );
}

export function Appeals() {
  const A = STRINGS.appeals;
  const [version, setVersion] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<'UPHELD' | 'OVERTURNED'>('UPHELD');
  const [reason, setReason] = useState<string>(APPEAL_OUTCOME_REASONS[0]);
  const { data, error } = useBff('appeals', version, parseAppeals);
  const decide = (id: string) => {
    if (!window.confirm(A.confirm)) return;
    bff('POST', `appeals/${id}/decisions`, { outcome, reasonCode: reason })
      .then(() => {
        setVersion((v) => v + 1);
      })
      .catch((e: unknown) => {
        setStatus(message(e));
      });
  };
  return (
    <section aria-labelledby="appeals-heading">
      <h2 id="appeals-heading">{A.heading}</h2>
      <p>{A.note}</p>
      {(error ?? status) ? <p role="alert">{error ?? status}</p> : null}
      <label>
        {A.outcome}{' '}
        <select
          value={outcome}
          onChange={(e) => {
            setOutcome(e.target.value as 'UPHELD' | 'OVERTURNED');
          }}
        >
          <option value="UPHELD">UPHELD</option>
          <option value="OVERTURNED">OVERTURNED</option>
        </select>
      </label>{' '}
      <label>
        {A.reason}{' '}
        <select
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
          }}
        >
          {APPEAL_OUTCOME_REASONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>
      {data && data.items.length === 0 ? <p>{A.empty}</p> : null}
      <ul>
        {data?.items.map((a) => (
          <li key={a.id}>
            {a.subject} · {a.status} · {a.cityCode ?? '—'} · {a.createdAt}{' '}
            <button
              type="button"
              onClick={() => {
                decide(a.id);
              }}
            >
              {A.decide}
            </button>
            {a.reviewCaseId ? (
              <>
                {' '}
                <Link href={`/review/${a.reviewCaseId}`}>{A.openCase}</Link>
              </>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ExpiryRoster() {
  const X = STRINGS.expiry;
  const [within, setWithin] = useState(30);
  const [cursor, setCursor] = useState<string | null>(null);
  const { data, error } = useBff(
    `compliance/expiry-roster?withinDays=${String(within)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    0,
    parseRoster,
  );
  return (
    <section aria-labelledby="expiry-heading">
      <h2 id="expiry-heading">{X.heading}</h2>
      <p>{X.note}</p>
      <label>
        {X.within}{' '}
        <input
          type="number"
          min={0}
          max={365}
          value={within}
          onChange={(e) => {
            setWithin(Number(e.target.value));
            setCursor(null);
          }}
        />
      </label>
      {error ? <p role="alert">{error}</p> : null}
      {data && data.items.length === 0 ? <p>{X.empty}</p> : null}
      <ul>
        {data?.items.map((d) => (
          <li key={d.documentId}>
            {d.documentType} · {d.cityCode} · {d.status} · {X.expires} {d.expiresOn}
            {d.numberLast4 ? ` · …${d.numberLast4}` : ''}
          </li>
        ))}
      </ul>
      {data?.nextCursor ? (
        <button
          type="button"
          onClick={() => {
            setCursor(data.nextCursor);
          }}
        >
          {R.more}
        </button>
      ) : null}
    </section>
  );
}

export function EvidenceAccessLog() {
  const L = STRINGS.accessLog;
  const { data, error } = useBff('evidence-access-log?limit=50', 0, parseAccessLog);
  return (
    <section aria-labelledby="access-log-heading">
      <h2 id="access-log-heading">{L.heading}</h2>
      {error ? <p role="alert">{error}</p> : null}
      <table>
        <thead>
          <tr>
            <th scope="col">{L.at}</th>
            <th scope="col">{L.event}</th>
            <th scope="col">{L.reason}</th>
            <th scope="col">{L.evidence}</th>
            <th scope="col">{L.staff}</th>
          </tr>
        </thead>
        <tbody>
          {data?.items.map((e) => (
            <tr key={e.id}>
              <td>{e.at}</td>
              <td>
                {e.event}
                {e.breakGlass ? ` (${L.breakGlass})` : ''}
              </td>
              <td>{e.reasonCode}</td>
              <td>{e.evidenceId}</td>
              <td>{e.staffId}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
