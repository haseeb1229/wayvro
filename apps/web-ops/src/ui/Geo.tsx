'use client';

/**
 * Phase 3 geo administration (P3.2; I11 cost controls, A06 aliases): provider budgets (maker-checker; a DECREASE of the
 * budget in force — the safe direction — may be approved by its drafter with step-up, as the API and database allow),
 * hourly usage rollups and Wayvro-curated landmark aliases (a different staff member approves). Buttons are UX only:
 * the API authorises every call. Responses are validated against the contract; everything is plain text (aliases may
 * be Urdu, so their cells use the browser's bidi detection).
 */
import {
  GEO_BUDGET_THRESHOLDS,
  GEO_SKUS,
  GeoBudgetListSchema,
  GeoUsageSchema,
  LOCALES,
  LandmarkAliasListSchema,
  type GeoBudget,
  type GeoUsage,
  type LandmarkAlias,
} from '@wayvro/contracts';
import { useState, type SyntheticEvent } from 'react';
import { STRINGS } from '../content/strings';
import { bff } from './client';
import { formatMicroUsd, usdToMicro, wholeNumber } from './format';
import { actor, refusalText, text, useAction, useLoad, when } from './resource';

const G = STRINGS.geo;

const parseBudgets = (raw: unknown) => GeoBudgetListSchema.parse(raw);
const parseAliases = (raw: unknown) => LandmarkAliasListSchema.parse(raw);

const RANGES = { DAY: 86_400_000, WEEK: 7 * 86_400_000, MONTH: 30 * 86_400_000 } as const;
const isRange = (v: string): v is keyof typeof RANGES => v in RANGES;
const DEFAULT_THRESHOLDS: ReadonlySet<number> = new Set([50, 80, 100]);

export interface GeoPermissions {
  readonly budgetDraft: boolean;
  readonly budgetApprove: boolean;
  readonly aliasDraft: boolean;
  readonly aliasApprove: boolean;
}

