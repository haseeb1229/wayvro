'use client';

import { useEffect, useState, type SyntheticEvent } from 'react';
import { STRINGS } from '../content/strings';
import { BffError, bff } from './client';

const R = STRINGS.release;
const failureText = (e: unknown): string => {
  if (!(e instanceof BffError)) return STRINGS.errors.generic;
  if (e.status === 403) return STRINGS.errors.forbidden;
  if (e.status === 409) return STRINGS.errors.conflict;
  if (e.status === 400) return STRINGS.errors.validation;
  if (e.status === 404) return STRINGS.errors.notFound;
  if (e.status === 429) return STRINGS.errors.rateLimited;
  if (e.status === 503) return STRINGS.errors.unavailable;
  return STRINGS.errors.generic;
};
const str = (v: FormDataEntryValue | null): string => (typeof v === 'string' ? v.trim() : '');
const isoFromLocal = (v: string): string | undefined => (v === '' ? undefined : new Date(v).toISOString());

/** Loads `path` whenever `version` changes; `empty` is shown until the first load (`loaded` false). */
function useBff<T>(path: string, version: number, empty: T): { data: T; loaded: boolean; error: string | null } {
  const [state, setState] = useState<{ data: T; loaded: boolean; error: string | null }>({ data: empty, loaded: false, error: null });
  useEffect(() => {
    let live = true;
    bff<T>('GET', path)
      .then((data) => {
        if (live) setState({ data, loaded: true, error: null });
      })
      .catch((e: unknown) => {
        if (live) setState((s) => ({ ...s, error: failureText(e) }));
      });
    return () => {
      live = false;
    };
  }, [path, version]);
  return state;
}

/** Runs a mutation, then reloads; keeps the last failure for a `role="alert"` message. */
function useAction(): { status: string | null; version: number; act: (fn: () => Promise<unknown>) => void } {
  const [version, setVersion] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const act = (fn: () => Promise<unknown>) => {
    setStatus(null);
    void fn()
      .then(() => {
        setVersion((v) => v + 1);
      })
      .catch((e: unknown) => {
        setStatus(failureText(e));
        setVersion((v) => v + 1);
      });
  };
  return { status, version, act };
}

// ── runtime switches + maintenance ────────────────────────────────────────────────────────────────────────────────
interface SwitchRow {
  scope: string;
  cityCode: string | null;
  state: string;
  reasonCode: string;
  messageKey: string | null;
  expectedEnd: string | null;
  effectiveUntil: string | null;
}
interface SwitchView {
  key: string;
  purpose: string;
  safeState: string;
  allowedScopes: string[];
  defaultState: string;
  baseState: string;
  rows: SwitchRow[];
}
interface ChangeView {
  id: string;
  key: string;
  scope: string;
  cityCode: string | null;
  fromState: string;
  toState: string;
  direction: string;
  status: string;
  requestedByStaffId: string | null;
  reasonCode: string;
  createdAt: string;
}

const NO_SWITCHES: { switches: SwitchView[]; pendingRequests: ChangeView[] } = { switches: [], pendingRequests: [] };
const NO_CHANGES: { changes: ChangeView[] } = { changes: [] };

