'use client';

import { BREAK_GLASS_REASON_VALUES } from '@wayvro/contracts';
import { useEffect, useState } from 'react';
import { STRINGS } from '../content/strings';
import { BffError, addAuthenticator, bff } from './client';

const message = (e: unknown): string => (e instanceof BffError && e.status === 403 ? STRINGS.errors.forbidden : STRINGS.errors.generic);

interface AuditEvent {
  seq: string;
  occurredAt: string;
  actorType: string;
  actorId: string | null;
  action: string;
  objectType: string;
  outcome: string;
  reasonCode: string | null;
}

/** Audit viewer (AUDITOR): keyset pages of 50, filter by action code, seal status, verification request. */
export function AuditView() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [action, setAction] = useState('');
  const [seal, setSeal] = useState<{ sealCount: number; lastVerification: { ok: boolean; verifiedAt: string } | null } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [query, setQuery] = useState<{ readonly before: string | null; readonly filter: string }>({ before: null, filter: '' });
  useEffect(() => {
    let live = true;
    const q = new URLSearchParams();
    if (query.before) q.set('beforeSeq', query.before);
    if (query.filter) q.set('action', query.filter);
    Promise.all([
      bff<{ events: AuditEvent[]; nextBeforeSeq: string | null }>('GET', `audit-events${q.size ? `?${q.toString()}` : ''}`),
      bff<{ sealCount: number; lastVerification: { ok: boolean; verifiedAt: string } | null }>('GET', 'audit-seals/status'),
    ])
      .then(([page, sealStatus]) => {
        if (!live) return;
        setEvents(page.events);
        setNext(page.nextBeforeSeq);
        setSeal(sealStatus);
      })
      .catch((e: unknown) => {
        if (live) setStatus(message(e));
      });
    return () => {
      live = false;
    };
  }, [query]);
  return (
    <section aria-labelledby="audit-heading">
      <h1 id="audit-heading">{STRINGS.audit.heading}</h1>
      {status ? <p role="alert">{status}</p> : null}
      <h2>{STRINGS.audit.seals}</h2>
      <p>
        {seal
          ? `${String(seal.sealCount)} seals; last verification: ${seal.lastVerification ? `${seal.lastVerification.ok ? 'OK' : 'FAILED'} at ${seal.lastVerification.verifiedAt}` : 'none yet'}`
          : '…'}
      </p>
      <p>{STRINGS.audit.anchoring}</p>
      <button
        type="button"
        onClick={() => {
          void bff('POST', 'audit-seals/verifications', {}).catch((e: unknown) => {
            setStatus(message(e));
          });
        }}
      >
        {STRINGS.audit.verify}
      </button>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setQuery({ before: null, filter: action.trim().toUpperCase() });
        }}
      >
        <label>
          {STRINGS.audit.filterAction}
          <input
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
            }}
          />
        </label>
        <button type="submit">{STRINGS.audit.filterButton}</button>
      </form>
      <table>
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Time</th>
            <th scope="col">Actor</th>
            <th scope="col">Action</th>
            <th scope="col">Object</th>
            <th scope="col">Outcome</th>
            <th scope="col">Reason</th>
          </tr>
        </thead>
        <tbody>
          {events.map((ev) => (
            <tr key={ev.seq}>
              <td>{ev.seq}</td>
              <td>{ev.occurredAt}</td>
              <td>
                {ev.actorType} {ev.actorId ?? ''}
              </td>
              <td>{ev.action}</td>
              <td>{ev.objectType}</td>
              <td>{ev.outcome}</td>
              <td>{ev.reasonCode ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {next ? (
        <button
          type="button"
          onClick={() => {
            setQuery({ before: next, filter: action.trim().toUpperCase() });
          }}
        >
          {STRINGS.staff.more}
        </button>
      ) : null}
    </section>
  );
}

interface Grant {
  id: string;
  staffId: string;
  reasonCode: string;
  status: string;
  startedAt: string;
  expiresAt: string;
  reviewDueAt: string;
}

/** Break-glass: activation (confirmation + step-up), own end, reviews by someone else. */
export function BreakGlassView({ canActivate, canReview, selfId }: { readonly canActivate: boolean; readonly canReview: boolean; readonly selfId: string }) {
  const [grants, setGrants] = useState<Grant[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [active, setActive] = useState<Grant | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!canReview) return;
    let live = true;
    bff<{ grants: Grant[] }>('GET', 'break-glass')
      .then((r) => {
        if (live) setGrants(r.grants);
      })
      .catch((e: unknown) => {
        if (live) setStatus(message(e));
      });
    return () => {
      live = false;
    };
  }, [canReview, version]);
  const act = (fn: () => Promise<unknown>) => {
    setStatus(null);
    void fn()
      .then(() => {
        setVersion((v) => v + 1);
      })
      .catch((e: unknown) => {
        setStatus(message(e));
      });
  };
  return (
    <section aria-labelledby="bg-heading">
      <h1 id="bg-heading">{STRINGS.breakGlass.heading}</h1>
      {status ? <p role="alert">{status}</p> : null}
      {canActivate ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            if (!window.confirm(STRINGS.breakGlass.confirm)) return;
            act(async () => {
              setActive(
                await bff<Grant>('POST', 'break-glass', {
                  reasonCode: f.get('reasonCode'),
                  justification: f.get('justification'),
                  durationMinutes: Number(f.get('minutes')),
                }),
              );
            });
          }}
        >
          <h2>{STRINGS.breakGlass.activate}</h2>
          <label>
            {STRINGS.breakGlass.reason}
            <select name="reasonCode">
              {BREAK_GLASS_REASON_VALUES.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
          <label>
            {STRINGS.breakGlass.justification}
            <textarea name="justification" required minLength={10} maxLength={500} />
          </label>
          <label>
            {STRINGS.breakGlass.minutes}
            <input name="minutes" type="number" min={5} max={60} defaultValue={30} required />
          </label>
          <button type="submit">{STRINGS.breakGlass.activateButton}</button>
        </form>
      ) : null}
      {active ? (
        <button
          type="button"
          onClick={() => {
            act(() =>
              bff('POST', `break-glass/${active.id}/end`, {}).then(() => {
                setActive(null);
              }),
            );
          }}
        >
          {STRINGS.breakGlass.end}
        </button>
      ) : null}
      {canReview ? (
        <table>
          <thead>
            <tr>
              <th scope="col">Staff</th>
              <th scope="col">{STRINGS.breakGlass.reason}</th>
              <th scope="col">Status</th>
              <th scope="col">Review due</th>
              <th scope="col">{STRINGS.breakGlass.review}</th>
            </tr>
          </thead>
          <tbody>
            {grants.map((g) => (
              <tr key={g.id}>
                <td>{g.staffId}</td>
                <td>{g.reasonCode}</td>
                <td>{g.status}</td>
                <td>{g.reviewDueAt}</td>
                <td>
                  {g.status !== 'REVIEWED' && g.staffId !== selfId ? (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          act(() => bff('POST', `break-glass/${g.id}/review`, { outcome: 'JUSTIFIED' }));
                        }}
                      >
                        {STRINGS.breakGlass.justified}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          act(() => bff('POST', `break-glass/${g.id}/review`, { outcome: 'NOT_JUSTIFIED' }));
                        }}
                      >
                        {STRINGS.breakGlass.notJustified}
                      </button>
                    </>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}

/** Own security keys: register a backup key (step-up), remove one (never the last). */
export function SecurityKeys() {
  const [keys, setKeys] = useState<Array<{ id: string; nickname: string; createdAt: string; lastUsedAt: string | null }>>([]);
  const [name, setName] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const reload = () => {
    setVersion((v) => v + 1);
  };
  useEffect(() => {
    let live = true;
    bff<{ credentials: Array<{ id: string; nickname: string; createdAt: string; lastUsedAt: string | null }> }>('GET', 'me/credentials')
      .then((r) => {
        if (live) setKeys(r.credentials);
      })
      .catch((e: unknown) => {
        if (live) setStatus(message(e));
      });
    return () => {
      live = false;
    };
  }, [version]);
  return (
    <section aria-labelledby="keys-heading">
      <h1 id="keys-heading">{STRINGS.security.heading}</h1>
      {status ? <p role="alert">{status}</p> : null}
      <ul>
        {keys.map((k) => (
          <li key={k.id}>
            {k.nickname} — {k.createdAt}{' '}
            <button
              type="button"
              disabled={keys.length < 2}
              onClick={() => {
                void bff('DELETE', `me/credentials/${k.id}`)
                  .then(reload)
                  .catch((e: unknown) => {
                    setStatus(message(e));
                  });
              }}
            >
              {STRINGS.security.revoke}
            </button>
          </li>
        ))}
      </ul>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void addAuthenticator(name.trim())
            .then(reload)
            .catch((err: unknown) => {
              setStatus(message(err));
            });
        }}
      >
        <h2>{STRINGS.security.add}</h2>
        <label>
          {STRINGS.security.nickname}
          <input
            value={name}
            required
            maxLength={60}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </label>
        <button type="submit">{STRINGS.security.addButton}</button>
      </form>
    </section>
  );
}
