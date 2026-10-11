'use client';

import { useEffect, useState } from 'react';
import { STRINGS } from '../content/strings';
import { BffError, bff } from './client';

const message = (e: unknown): string =>
  e instanceof BffError && e.status === 403
    ? STRINGS.errors.forbidden
    : e instanceof BffError && e.status === 409
      ? STRINGS.errors.conflict
      : STRINGS.errors.generic;
const C = STRINGS.compliance;

interface SetSummary {
  id: string;
  cityCode: string;
  serviceCategory: string;
  version: number;
  status: string;
  isPlaceholder: boolean;
  sourceReference: string;
  draftedByStaffId: string | null;
}
interface SetItem {
  documentType: string;
  mandatory: boolean;
  minValidityDaysAtSubmission: number;
  renewalLeadDays: number;
  appliesToOwnershipTypes: string[];
  licenceClassesAllowed: string[];
}

/** Requirement sets: drafts start from the ACTIVE set's items; a different admin approves; activation retires the old set. */
export function RequirementSets({ selfId }: { readonly selfId: string }) {
  const [sets, setSets] = useState<SetSummary[]>([]);
  const [version, setVersion] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    bff<{ sets: SetSummary[] }>('GET', 'requirement-sets')
      .then((r) => {
        if (live) setSets(r.sets);
      })
      .catch((e: unknown) => {
        if (live) setStatus(message(e));
      });
    return () => {
      live = false;
    };
  }, [version]);
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
  const draftFrom = (base: SetSummary, sourceReference: string) => {
    act(async () => {
      const full = await bff<{ items: SetItem[] }>('GET', `requirement-sets/${base.id}`);
      await bff('POST', 'requirement-sets', { cityCode: base.cityCode, serviceCategory: base.serviceCategory, sourceReference, items: full.items });
    });
  };
  return (
    <section aria-labelledby="sets-heading">
      <h2 id="sets-heading">{C.setsHeading}</h2>
      <p>{C.setsNote}</p>
      {status ? <p role="alert">{status}</p> : null}
      <table>
        <thead>
          <tr>
            <th scope="col">{C.city}</th>
            <th scope="col">{C.category}</th>
            <th scope="col">{C.version}</th>
            <th scope="col">Status</th>
            <th scope="col">{C.source}</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {sets.map((s) => (
            <tr key={s.id}>
              <td>{s.cityCode}</td>
              <td>{s.serviceCategory}</td>
              <td>{s.version}</td>
              <td>
                {s.status}
                {s.isPlaceholder ? ` — ${C.placeholder}` : ''}
              </td>
              <td>{s.sourceReference}</td>
              <td>
                {s.status === 'ACTIVE' ? (
                  <button
                    type="button"
                    onClick={() => {
                      const ref = window.prompt(C.sourcePrompt);
                      if (ref && ref.trim().length >= 3) draftFrom(s, ref.trim());
                    }}
                  >
                    {C.draftFrom}
                  </button>
                ) : null}
                {s.status === 'DRAFT' ? (
                  <button
                    type="button"
                    onClick={() => {
                      act(() => bff('POST', `requirement-sets/${s.id}/submission`, {}));
                    }}
                  >
                    {C.submit}
                  </button>
                ) : null}
                {s.status === 'PENDING_APPROVAL' && s.draftedByStaffId !== selfId ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        act(() => bff('POST', `requirement-sets/${s.id}/approval`, { decision: 'APPROVE' }));
                      }}
                    >
                      {STRINGS.staff.approve}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        act(() => bff('POST', `requirement-sets/${s.id}/approval`, { decision: 'REJECT' }));
                      }}
                    >
                      {STRINGS.staff.reject}
                    </button>
                  </>
                ) : null}
                {s.status === 'APPROVED' ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(C.confirmActivate)) act(() => bff('POST', `requirement-sets/${s.id}/activation`, {}));
                    }}
                  >
                    {C.activate}
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

interface AgeVersion {
  version: number;
  status: string;
  riderDeclarationMode: string;
  riderMinimumAge: number | null;
  driverMinimumAge: number | null;
  approvalRef: string | null;
  effectiveAt: string;
  draftedByStaffId: string | null;
}