const who = (staffId: string | null, selfId: string): string => actor(staffId, selfId, { you: G.you, other: G.otherStaff, none: G.none });
const budgetLabel = (b: GeoBudget): string => `${b.providerKey} ${b.sku} v${String(b.version)}`;
const utcHour = (iso: string): string => `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;

export function GeoConsole({ selfId, can }: { readonly selfId: string; readonly can: GeoPermissions }) {
  return (
    <>
      <Budgets selfId={selfId} can={can} />
      <Usage />
      <Aliases selfId={selfId} can={can} />
    </>
  );
}

// ── provider budgets ────────────────────────────────────────────────────────────────────────────────────────────
function Budgets({ selfId, can }: { readonly selfId: string; readonly can: GeoPermissions }) {
  const [version, setVersion] = useState(0);
  const list = useLoad('geo/budgets', version, parseBudgets);
  const { status, act, fail } = useAction(() => {
    setVersion((v) => v + 1);
  });
  const post = (b: GeoBudget, suffix: string, body: unknown = {}) => {
    act(() => bff('POST', `geo/budgets/${b.id}/${suffix}`, body));
  };
  const draft = (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const dailyCalls = wholeNumber(text(f.get('dailyCalls')));
    const monthlyCalls = wholeNumber(text(f.get('monthlyCalls')));
    const monthlyCostMicroUsd = usdToMicro(text(f.get('monthlyCost')));
    const alertThresholdsPct = GEO_BUDGET_THRESHOLDS.filter((t) => f.get(`threshold-${String(t)}`) === 'on');
    if (dailyCalls === null || monthlyCalls === null || monthlyCostMicroUsd === null || dailyCalls > monthlyCalls || alertThresholdsPct.length === 0) {
      fail(G.budgetInvalid);
      return;
    }
    act(() =>
      bff('POST', 'geo/budgets', {
        providerKey: text(f.get('providerKey')).toLowerCase(),
        sku: text(f.get('sku')),
        dailyCalls,
        monthlyCalls,
        monthlyCostMicroUsd,
        alertThresholdsPct,
      }),
    );
  };
  return (
    <section aria-labelledby="budgets-heading">
      <h2 id="budgets-heading">{G.budgetsHeading}</h2>
      <p>{G.note}</p>
      {status ? <p role="alert">{status}</p> : null}
      {list.error ? <p role="alert">{list.error}</p> : null}
      {list.data === null && list.error === null ? <p role="status">{G.loading}</p> : null}
      <table>
        <thead>
          <tr>
            <th scope="col">{G.provider}</th>
            <th scope="col">{G.sku}</th>
            <th scope="col">{G.version}</th>
            <th scope="col">{G.status}</th>
            <th scope="col">{G.changeKind}</th>
            <th scope="col">{G.dailyCalls}</th>
            <th scope="col">{G.monthlyCalls}</th>
            <th scope="col">{G.monthlyCost}</th>
            <th scope="col">{G.thresholds}</th>
            <th scope="col">{G.effective}</th>
            <th scope="col">{G.actions}</th>
          </tr>
        </thead>
        <tbody>
          {(list.data?.budgets ?? []).map((b) => {
            const mine = b.draftedByStaffId === selfId;
            const selfDecrease = mine && b.changeKind === 'DECREASE';
            return (
              <tr key={b.id} data-testid={`budget-${b.providerKey}-${b.sku}-v${String(b.version)}`}>
                <td>{b.providerKey}</td>
                <td>{b.sku}</td>
                <td>{b.version}</td>
                <td data-testid="budget-status">{b.status}</td>
                <td>{b.changeKind}</td>
                <td>{b.dailyCalls}</td>
                <td>{b.monthlyCalls}</td>
                <td>{formatMicroUsd(b.monthlyCostMicroUsd)}</td>
                <td>{b.alertThresholdsPct.map((t) => `${String(t)}%`).join(', ')}</td>
                <td>
                  {when(b.effectiveFrom)} – {when(b.effectiveUntil)}
                </td>
                <td>
                  {can.budgetDraft && b.status === 'DRAFT' ? (
                    <button
                      type="button"
                      onClick={() => {
                        post(b, 'submission');
                      }}
                    >
                      {G.submit} {budgetLabel(b)}
                    </button>
                  ) : null}
                  {can.budgetApprove && b.status === 'PENDING_APPROVAL' && (!mine || selfDecrease) ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (!selfDecrease || window.confirm(G.confirmDecrease)) post(b, 'approval', { decision: 'APPROVE' });
                      }}
                    >
                      {selfDecrease ? G.approveDecrease : G.approve} {budgetLabel(b)}
                    </button>
                  ) : null}
                  {can.budgetApprove && b.status === 'PENDING_APPROVAL' ? (
                    <button
                      type="button"
                      onClick={() => {
                        post(b, 'approval', { decision: 'REJECT' });
                      }}
                    >
                      {G.reject} {budgetLabel(b)}
                    </button>
                  ) : null}
                  {can.budgetApprove && b.status === 'APPROVED' ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(G.confirmActivate)) post(b, 'activation');
                      }}
                    >
                      {G.activate} {budgetLabel(b)}
                    </button>
                  ) : null}
                  {can.budgetApprove && (b.status === 'APPROVED' || b.status === 'ACTIVE') ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(G.confirmRetire)) post(b, 'retirement');
                      }}
                    >
                      {G.retire} {budgetLabel(b)}
                    </button>
                  ) : null}
                  {b.approvedByStaffId !== null ? (
                    <span>
                      {' '}
                      ({G.approvedBy}: {who(b.approvedByStaffId, selfId)})
                    </span>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {can.budgetDraft ? (
        <form aria-label={G.budgetDraftHeading} onSubmit={draft}>
          <h3>{G.budgetDraftHeading}</h3>
          <label>
            {G.provider} <input name="providerKey" required pattern="[a-z][a-z0-9\-]{1,31}" />
          </label>
          <label>
            {G.sku}
            <select name="sku" defaultValue="AUTOCOMPLETE">
              {GEO_SKUS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label>
            {G.dailyCalls} <input name="dailyCalls" type="number" required min={0} max={10000000} step={1} />
          </label>
          <label>
            {G.monthlyCalls} <input name="monthlyCalls" type="number" required min={0} max={300000000} step={1} />
          </label>
          <label>
            {G.monthlyCost} <input name="monthlyCost" required inputMode="decimal" pattern="(0|[1-9][0-9]{0,5})(\.[0-9]{1,6})?" />
          </label>
          <fieldset>
            <legend>{G.thresholdsLegend}</legend>
            {GEO_BUDGET_THRESHOLDS.map((t) => (
              <label key={t}>
                <input type="checkbox" name={`threshold-${String(t)}`} defaultChecked={DEFAULT_THRESHOLDS.has(t)} /> {t}%
              </label>
            ))}
          </fieldset>
          <button type="submit">{G.createDraft}</button>
        </form>
      ) : null}
    </section>
  );
}

// ── hourly usage ────────────────────────────────────────────────────────────────────────────────────────────────
function Usage() {
  const [usage, setUsage] = useState<GeoUsage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const show = (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const range = text(f.get('range'));
    const provider = text(f.get('providerKey')).toLowerCase();
    const sku = text(f.get('sku'));
    const to = Date.now();
    const q = new URLSearchParams({ from: new Date(to - (isRange(range) ? RANGES[range] : RANGES.DAY)).toISOString(), to: new Date(to).toISOString() });
    if (provider !== '') q.set('providerKey', provider);
    if (sku !== '') q.set('sku', sku);
    setError(null);
    void bff<unknown>('GET', `geo/usage?${q.toString()}`)
      .then((r) => {
        setUsage(GeoUsageSchema.parse(r));
      })
      .catch((err: unknown) => {
        setUsage(null);
        setError(refusalText(err));
      });
  };
  return (
    <section aria-labelledby="usage-heading">
      <h2 id="usage-heading">{G.usageHeading}</h2>
      <p>{G.usageNote}</p>
      <form aria-label={G.usageHeading} onSubmit={show}>
        <label>
          {G.range}
          <select name="range" defaultValue="DAY">
            {(Object.keys(RANGES) as Array<keyof typeof RANGES>).map((r) => (
              <option key={r} value={r}>
                {G.ranges[r]}
              </option>
            ))}
          </select>
        </label>
        <label>
          {G.anyProvider} <input name="providerKey" pattern="[a-z][a-z0-9\-]{1,31}" />
        </label>
        <label>
          {G.anySku}
          <select name="sku" defaultValue="">
            <option value="">{G.allSkus}</option>
            {GEO_SKUS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">{G.showUsage}</button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
      {usage ? (
        usage.hours.length === 0 ? (
          <p role="status">{G.noUsage}</p>
        ) : (
          <table data-testid="geo-usage">
            <thead>
              <tr>
                <th scope="col">{G.hour}</th>
                <th scope="col">{G.provider}</th>
                <th scope="col">{G.sku}</th>
                <th scope="col">{G.calls}</th>
                <th scope="col">{G.cacheHits}</th>
                <th scope="col">{G.errors}</th>
                <th scope="col">{G.timeouts}</th>
                <th scope="col">{G.budgetRefusals}</th>
                <th scope="col">{G.estCost}</th>
              </tr>
            </thead>
            <tbody>
              {usage.hours.map((h) => (
                <tr key={`${h.hourBucket}-${h.providerKey}-${h.sku}`}>
                  <td>{utcHour(h.hourBucket)}</td>
                  <td>{h.providerKey}</td>
                  <td>{h.sku}</td>
                  <td>{h.calls}</td>
                  <td>{h.cacheHits}</td>
                  <td>{h.errors}</td>
                  <td>{h.timeouts}</td>
                  <td>{h.budgetRefusals}</td>
                  <td>{formatMicroUsd(h.estCostMicroUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : null}
    </section>
  );
}

// ── landmark aliases ────────────────────────────────────────────────────────────────────────────────────────────
function Aliases({ selfId, can }: { readonly selfId: string; readonly can: GeoPermissions }) {
  const [version, setVersion] = useState(0);
  const list = useLoad('geo/landmark-aliases', version, parseAliases);
  const { status, act } = useAction(() => {
    setVersion((v) => v + 1);
  });
  const post = (a: LandmarkAlias, suffix: string, body: unknown = {}) => {
    act(() => bff('POST', `geo/landmark-aliases/${a.id}/${suffix}`, body));
  };
  return (
    <section aria-labelledby="aliases-heading">
      <h2 id="aliases-heading">{G.aliasesHeading}</h2>
      <p>{G.aliasesNote}</p>
      {status ? <p role="alert">{status}</p> : null}
      {list.error ? <p role="alert">{list.error}</p> : null}
      {list.data === null && list.error === null ? <p role="status">{G.loading}</p> : null}
      <table>
        <thead>
          <tr>
            <th scope="col">{G.city}</th>
            <th scope="col">{G.locale}</th>
            <th scope="col">{G.alias}</th>
            <th scope="col">{G.normalised}</th>
            <th scope="col">{G.canonicalQuery}</th>
            <th scope="col">{G.source}</th>
            <th scope="col">{G.status}</th>
            <th scope="col">{G.createdBy}</th>
            <th scope="col">{G.actions}</th>
          </tr>
        </thead>
        <tbody>
          {(list.data?.aliases ?? []).map((a) => {
            const label = `${G.aliasWord} ${a.aliasDisplay}`;
            return (
              <tr key={a.id} data-testid="alias-row">
                <td>{a.cityCode}</td>
                <td>{G.locales[a.locale]}</td>
                <td dir="auto">{a.aliasDisplay}</td>
                <td dir="auto">{a.aliasNormalised}</td>
                <td dir="auto">{a.canonicalQuery}</td>
                <td>{G.sources[a.source]}</td>
                <td data-testid="alias-status">{a.status}</td>
                <td>{who(a.createdByStaffId, selfId)}</td>
                <td>
                  {can.aliasApprove && a.status === 'PROPOSED' && a.createdByStaffId !== selfId ? (
                    <button
                      type="button"
                      onClick={() => {
                        post(a, 'approval', { decision: 'APPROVE' });
                      }}
                    >
                      {G.approve} {label}
                    </button>
                  ) : null}
                  {can.aliasApprove && a.status === 'PROPOSED' ? (
                    <button
                      type="button"
                      onClick={() => {
                        post(a, 'approval', { decision: 'REJECT' });
                      }}
                    >
                      {G.reject} {label}
                    </button>
                  ) : null}
                  {can.aliasApprove && a.status === 'ACTIVE' ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(G.confirmRetireAlias)) post(a, 'retirement');
                      }}
                    >
                      {G.retire} {label}
                    </button>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {can.aliasDraft ? (
        <form
          aria-label={G.aliasDraftHeading}
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            act(() =>
              bff('POST', 'geo/landmark-aliases', {
                cityCode: text(f.get('cityCode')).toUpperCase(),
                locale: text(f.get('locale')),
                alias: text(f.get('alias')),
                canonicalQuery: text(f.get('canonicalQuery')),
                source: text(f.get('source')),
              }),
            );
          }}
        >
          <h3>{G.aliasDraftHeading}</h3>
          <label>
            {G.city} <input name="cityCode" required defaultValue="LHR" maxLength={3} pattern="[A-Za-z]{3}" />
          </label>
          <label>
            {G.locale}
            <select name="locale" defaultValue="ur-Latn">
              {LOCALES.map((l) => (
                <option key={l} value={l}>
                  {G.locales[l]}
                </option>
              ))}
            </select>
          </label>
          <label>
            {G.aliasLabel} <input name="alias" required minLength={2} maxLength={80} dir="auto" />
          </label>
          <label>
            {G.canonicalLabel} <input name="canonicalQuery" required minLength={2} maxLength={120} dir="auto" />
          </label>
          <label>
            {G.source}
            <select name="source" defaultValue="FOUNDER">
              <option value="FOUNDER">{G.sources.FOUNDER}</option>
              <option value="FIELD">{G.sources.FIELD}</option>
            </select>
          </label>
          <button type="submit">{G.createDraft}</button>
        </form>
      ) : null}
    </section>
  );
}