/** Maintenance, runtime switches, pending restore requests and recent history (one load of the switch list). */
export function ReleaseControls({
  selfId,
  canStop,
  canRequestRestore,
  canApproveRestore,
}: {
  readonly selfId: string;
  readonly canStop: boolean;
  readonly canRequestRestore: boolean;
  readonly canApproveRestore: boolean;
}) {
  const { status, version, act } = useAction();
  const list = useBff('switches', version, NO_SWITCHES);
  const history = useBff('switches/changes', version, NO_CHANGES);
  const switches = list.data.switches;
  const maintenance = switches.find((s) => s.key === 'platform.maintenance');
  const maintenanceRow = maintenance?.rows.find((r) => r.scope === 'ALL' && r.cityCode === null);
  const maintenanceActive = maintenance !== undefined && maintenance.baseState === maintenance.safeState;
  const requestRestore = (key: string, scope: string, cityCode: string | null) => {
    const reason = window.prompt(R.restorePrompt);
    if (!reason) return;
    act(() => bff('POST', 'switches/restore-requests', { key, scope, ...(cityCode ? { cityCode } : {}), reasonCode: reason.trim().toUpperCase() }));
  };
  const stop = (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (!window.confirm(R.confirmStop)) return;
    const city = str(f.get('cityCode')).toUpperCase();
    const until = isoFromLocal(str(f.get('effectiveUntil')));
    act(() =>
      bff('POST', 'switches/safe-state-changes', {
        key: str(f.get('key')),
        scope: str(f.get('scope')),
        reasonCode: str(f.get('reasonCode')).toUpperCase(),
        ...(city ? { cityCode: city } : {}),
        ...(until ? { effectiveUntil: until } : {}),
      }),
    );
  };
  const startMaintenance = (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (!window.confirm(R.confirmMaintenance)) return;
    const expectedEnd = isoFromLocal(str(f.get('expectedEnd')));
    act(() =>
      bff('POST', 'switches/safe-state-changes', {
        key: 'platform.maintenance',
        scope: 'ALL',
        reasonCode: str(f.get('reasonCode')).toUpperCase(),
        messageKey: str(f.get('messageKey')),
        ...(expectedEnd ? { expectedEnd } : {}),
      }),
    );
  };
  const pending = list.data.pendingRequests;
  return (
    <>
      {status ? <p role="alert">{status}</p> : null}
      {list.error ? <p role="alert">{list.error}</p> : null}
      {!list.loaded && !list.error ? <p role="status">{R.loading}</p> : null}

      <section aria-labelledby="maintenance-heading">
        <h2 id="maintenance-heading">{R.maintenanceHeading}</h2>
        <p>{R.maintenanceNote}</p>
        <p role="status" data-testid="maintenance-state">
          {maintenanceActive ? R.maintenanceActive : R.maintenanceInactive}
          {maintenanceActive && maintenanceRow?.expectedEnd ? ` ${R.expectedEnd}: ${new Date(maintenanceRow.expectedEnd).toLocaleString()}` : ''}
        </p>
        {!maintenanceActive && canStop ? (
          <form aria-label={R.startMaintenance} onSubmit={startMaintenance}>
            <label>
              {R.messageKey}
              <input name="messageKey" required defaultValue="maintenance.planned" pattern="[a-z][a-zA-Z0-9_.\-]{2,80}" />
            </label>
            <label>
              {R.expectedEnd}
              <input name="expectedEnd" type="datetime-local" />
            </label>
            <label>
              {R.reasonCode}
              <input name="reasonCode" required defaultValue="PLANNED_MAINTENANCE" pattern="[A-Za-z][A-Za-z0-9_]{2,63}" />
            </label>
            <button type="submit">{R.startMaintenance}</button>
          </form>
        ) : null}
        {maintenanceActive && canRequestRestore ? (
          <button
            type="button"
            onClick={() => {
              requestRestore('platform.maintenance', 'ALL', null);
            }}
          >
            {R.endMaintenance}
          </button>
        ) : null}
      </section>

      <section aria-labelledby="switches-heading">
        <h2 id="switches-heading">{R.switchesHeading}</h2>
        <p>{R.switchesNote}</p>
        <table>
          <thead>
            <tr>
              <th scope="col">{R.key}</th>
              <th scope="col">{R.purpose}</th>
              <th scope="col">{R.safeState}</th>
              <th scope="col">{R.current}</th>
              <th scope="col">{R.narrower}</th>
              <th scope="col">{R.actions}</th>
            </tr>
          </thead>
          <tbody>
            {switches.map((s) => {
              const narrower = s.rows.filter((r) => !(r.scope === 'ALL' && r.cityCode === null));
              return (
                <tr key={s.key} data-testid={`switch-${s.key}`}>
                  <td>{s.key}</td>
                  <td>{s.purpose}</td>
                  <td>{s.safeState}</td>
                  <td data-testid="switch-state">{s.baseState}</td>
                  <td>
                    {narrower.length === 0
                      ? R.none
                      : narrower.map((r) => (
                          <div key={`${r.scope}-${r.cityCode ?? ''}`}>
                            {r.scope}
                            {r.cityCode ? ` ${r.cityCode}` : ''}: {r.state}
                            {r.state === s.safeState && canRequestRestore ? (
                              <button
                                type="button"
                                onClick={() => {
                                  requestRestore(s.key, r.scope, r.cityCode);
                                }}
                              >
                                {R.requestRestore}
                              </button>
                            ) : null}
                          </div>
                        ))}
                  </td>
                  <td>
                    {s.baseState === s.safeState && canRequestRestore && s.key !== 'platform.maintenance' ? (
                      <button
                        type="button"
                        onClick={() => {
                          requestRestore(s.key, 'ALL', null);
                        }}
                      >
                        {R.requestRestore}
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {canStop ? (
          <form aria-label={R.stopHeading} onSubmit={stop}>
            <h3>{R.stopHeading}</h3>
            <label>
              {R.key}
              <select name="key">
                {switches
                  .filter((s) => s.key !== 'platform.maintenance')
                  .map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.key}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              {R.scope}
              <select name="scope">
                {['ALL', 'RIDER', 'DRIVER'].map((scope) => (
                  <option key={scope} value={scope}>
                    {scope}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {R.city}
              <input name="cityCode" pattern="[A-Za-z]{3}" maxLength={3} />
            </label>
            <label>
              {R.reasonCode}
              <input name="reasonCode" required pattern="[A-Za-z][A-Za-z0-9_]{2,63}" />
            </label>
            <label>
              {R.effectiveUntil}
              <input name="effectiveUntil" type="datetime-local" />
            </label>
            <button type="submit">{R.stop}</button>
          </form>
        ) : null}
      </section>

      <section aria-labelledby="pending-heading">
        <h2 id="pending-heading">{R.pendingHeading}</h2>
        {pending.length === 0 ? <p>{R.noPending}</p> : null}
        <ul>
          {pending.map((p) => (
            <li key={p.id} data-testid="pending-restore">
              {p.key} {p.scope}
              {p.cityCode ? ` ${p.cityCode}` : ''}: {p.fromState} → {p.toState} ({p.reasonCode}){' '}
              {p.requestedByStaffId === selfId ? (
                <span>{R.yourRequest}</span>
              ) : canApproveRestore ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      act(() => bff('POST', `switches/restore-requests/${p.id}/approval`, { decision: 'APPROVE' }));
                    }}
                  >
                    {R.approve}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      act(() => bff('POST', `switches/restore-requests/${p.id}/approval`, { decision: 'REJECT' }));
                    }}
                  >
                    {R.reject}
                  </button>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="history-heading">
        <h2 id="history-heading">{R.historyHeading}</h2>
        {history.error ? <p role="alert">{history.error}</p> : null}
        <table>
          <thead>
            <tr>
              <th scope="col">{R.when}</th>
              <th scope="col">{R.key}</th>
              <th scope="col">{R.scope}</th>
              <th scope="col">{R.direction}</th>
              <th scope="col">{R.status}</th>
              <th scope="col">{R.reasonCode}</th>
            </tr>
          </thead>
          <tbody>
            {history.data.changes.map((c) => (
              <tr key={c.id}>
                <td>{new Date(c.createdAt).toLocaleString()}</td>
                <td>{c.key}</td>
                <td>
                  {c.scope}
                  {c.cityCode ? ` ${c.cityCode}` : ''}
                </td>
                <td>
                  {c.direction} ({c.fromState} → {c.toState})
                </td>
                <td>{c.status}</td>
                <td>{c.reasonCode}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

// ── version policies ─────────────────────────────────────────────────────────────────────────────────────────────
interface BlockedRange {
  fromBuild: number;
  toBuild: number;
  reasonCode: string;
}
interface PolicyView {
  id: string;
  platform: string;
  version: number;
  status: string;
  minSupportedBuild: number;
  recommendedBuild: number;
  storeUrlKey: string | null;
  blockedRanges: BlockedRange[];
  effectiveFrom: string | null;
  scheduled: boolean;
  draftedByStaffId: string;
}
interface PreviewView {
  policyId: string;
  latestReleasedBuild: number;
  guardrailProblems: string[];
  buildsRecorded: boolean;
  activeSessionsByAppVersion: Array<{ appVersion: string; activeSessions: number }>;
}

const NO_POLICIES: { policies: PolicyView[] } = { policies: [] };

/** "105-107 SECURITY" per line → ranges; null when any line is malformed. */
function parseRanges(text: string): BlockedRange[] | null {
  const ranges: BlockedRange[] = [];
  for (const line of text.split('\n').map((l) => l.trim())) {
    if (line === '') continue;
    const m = /^(\d{1,9})\s*-\s*(\d{1,9})\s+(SECURITY|DATA_CORRUPTION|CONTRACT_BREAK)$/.exec(line.toUpperCase());
    if (!m?.[1] || !m[2] || !m[3]) return null;
    ranges.push({ fromBuild: Number(m[1]), toBuild: Number(m[2]), reasonCode: m[3] });
  }
  return ranges;
}

/** Version policies: the drafter submits, a DIFFERENT release manager approves, activation now or scheduled. */
export function VersionPolicies({
  selfId,
  canDraft,
  canApprove,
  canActivate,
}: {
  readonly selfId: string;
  readonly canDraft: boolean;
  readonly canApprove: boolean;
  readonly canActivate: boolean;
}) {
  const { status, version, act } = useAction();
  const list = useBff('release/policies', version, NO_POLICIES);
  const [formError, setFormError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewView | null>(null);
  const [refusal, setRefusal] = useState<string[] | null>(null);
  const transition = (id: string, path: string, body: unknown = {}) => {
    setRefusal(null);
    act(() =>
      bff('POST', `release/policies/${id}/${path}`, body).catch(async (e: unknown) => {
        // guardrail refusals carry reason codes: show them, not just "check the values"
        if (e instanceof BffError && e.status === 400) {
          const p = await bff<PreviewView>('GET', `release/policies/${id}/preview`).catch(() => null);
          setRefusal(p?.guardrailProblems ?? null);
        }
        throw e;
      }),
    );
  };
  const draft = (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const ranges = parseRanges(str(f.get('ranges')));
    if (ranges === null) {
      setFormError(R.rangesInvalid);
      return;
    }
    setFormError(null);
    const storeUrlKey = str(f.get('storeUrlKey'));
    act(() =>
      bff('POST', 'release/policies', {
        platform: str(f.get('platform')),
        minSupportedBuild: Number(str(f.get('minBuild'))),
        recommendedBuild: Number(str(f.get('recommendedBuild'))),
        storeUrlKey: storeUrlKey === '' ? null : storeUrlKey,
        softMessageKey: str(f.get('softMessageKey')),
        hardMessageKey: str(f.get('hardMessageKey')),
        blockedRanges: ranges,
      }),
    );
  };
  return (
    <section aria-labelledby="policies-heading">
      <h2 id="policies-heading">{R.policiesHeading}</h2>
      <p>{R.policiesNote}</p>
      {status ? <p role="alert">{status}</p> : null}
      {refusal && refusal.length > 0 ? (
        <p role="alert" data-testid="guardrail-refusal">
          {R.guardrailRefused} {refusal.join(', ')}
        </p>
      ) : null}
      {list.error ? <p role="alert">{list.error}</p> : null}
      {canDraft ? (
        <form aria-label={R.draftHeading} onSubmit={draft}>
          <h3>{R.draftHeading}</h3>
          <label>
            {R.platform}
            <select name="platform">
              <option value="ANDROID">ANDROID</option>
              <option value="IOS">IOS</option>
            </select>
          </label>
          <label>
            {R.minBuild}
            <input name="minBuild" type="number" min={0} max={999999999} required defaultValue={0} />
          </label>
          <label>
            {R.recommendedBuild}
            <input name="recommendedBuild" type="number" min={0} max={999999999} required defaultValue={0} />
          </label>
          <label>
            {R.storeUrlKey}
            <input name="storeUrlKey" pattern="[a-z][a-z0-9_.\-]{2,40}" />
          </label>
          <label>
            {R.softMessageKey}
            <input name="softMessageKey" required defaultValue="release.soft.default" pattern="[a-z][a-zA-Z0-9_.\-]{2,80}" />
          </label>
          <label>
            {R.hardMessageKey}
            <input name="hardMessageKey" required defaultValue="release.hard.default" pattern="[a-z][a-zA-Z0-9_.\-]{2,80}" />
          </label>
          <label>
            {R.ranges}
            <textarea name="ranges" rows={3} />
          </label>
          {formError ? <p role="alert">{formError}</p> : null}
          <button type="submit">{R.createDraft}</button>
        </form>
      ) : null}
      <table>
        <thead>
          <tr>
            <th scope="col">{R.platform}</th>
            <th scope="col">{R.version}</th>
            <th scope="col">{R.status}</th>
            <th scope="col">{R.builds}</th>
            <th scope="col">{R.blocked}</th>
            <th scope="col">{R.effective}</th>
            <th scope="col">{R.actions}</th>
          </tr>
        </thead>
        <tbody>
          {list.data.policies.map((p) => (
            <tr key={p.id} data-testid={`policy-${p.platform}-${String(p.version)}`}>
              <td>{p.platform}</td>
              <td>{p.version}</td>
              <td data-testid="policy-status">
                {p.status}
                {p.scheduled ? ` (${R.scheduled})` : ''}
              </td>
              <td>
                {p.minSupportedBuild} / {p.recommendedBuild}
              </td>
              <td>
                {p.blockedRanges.length === 0 ? R.none : p.blockedRanges.map((r) => `${String(r.fromBuild)}–${String(r.toBuild)} ${r.reasonCode}`).join('; ')}
              </td>
              <td>{p.effectiveFrom ? new Date(p.effectiveFrom).toLocaleString() : '—'}</td>
              <td>
                <button
                  type="button"
                  onClick={() => {
                    void bff<PreviewView>('GET', `release/policies/${p.id}/preview`).then(setPreview, () => {
                      setPreview(null);
                    });
                  }}
                >
                  {R.preview}
                </button>
                {p.status === 'DRAFT' && p.draftedByStaffId === selfId && canDraft ? (
                  <button
                    type="button"
                    onClick={() => {
                      transition(p.id, 'submission');
                    }}
                  >
                    {R.submit}
                  </button>
                ) : null}
                {p.status === 'PENDING_APPROVAL' && p.draftedByStaffId !== selfId && canApprove ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        transition(p.id, 'approval', { decision: 'APPROVE' });
                      }}
                    >
                      {R.approve}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        transition(p.id, 'approval', { decision: 'REJECT' });
                      }}
                    >
                      {R.reject}
                    </button>
                  </>
                ) : null}
                {p.status === 'APPROVED' && canActivate ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(R.confirmActivate)) transition(p.id, 'activation', { when: 'NOW' });
                      }}
                    >
                      {R.activateNow}
                    </button>
                    {p.scheduled ? (
                      <button
                        type="button"
                        onClick={() => {
                          transition(p.id, 'schedule-cancellation');
                        }}
                      >
                        {R.cancelSchedule}
                      </button>
                    ) : (
                      <ScheduleForm
                        onSchedule={(effectiveFrom) => {
                          transition(p.id, 'activation', { when: 'SCHEDULED', effectiveFrom });
                        }}
                      />
                    )}
                  </>
                ) : null}
                {(p.status === 'ACTIVE' || p.status === 'APPROVED') && canActivate ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(R.confirmRetire)) transition(p.id, 'retirement');
                    }}
                  >
                    {R.retire}
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {preview ? (
        <section aria-labelledby="preview-heading" data-testid="policy-preview">
          <h3 id="preview-heading">{R.previewHeading}</h3>
          <p>{preview.guardrailProblems.length === 0 ? R.guardrailsOk : `${R.guardrailsFailed} ${preview.guardrailProblems.join(', ')}`}</p>
          <p>
            {R.latestReleased}: {preview.latestReleasedBuild}
          </p>
          {preview.buildsRecorded ? null : <p>{R.buildsNotRecorded}</p>}
          <table>
            <thead>
              <tr>
                <th scope="col">{R.appVersion}</th>
                <th scope="col">{R.activeSessions}</th>
              </tr>
            </thead>
            <tbody>
              {preview.activeSessionsByAppVersion.map((v) => (
                <tr key={v.appVersion}>
                  <td>{v.appVersion}</td>
                  <td>{v.activeSessions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </section>
  );
}

function ScheduleForm({ onSchedule }: { readonly onSchedule: (effectiveFrom: string) => void }) {
  return (
    <form
      aria-label={R.schedule}
      onSubmit={(e) => {
        e.preventDefault();
        const at = isoFromLocal(str(new FormData(e.currentTarget).get('at')));
        if (at) onSchedule(at);
      }}
    >
      <label>
        {R.scheduleAt}
        <input name="at" type="datetime-local" required />
      </label>
      <button type="submit">{R.schedule}</button>
    </form>
  );
}