/** Age-policy data entry: values from counsel's decision only (EG-23); a different admin approves. */
export function AgePolicies({ selfId }: { readonly selfId: string }) {
  const [versions, setVersions] = useState<AgeVersion[]>([]);
  const [version, setVersion] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    bff<{ versions: AgeVersion[] }>('GET', 'age-policies')
      .then((r) => {
        if (live) setVersions(r.versions);
      })
      .catch((e: unknown) => {
        if (live) setStatus(message(e));
      });
    return () => {
      live = false;
    };
  }, [version]);
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
  const num = (v: FormDataEntryValue | null): number | null => (typeof v === 'string' && v.trim() !== '' ? Number(v) : null);
  const str = (v: FormDataEntryValue | null): string => (typeof v === 'string' ? v.trim() : '');
  return (
    <section aria-labelledby="age-heading">
      <h2 id="age-heading">{C.ageHeading}</h2>
      <p>{C.ageNote}</p>
      {status ? <p role="alert">{status}</p> : null}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          act(() =>
            bff('POST', 'age-policies', {
              riderDeclarationMode: str(f.get('mode')),
              riderMinimumAge: num(f.get('riderMin')),
              driverMinimumAge: num(f.get('driverMin')),
              guardianRulesRef: str(f.get('guardian')) || null,
              approvalRef: str(f.get('approvalRef')),
              effectiveAt: new Date(str(f.get('effectiveAt'))).toISOString(),
            }),
          );
        }}
      >
        <label>
          {C.mode}
          <select name="mode">
            <option value="NONE">NONE</option>
            <option value="AFFIRM_MINIMUM_AGE">AFFIRM_MINIMUM_AGE</option>
            <option value="DATE_OF_BIRTH_REQUIRED">DATE_OF_BIRTH_REQUIRED</option>
          </select>
        </label>
        <label>
          {C.riderMin}
          <input name="riderMin" type="number" min={1} max={120} />
        </label>
        <label>
          {C.driverMin}
          <input name="driverMin" type="number" min={1} max={120} required />
        </label>
        <label>
          {C.guardian}
          <input name="guardian" maxLength={200} />
        </label>
        <label>
          {C.approvalRef}
          <input name="approvalRef" required maxLength={200} />
        </label>
        <label>
          {C.effectiveAt}
          <input name="effectiveAt" type="datetime-local" required />
        </label>
        <button type="submit">{C.enterValues}</button>
      </form>
      <table>
        <thead>
          <tr>
            <th scope="col">{C.version}</th>
            <th scope="col">Status</th>
            <th scope="col">{C.mode}</th>
            <th scope="col">{C.riderMin}</th>
            <th scope="col">{C.driverMin}</th>
            <th scope="col">{C.effectiveAt}</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {versions.map((v) => (
            <tr key={v.version}>
              <td>{v.version}</td>
              <td>{v.status}</td>
              <td>{v.riderDeclarationMode}</td>
              <td>{v.riderMinimumAge ?? '—'}</td>
              <td>{v.driverMinimumAge ?? '—'}</td>
              <td>{v.effectiveAt}</td>
              <td>
                {v.status === 'PENDING_APPROVAL' && v.draftedByStaffId !== selfId ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(C.confirmAge)) act(() => bff('POST', `age-policies/${String(v.version)}/approval`, { decision: 'APPROVE' }));
                      }}
                    >
                      {STRINGS.staff.approve}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        act(() => bff('POST', `age-policies/${String(v.version)}/approval`, { decision: 'REJECT' }));
                      }}
                    >
                      {STRINGS.staff.reject}
                    </button>
                  </>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

interface RestrictionView {
  id: string;
  scope: string;
  reasonCode: string;
  reasonClass: string;
  status: string;
  appealable: boolean;
  effectiveUntil: string | null;
}

