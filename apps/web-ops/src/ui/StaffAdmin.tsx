'use client';

import { STAFF_ROLE_VALUES } from '@wayvro/contracts';
import { useEffect, useState } from 'react';
import { STRINGS } from '../content/strings';
import { BffError, bff } from './client';

interface RosterEntry {
  id: string;
  displayName: string;
  status: string;
  activeCredentials: number;
  roles: Array<{ assignmentId: string; role: string; status: string; cities: string[] }>;
}

const message = (e: unknown): string =>
  e instanceof BffError && e.status === 403
    ? STRINGS.errors.forbidden
    : e instanceof BffError && e.status === 409
      ? STRINGS.errors.conflict
      : STRINGS.errors.generic;

/** Staff roster (paginated, no export), invitations, maker-checker role requests/decisions, offboarding. */
export function StaffAdmin({ selfId }: { readonly selfId: string }) {
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [invitation, setInvitation] = useState<string | null>(null);

  // `page` drives (re)loading: a new object re-runs the effect (first page after an action, or the next page).
  const [page, setPage] = useState<{ readonly from: string | null }>({ from: null });
  useEffect(() => {
    let live = true;
    bff<{ staff: RosterEntry[]; nextCursor: string | null }>('GET', `staff${page.from ? `?cursor=${page.from}` : ''}`)
      .then((r) => {
        if (!live) return;
        setRoster(r.staff);
        setCursor(r.nextCursor);
      })
      .catch((e: unknown) => {
        if (live) setStatus(message(e));
      });
    return () => {
      live = false;
    };
  }, [page]);

  const act = (fn: () => Promise<unknown>) => {
    setStatus(null);
    void fn()
      .then(() => {
        setPage({ from: null });
      })
      .catch((e: unknown) => {
        setStatus(message(e));
      });
  };

  return (
    <section aria-labelledby="staff-heading">
      <h1 id="staff-heading">{STRINGS.staff.heading}</h1>
      {status ? <p role="alert">{status}</p> : null}
      <form
        aria-labelledby="invite-heading"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          act(async () => {
            const r = await bff<{ invitationToken: string }>('POST', 'staff-invitations', { displayName: f.get('displayName'), workEmail: f.get('workEmail') });
            setInvitation(r.invitationToken);
          });
        }}
      >
        <h2 id="invite-heading">{STRINGS.staff.invite}</h2>
        <label>
          {STRINGS.staff.name}
          <input name="displayName" required maxLength={80} />
        </label>
        <label>
          {STRINGS.staff.email}
          <input name="workEmail" type="email" required />
        </label>
        <button type="submit">{STRINGS.staff.inviteButton}</button>
      </form>
      {invitation ? (
        <p role="status">
          {STRINGS.staff.inviteResult} <code data-testid="invitation-token">{invitation}</code>
        </p>
      ) : null}
      <form
        aria-labelledby="grant-heading"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const rawCities = f.get('cities');
          const cities = (typeof rawCities === 'string' ? rawCities : '')
            .split(',')
            .map((c) => c.trim().toUpperCase())
            .filter((c) => c.length > 0);
          act(() => bff('POST', 'role-assignments', { staffId: f.get('staffId'), role: f.get('role'), cityCodes: cities }));
        }}
      >
        <h2 id="grant-heading">{STRINGS.staff.grant}</h2>
        <label>
          {STRINGS.staff.heading}
          <select name="staffId" required>
            {roster
              .filter((s) => s.id !== selfId && s.status !== 'OFFBOARDED')
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.displayName}
                </option>
              ))}
          </select>
        </label>
        <label>
          {STRINGS.staff.role}
          <select name="role" required>
            {STAFF_ROLE_VALUES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <label>
          {STRINGS.staff.cities}
          <input name="cities" />
        </label>
        <button type="submit">{STRINGS.staff.grantButton}</button>
      </form>
      <table>
        <caption>{STRINGS.staff.noExport}</caption>
        <thead>
          <tr>
            <th scope="col">{STRINGS.staff.name}</th>
            <th scope="col">Status</th>
            <th scope="col">{STRINGS.staff.role}</th>
            <th scope="col">Keys</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {roster.map((s) => (
            <tr key={s.id}>
              <td>{s.displayName}</td>
              <td>{s.status}</td>
              <td>
                <ul>
                  {s.roles.map((r) => (
                    <li key={r.assignmentId}>
                      {r.role}
                      {r.cities.length ? ` (${r.cities.join(', ')})` : ''}
                      {r.status === 'PENDING_APPROVAL' ? ` — ${STRINGS.staff.pending} ` : ' '}
                      {r.status === 'PENDING_APPROVAL' ? (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              act(() => bff('POST', `role-assignments/${r.assignmentId}/approval`, { decision: 'APPROVE' }));
                            }}
                          >
                            {STRINGS.staff.approve}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              act(() => bff('POST', `role-assignments/${r.assignmentId}/approval`, { decision: 'REJECT' }));
                            }}
                          >
                            {STRINGS.staff.reject}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            act(() => bff('POST', `role-assignments/${r.assignmentId}/revocation`, {}));
                          }}
                        >
                          {STRINGS.staff.revoke}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </td>
              <td>{s.activeCredentials}</td>
              <td>
                {s.id !== selfId && s.status !== 'OFFBOARDED' ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(STRINGS.staff.confirmOffboard)) act(() => bff('POST', `staff/${s.id}/offboarding`, {}));
                    }}
                  >
                    {STRINGS.staff.offboard}
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {cursor ? (
        <button
          type="button"
          onClick={() => {
            setPage({ from: cursor });
          }}
        >
          {STRINGS.staff.more}
        </button>
      ) : null}
    </section>
  );
}