/** Restrictions of ONE subject at a time (no bulk listing); create (step-up) and lift (SAFETY/FRAUD: second approver). */
export function Restrictions({ canCreateAccountScope }: { readonly canCreateAccountScope: boolean }) {
  const [subject, setSubject] = useState<{ readonly kind: 'accountId' | 'driverProfileId' | 'vehicleId'; readonly id: string } | null>(null);
  const [rows, setRows] = useState<RestrictionView[]>([]);
  const [version, setVersion] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  useEffect(() => {
    if (!subject) return;
    let live = true;
    bff<{ restrictions: RestrictionView[] }>('GET', `restrictions?${subject.kind}=${subject.id}`)
      .then((r) => {
        if (live) setRows(r.restrictions);
      })
      .catch((e: unknown) => {
        if (live) setStatus(message(e));
      });
    return () => {
      live = false;
    };
  }, [subject, version]);
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
  const str = (v: FormDataEntryValue | null): string => (typeof v === 'string' ? v.trim() : '');
  const scopeFor = { accountId: 'ACCOUNT', driverProfileId: 'DRIVER_ROLE', vehicleId: 'VEHICLE' } as const;
  return (
    <section aria-labelledby="restrictions-heading">
      <h1 id="restrictions-heading">{C.restrictionsHeading}</h1>
      {status ? <p role="alert">{status}</p> : null}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const kind = str(f.get('kind')) as 'accountId' | 'driverProfileId' | 'vehicleId';
          setSubject({ kind, id: str(f.get('subjectId')) });
        }}
      >
        <label>
          {C.subjectKind}
          <select name="kind">
            <option value="driverProfileId">{C.driverProfile}</option>
            <option value="vehicleId">{C.vehicle}</option>
            {canCreateAccountScope ? <option value="accountId">{C.account}</option> : null}
          </select>
        </label>
        <label>
          {C.subjectId}
          <input name="subjectId" required pattern="[0-9a-f-]{36}" />
        </label>
        <button type="submit">{C.lookUp}</button>
      </form>
      {subject ? (
        <>
          <table>
            <thead>
              <tr>
                <th scope="col">Scope</th>
                <th scope="col">{C.reason}</th>
                <th scope="col">Status</th>
                <th scope="col">Until</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.scope}</td>
                  <td>
                    {r.reasonClass} / {r.reasonCode}
                  </td>
                  <td>{r.status}</td>
                  <td>{r.effectiveUntil ?? '—'}</td>
                  <td>
                    {r.status === 'ACTIVE' ? (
                      <button
                        type="button"
                        onClick={() => {
                          const code = window.prompt(C.liftPrompt);
                          if (code) act(() => bff('POST', `restrictions/${r.id}/lift`, { reasonCode: code.trim().toUpperCase() }));
                        }}
                      >
                        {C.lift}
                      </button>
                    ) : null}
                    {r.status === 'LIFT_PENDING_APPROVAL' ? (
                      <button
                        type="button"
                        onClick={() => {
                          act(() => bff('POST', `restrictions/${r.id}/lift-approval`, { decision: 'APPROVE' }));
                        }}
                      >
                        {C.approveLift}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              if (!window.confirm(C.confirmCreate)) return;
              act(() =>
                bff('POST', 'restrictions', {
                  scope: scopeFor[subject.kind],
                  [subject.kind]: subject.id,
                  reasonCode: str(f.get('reasonCode')).toUpperCase(),
                  reasonClass: str(f.get('reasonClass')),
                  appealable: f.get('appealable') === 'on',
                }),
              );
            }}
          >
            <h2>{C.create}</h2>
            <label>
              {C.reasonClass}
              <select name="reasonClass">
                {['COMPLIANCE', 'QUALITY', 'SAFETY', 'FRAUD', 'LEGAL', 'AGE_POLICY'].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label>
              {C.reasonCode}
              <input name="reasonCode" required pattern="[A-Za-z][A-Za-z0-9_]{2,63}" />
            </label>
            <label>
              <input name="appealable" type="checkbox" defaultChecked /> {C.appealable}
            </label>
            <button type="submit">{C.create}</button>
          </form>
        </>
      ) : null}
    </section>
  );
}
