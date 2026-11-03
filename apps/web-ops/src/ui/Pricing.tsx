'use client';

/**
 * Phase 3 pricing administration (P3.3; H06/E05/B06; threat model T3-23/T3-31/T3-33): tax policies and rate cards
 * (maker-checker: the drafter submits, a DIFFERENT pricing manager approves with step-up and a reason, then activates
 * now or on a schedule; rollback = a NEW version through approval again), a benchmark price preview and the support
 * quote lookup. Buttons are UX only — the API authorises every call and refuses maker = checker itself. Every response
 * is validated against the contract; amounts are decimal strings of PKR minor units formatted with string arithmetic
 * only; everything is rendered as plain text.
 */
import {
  PricingPreviewSchema,
  QUOTE_ACCESS_REASONS,
  RateCardListSchema,
  RateCardSchema,
  StaffQuoteViewSchema,
  TAXABLE_COMPONENT_KINDS,
  TaxPolicyListSchema,
} from '@wayvro/contracts';
import { useState, type SyntheticEvent } from 'react';
import { STRINGS } from '../content/strings';
import { bff } from './client';
import { formatBp, formatPkr, formatPkrDelta, minorToPkrInput, pkrToMinor, wholeNumber } from './format';
import { actor, askCode, refusalText, text, useAction, useLoad, when } from './resource';

const P = STRINGS.pricing;

type TaxPolicy = ReturnType<typeof TaxPolicyListSchema.parse>['taxPolicies'][number];
type CardSummary = ReturnType<typeof RateCardListSchema.parse>['rateCards'][number];
type CardDetail = ReturnType<typeof RateCardSchema.parse>;
type CardValues = NonNullable<CardSummary['values']>;
type Preview = ReturnType<typeof PricingPreviewSchema.parse>;
type PreviewResult = Preview['rows'][number]['results'][number];
type QuoteView = ReturnType<typeof StaffQuoteViewSchema.parse>;
type Component = QuoteView['options'][number]['components'][number];

const parseTaxList = (raw: unknown) => TaxPolicyListSchema.parse(raw);
const parseCardList = (raw: unknown) => RateCardListSchema.parse(raw);
const parseCard = (raw: unknown) => RateCardSchema.parse(raw);

const ROUNDING_MODES = ['HALF_EVEN', 'HALF_UP', 'FLOOR', 'CEILING'] as const satisfies ReadonlyArray<CardValues['roundingMode']>;
const TOLL_POLICIES = ['NOT_APPLICABLE', 'EXCLUDED_DISCLOSED'] as const satisfies ReadonlyArray<CardValues['tollPolicy']>;
const MONEY_FIELDS = [
  'baseMinor',
  'perKmMinor',
  'perMinMinor',
  'minimumFareMinor',
  'bookingFeeMinor',
  'airportPickupFeeMinor',
  'roundingStepMinor',
] as const satisfies ReadonlyArray<keyof CardValues>;
const INTEGER_FIELDS = ['quoteTtlSeconds', 'maxDistanceM', 'maxDurationS'] as const satisfies ReadonlyArray<keyof CardValues>;
const VALUE_FIELDS = [...MONEY_FIELDS, 'roundingMode', 'tollPolicy', 'taxPolicyId', ...INTEGER_FIELDS] as const;
const MONEY: ReadonlySet<string> = new Set<string>(MONEY_FIELDS);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface PricingPermissions {
  readonly taxDraft: boolean;
  readonly taxApprove: boolean;
  readonly cardDraft: boolean;
  readonly cardSubmit: boolean;
  readonly cardApprove: boolean;
  readonly cardActivate: boolean;
  readonly cardRollback: boolean;
  readonly preview: boolean;
  readonly quoteView: boolean;
}

const who = (staffId: string | null, selfId: string): string => actor(staffId, selfId, { you: P.you, other: P.otherStaff, none: P.system });
const taxLabel = (t: { code: string; version: number }): string => `${t.code} v${String(t.version)}`;
const cardLabel = (c: { cityCode: string; productCode: string; version: number }): string => `${c.cityCode} ${c.productCode} v${String(c.version)}`;
const isField = (f: string): f is keyof typeof P.fields => f in P.fields;
const fieldLabel = (f: string): string => (isField(f) ? P.fields[f] : f);
const isToll = (v: string): v is keyof typeof P.tollPolicies => v in P.tollPolicies;
/** A stored value as text: money formatted exactly, toll policy named, everything else as given. */
const valueText = (field: string, v: string | number): string =>
  MONEY.has(field) ? formatPkr(String(v)) : field === 'tollPolicy' && typeof v === 'string' && isToll(v) ? P.tollPolicies[v] : String(v);

/** Whole console: one version counter, so every mutation reloads the lists and the open card together. */
export function PricingConsole({ selfId, can }: { readonly selfId: string; readonly can: PricingPermissions }) {
  const [version, setVersion] = useState(0);
  const reload = () => {
    setVersion((v) => v + 1);
  };
  const taxes = useLoad('pricing/tax-policies', version, parseTaxList);
  return (
    <>
      <TaxPolicies selfId={selfId} can={can} policies={taxes.data?.taxPolicies ?? null} loadError={taxes.error} reload={reload} />
      <RateCards selfId={selfId} can={can} version={version} reload={reload} taxPolicies={taxes.data?.taxPolicies ?? []} />
      {can.quoteView ? <QuoteLookup /> : null}
    </>
  );
}

// ── tax policies ────────────────────────────────────────────────────────────────────────────────────────────────
function TaxPolicies({
  selfId,
  can,
  policies,
  loadError,
  reload,
}: {
  readonly selfId: string;
  readonly can: PricingPermissions;
  readonly policies: readonly TaxPolicy[] | null;
  readonly loadError: string | null;
  readonly reload: () => void;
}) {
  const { status, act, fail } = useAction(reload);
  const post = (t: TaxPolicy, suffix: string, body: unknown = {}) => {
    act(() => bff('POST', `pricing/tax-policies/${t.id}/${suffix}`, body));
  };
  const draft = (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const appliesTo = TAXABLE_COMPONENT_KINDS.filter((k) => f.get(`applies-${k}`) === 'on');
    const isPlaceholder = f.get('isPlaceholder') === 'on';
    const legalReference = text(f.get('legalReference'));
    const rateBp = wholeNumber(text(f.get('rateBp')));
    if (appliesTo.length === 0 || (!isPlaceholder && legalReference.length < 3) || rateBp === null) {
      fail(P.taxFormInvalid);
      return;
    }
    act(() =>
      bff('POST', 'pricing/tax-policies', {
        code: text(f.get('code')).toUpperCase(),
        jurisdictionCode: text(f.get('jurisdictionCode')).toUpperCase(),
        rateBp,
        appliesTo,
        inclusive: f.get('inclusive') === 'on',
        roundingMode: text(f.get('roundingMode')),
        isPlaceholder,
        ...(legalReference === '' ? {} : { legalReference }),
      }),
    );
  };
  return (
    <section aria-labelledby="tax-heading">
      <h2 id="tax-heading">{P.taxHeading}</h2>
      <p>{P.taxNote}</p>
      {status ? <p role="alert">{status}</p> : null}
      {loadError ? <p role="alert">{loadError}</p> : null}
      {policies === null && loadError === null ? <p role="status">{P.loading}</p> : null}
      <table>
        <thead>
          <tr>
            <th scope="col">{P.taxCode}</th>
            <th scope="col">{P.version}</th>
            <th scope="col">{P.status}</th>
            <th scope="col">{P.jurisdiction}</th>
            <th scope="col">{P.rate}</th>
            <th scope="col">{P.appliesTo}</th>
            <th scope="col">{P.taxMode}</th>
            <th scope="col">{P.rounding}</th>
            <th scope="col">{P.legalReference}</th>
            <th scope="col">{P.activeCards}</th>
            <th scope="col">{P.actions}</th>
          </tr>
        </thead>
        <tbody>
          {(policies ?? []).map((t) => (
            <tr key={t.id} data-testid={`tax-policy-${t.code}-v${String(t.version)}`}>
              <td>{t.code}</td>
              <td>{t.version}</td>
              <td data-testid="tax-status">{t.status}</td>
              <td>{t.jurisdictionCode}</td>
              <td>{formatBp(t.rateBp)}</td>
              <td>{t.appliesTo.join(', ')}</td>
              <td>{t.inclusive ? P.inclusive : P.exclusive}</td>
              <td>{t.roundingMode}</td>
              <td>{t.isPlaceholder ? P.placeholder : (t.legalReference ?? '—')}</td>
              <td>{t.activeCardCount}</td>
              <td>
                {can.taxDraft && t.status === 'DRAFT' && t.draftedByStaffId === selfId ? (
                  <button
                    type="button"
                    onClick={() => {
                      post(t, 'submission');
                    }}
                  >
                    {P.submit} {taxLabel(t)}
                  </button>
                ) : null}
                {can.taxApprove && t.status === 'PENDING_APPROVAL' && t.draftedByStaffId !== selfId ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        post(t, 'approval', { decision: 'APPROVE' });
                      }}
                    >
                      {P.approve} {taxLabel(t)}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const a = askCode(P.rejectPrompt, false);
                        if (!a.ok) {
                          if (!a.cancelled) fail(STRINGS.errors.codeInvalid);
                          return;
                        }
                        post(t, 'approval', { decision: 'REJECT', ...(a.code ? { reasonCode: a.code } : {}) });
                      }}
                    >
                      {P.reject} {taxLabel(t)}
                    </button>
                  </>
                ) : null}
                {can.taxApprove && t.status === 'APPROVED' && t.activeCardCount === 0 ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(P.confirmRetireTax)) post(t, 'retirement');
                    }}
                  >
                    {P.retire} {taxLabel(t)}
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {can.taxDraft ? (
        <form aria-label={P.taxDraftHeading} onSubmit={draft}>
          <h3>{P.taxDraftHeading}</h3>
          <label>
            {P.taxCodeLabel} <input name="code" required pattern="[A-Za-z][A-Za-z0-9_\-]{2,40}" />
          </label>
          <label>
            {P.jurisdictionLabel} <input name="jurisdictionCode" required defaultValue="PK" pattern="[A-Za-z]{2}(-[A-Za-z0-9]{1,3})?" />
          </label>
          <label>
            {P.rateBpLabel} <input name="rateBp" type="number" required min={0} max={10000} step={1} defaultValue={0} />
          </label>
          <fieldset>
            <legend>{P.appliesToLegend}</legend>
            {TAXABLE_COMPONENT_KINDS.map((k) => (
              <label key={k}>
                <input type="checkbox" name={`applies-${k}`} defaultChecked={k !== 'AIRPORT_FEE'} /> {k}
              </label>
            ))}
          </fieldset>
          <label>
            <input type="checkbox" name="inclusive" /> {P.inclusiveLabel}
          </label>
          <label>
            {P.roundingLabel}
            <select name="roundingMode" defaultValue="HALF_EVEN">
              {ROUNDING_MODES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label>
            <input type="checkbox" name="isPlaceholder" defaultChecked /> {P.placeholderLabel}
          </label>
          <label>
            {P.legalReferenceLabel} <input name="legalReference" maxLength={300} />
          </label>
          <button type="submit">{P.createDraft}</button>
        </form>
      ) : null}
    </section>
  );
}

// ── rate cards ──────────────────────────────────────────────────────────────────────────────────────────────────
interface ValuesRequest {
  baseMinor: string;
  perKmMinor: string;
  perMinMinor: string;
  minimumFareMinor: string;
  bookingFeeMinor: string;
  airportPickupFeeMinor: string;
  roundingStepMinor: string;
  roundingMode: string;
  tollPolicy: string;
  taxPolicyId: string;
  quoteTtlSeconds: number;
  maxDistanceM: number;
  maxDurationS: number;
}

/** Every component value of a card from its form; null when any is malformed (exact PKR → minor-unit strings). */
function readValues(f: FormData): ValuesRequest | null {
  const money = (k: (typeof MONEY_FIELDS)[number]) => pkrToMinor(text(f.get(k)));
  const whole = (k: (typeof INTEGER_FIELDS)[number]) => wholeNumber(text(f.get(k)));
  const baseMinor = money('baseMinor');
  const perKmMinor = money('perKmMinor');
  const perMinMinor = money('perMinMinor');
  const minimumFareMinor = money('minimumFareMinor');
  const bookingFeeMinor = money('bookingFeeMinor');
  const airportPickupFeeMinor = money('airportPickupFeeMinor');
  const roundingStepMinor = money('roundingStepMinor');
  const quoteTtlSeconds = whole('quoteTtlSeconds');
  const maxDistanceM = whole('maxDistanceM');
  const maxDurationS = whole('maxDurationS');
  const taxPolicyId = text(f.get('taxPolicyId'));
  if (
    baseMinor === null ||
    perKmMinor === null ||
    perMinMinor === null ||
    minimumFareMinor === null ||
    bookingFeeMinor === null ||
    airportPickupFeeMinor === null ||
    roundingStepMinor === null ||
    quoteTtlSeconds === null ||
    maxDistanceM === null ||
    maxDurationS === null ||
    !UUID.test(taxPolicyId)
  ) {
    return null;
  }
  const step = BigInt(roundingStepMinor);
  if (step < 1n || BigInt(minimumFareMinor) % step !== 0n) return null;
  return {
    baseMinor,
    perKmMinor,
    perMinMinor,
    minimumFareMinor,
    bookingFeeMinor,
    airportPickupFeeMinor,
    roundingStepMinor,
    roundingMode: text(f.get('roundingMode')),
    tollPolicy: text(f.get('tollPolicy')),
    taxPolicyId,
    quoteTtlSeconds,
    maxDistanceM,
    maxDurationS,
  };
}

/** Inputs for every component value (PKR amounts, rounding, tolls, tax policy, limits), prefilled from `initial`. */
function ValuesFields({ initial, taxPolicies }: { readonly initial: CardValues | null; readonly taxPolicies: readonly TaxPolicy[] }) {
  const usable = taxPolicies.filter((t) => t.status !== 'REJECTED' && t.status !== 'RETIRED');
  return (
    <>
      {MONEY_FIELDS.map((k) => (
        <label key={k}>
          {P.fields[k]}{' '}
          <input name={k} required inputMode="decimal" pattern="(0|[1-9][0-9]{0,7})(\.[0-9]{1,2})?" defaultValue={initial ? minorToPkrInput(initial[k]) : ''} />
        </label>
      ))}
      <label>
        {P.fields.roundingMode}
        <select name="roundingMode" defaultValue={initial?.roundingMode ?? 'HALF_UP'}>
          {ROUNDING_MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>
      <label>
        {P.fields.tollPolicy}
        <select name="tollPolicy" defaultValue={initial?.tollPolicy ?? 'EXCLUDED_DISCLOSED'}>
          {TOLL_POLICIES.map((t) => (
            <option key={t} value={t}>
              {P.tollPolicies[t]}
            </option>
          ))}
        </select>
      </label>
      <label>
        {P.fields.taxPolicyId}
        <select name="taxPolicyId" required defaultValue={initial?.taxPolicyId ?? ''}>
          <option value="" disabled>
            {P.chooseTax}
          </option>
          {usable.map((t) => (
            <option key={t.id} value={t.id}>
              {taxLabel(t)} — {t.status} — {formatBp(t.rateBp)}
            </option>
          ))}
        </select>
      </label>
      <label>
        {P.fields.quoteTtlSeconds}{' '}
        <input name="quoteTtlSeconds" type="number" required min={60} max={1800} step={1} defaultValue={initial?.quoteTtlSeconds ?? 300} />
      </label>
      <label>
        {P.fields.maxDistanceM}{' '}
        <input name="maxDistanceM" type="number" required min={100} max={200000} step={1} defaultValue={initial?.maxDistanceM ?? 60000} />
      </label>
      <label>
        {P.fields.maxDurationS} <input name="maxDurationS" type="number" required min={60} max={21600} step={1} defaultValue={initial?.maxDurationS ?? 7200} />
      </label>
    </>
  );
}

/** Rate cards: list (with a city/product filter), draft form, one open card's detail and the preview tool. */
function RateCards({
  selfId,
  can,
  version,
  reload,
  taxPolicies,
}: {
  readonly selfId: string;
  readonly can: PricingPermissions;
  readonly version: number;
  readonly reload: () => void;
  readonly taxPolicies: readonly TaxPolicy[];
}) {
  const [filter, setFilter] = useState('');
  const list = useLoad(`pricing/rate-cards${filter}`, version, parseCardList);
  const { status, act, fail } = useAction(reload);
  const [open, setOpen] = useState<string | null>(null);
  const [chosen, setChosen] = useState<readonly string[]>([]);
  const cards = list.data?.rateCards ?? [];
  const draft = (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const values = readValues(f);
    if (values === null) {
      fail(P.valuesInvalid);
      return;
    }
    act(() =>
      bff<unknown>('POST', 'pricing/rate-cards', {
        cityCode: text(f.get('cityCode')).toUpperCase(),
        productCode: text(f.get('productCode')).toUpperCase(),
        sourceReference: text(f.get('sourceReference')),
        isSynthetic: f.get('isSynthetic') === 'on',
        values,
      }).then((r) => {
        setOpen(parseCard(r).id);
      }),
    );
  };
  return (
    <>
      <section aria-labelledby="cards-heading">
        <h2 id="cards-heading">{P.cardsHeading}</h2>
        <p>{P.cardsNote}</p>
        {status ? <p role="alert">{status}</p> : null}
        {list.error ? <p role="alert">{list.error}</p> : null}
        {list.data === null && list.error === null ? <p role="status">{P.loading}</p> : null}
        <form
          aria-label={STRINGS.audit.filterButton}
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const q = new URLSearchParams();
            const city = text(f.get('cityCode')).toUpperCase();
            const product = text(f.get('productCode')).toUpperCase();
            if (city !== '') q.set('cityCode', city);
            if (product !== '') q.set('productCode', product);
            setFilter(q.size > 0 ? `?${q.toString()}` : '');
          }}
        >
          <label>
            {P.city} <input name="cityCode" maxLength={3} pattern="[A-Za-z]{3}" />
          </label>
          <label>
            {P.product} <input name="productCode" maxLength={24} pattern="[A-Za-z][A-Za-z0-9_]{1,23}" />
          </label>
          <button type="submit">{STRINGS.audit.filterButton}</button>
        </form>
        <table>
          <thead>
            <tr>
              <th scope="col">{P.city}</th>
              <th scope="col">{P.product}</th>
              <th scope="col">{P.version}</th>
              <th scope="col">{P.status}</th>
              <th scope="col">{P.effective}</th>
              <th scope="col">{P.source}</th>
              <th scope="col">{P.actions}</th>
            </tr>
          </thead>
          <tbody>
            {cards.map((c) => (
              <tr key={c.id} data-testid={`rate-card-${c.cityCode}-${c.productCode}-v${String(c.version)}`}>
                <td>{c.cityCode}</td>
                <td>{c.productCode}</td>
                <td>{c.version}</td>
                <td data-testid="rate-card-status">
                  {c.status}
                  {c.isSynthetic ? ` (${P.synthetic})` : ''}
                  {c.scheduled ? ` (${P.scheduled} ${when(c.effectiveFrom)})` : ''}
                </td>
                <td>
                  {when(c.effectiveFrom)} – {when(c.effectiveUntil)}
                </td>
                <td>{c.sourceReference}</td>
                <td>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(c.id);
                    }}
                  >
                    {P.open} {cardLabel(c)}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {can.cardDraft ? (
          <form aria-label={P.cardDraftHeading} onSubmit={draft}>
            <h3>{P.cardDraftHeading}</h3>
            <label>
              {P.city} <input name="cityCode" required defaultValue="LHR" maxLength={3} pattern="[A-Za-z]{3}" />
            </label>
            <label>
              {P.product} <input name="productCode" required maxLength={24} pattern="[A-Za-z][A-Za-z0-9_]{1,23}" />
            </label>
            <label>
              {P.source} <input name="sourceReference" required minLength={3} maxLength={300} />
            </label>
            <label>
              <input name="isSynthetic" type="checkbox" /> {P.isSynthetic}
            </label>
            <ValuesFields initial={null} taxPolicies={taxPolicies} />
            <button type="submit">{P.createDraft}</button>
          </form>
        ) : null}
      </section>
      {open ? (
        <RateCardDetail
          id={open}
          selfId={selfId}
          can={can}
          version={version}
          reload={reload}
          taxPolicies={taxPolicies}
          nameOf={(cardId) => {
            const source = cards.find((x) => x.id === cardId);
            return source ? cardLabel(source) : cardId;
          }}
          onOpen={setOpen}
          onClose={() => {
            setOpen(null);
          }}
        />
      ) : null}
      {can.preview ? <PreviewTool cards={cards} chosen={chosen} setChosen={setChosen} /> : null}
    </>
  );
}

/** One card: values, tax policy, diff and envelope findings vs ACTIVE, recorded preview, and its lifecycle actions. */
function RateCardDetail({
  id,
  selfId,
  can,
  version,
  reload,
  taxPolicies,
  nameOf,
  onOpen,
  onClose,
}: {
  readonly id: string;
  readonly selfId: string;
  readonly can: PricingPermissions;
  readonly version: number;
  readonly reload: () => void;
  readonly taxPolicies: readonly TaxPolicy[];
  /** Label of another card of the list (the clone/rollback source), or its id when it is filtered out. */
  readonly nameOf: (id: string) => string;
  readonly onOpen: (id: string) => void;
  readonly onClose: () => void;
}) {
  const card = useLoad(`pricing/rate-cards/${id}`, version, parseCard);
  const { status, act, fail } = useAction(reload);
  const c = card.data?.id === id ? card.data : null;
  if (c === null) {
    return card.error ? <p role="alert">{card.error}</p> : <p role="status">{P.loading}</p>;
  }
  const label = cardLabel(c);
  const mine = c.draftedByStaffId === selfId;
  const post = (suffix: string, body: unknown = {}, then?: (r: CardDetail) => void) => {
    act(() =>
      bff<unknown>('POST', `pricing/rate-cards/${c.id}/${suffix}`, body).then((r) => {
        if (then) then(parseCard(r));
      }),
    );
  };
  const submit = () => {
    if (c.envelopeViolations.length === 0) {
      post('submission');
      return;
    }
    const a = askCode(P.overridePrompt, true);
    if (!a.ok) {
      if (!a.cancelled) fail(STRINGS.errors.codeInvalid);
      return;
    }
    post('submission', { envelopeOverrideReasonCode: a.code });
  };
  const decide = (decision: 'APPROVE' | 'REJECT') => {
    const a = askCode(decision === 'APPROVE' ? P.approvePrompt : P.rejectPrompt, decision === 'APPROVE');
    if (!a.ok) {
      if (!a.cancelled) fail(STRINGS.errors.codeInvalid);
      return;
    }
    post('approval', { decision, ...(a.code ? { reasonCode: a.code } : {}) });
  };
  const opened = (r: CardDetail) => {
    onOpen(r.id);
  };
  return (
    <section aria-labelledby="card-detail-heading" data-testid="rate-card-detail">
      <h2 id="card-detail-heading">
        {P.detailHeading} {label} — {c.status}
        {c.isSynthetic ? ` (${P.synthetic})` : ''}
      </h2>
      <button type="button" onClick={onClose}>
        {P.close} {label}
      </button>
      {status ? <p role="alert">{status}</p> : null}
      {card.error ? <p role="alert">{card.error}</p> : null}
      <dl>
        <dt>{P.source}</dt>
        <dd>{c.sourceReference}</dd>
        <dt>{P.draftedBy}</dt>
        <dd>{who(c.draftedByStaffId, selfId)}</dd>
        <dt>{P.approvedBy}</dt>
        <dd>{c.approvedByStaffId === null ? '—' : who(c.approvedByStaffId, selfId)}</dd>
        <dt>{P.approvalReason}</dt>
        <dd>{c.approvalReasonCode ?? '—'}</dd>
        <dt>{P.overrideReason}</dt>
        <dd>{c.envelopeOverrideReasonCode ?? '—'}</dd>
        <dt>{P.effective}</dt>
        <dd>
          {when(c.effectiveFrom)} – {when(c.effectiveUntil)}
          {c.scheduled ? ` (${P.scheduled} ${when(c.effectiveFrom)})` : ''}
        </dd>
        <dt>{P.taxPolicy}</dt>
        <dd>
          {c.taxPolicy
            ? `${taxLabel(c.taxPolicy)} — ${c.taxPolicy.status} — ${formatBp(c.taxPolicy.rateBp)} — ${c.taxPolicy.inclusive ? P.inclusive : P.exclusive}${c.taxPolicy.isPlaceholder ? ` — ${P.placeholder}` : ''}`
            : '—'}
        </dd>
        {c.supersedesId ? (
          <>
            <dt>{P.supersedes}</dt>
            <dd>{nameOf(c.supersedesId)}</dd>
          </>
        ) : null}
      </dl>
      {c.values ? (
        <table data-testid="rate-card-values">
          <caption>{P.valuesTable}</caption>
          <thead>
            <tr>
              <th scope="col">{P.field}</th>
              <th scope="col">{P.value}</th>
            </tr>
          </thead>
          <tbody>
            {VALUE_FIELDS.map((k) => (
              <tr key={k}>
                <th scope="row">{P.fields[k]}</th>
                <td>{k === 'taxPolicyId' && c.taxPolicy ? taxLabel(c.taxPolicy) : valueText(k, c.values ? c.values[k] : '')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <h3>{P.diffHeading}</h3>
      {c.activeCardId === null ? (
        <p>{P.noActive}</p>
      ) : c.diffVsActive.length === 0 ? (
        <p>{P.noDiff}</p>
      ) : (
        <table data-testid="rate-card-diff">
          <thead>
            <tr>
              <th scope="col">{P.field}</th>
              <th scope="col">{P.activeValue}</th>
              <th scope="col">{P.proposedValue}</th>
            </tr>
          </thead>
          <tbody>
            {c.diffVsActive.map((d) => (
              <tr key={d.field}>
                <th scope="row">{fieldLabel(d.field)}</th>
                <td>{valueText(d.field, d.active)}</td>
                <td>{valueText(d.field, d.proposed)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h3>{P.envelopeHeading}</h3>
      {c.envelopeViolations.length === 0 ? (
        <p>{P.envelopeNone}</p>
      ) : (
        <ul data-testid="envelope-violations">
          {c.envelopeViolations.map((v) => (
            <li key={v}>{v}</li>
          ))}
        </ul>
      )}
      <h3>{P.previewRecorded}</h3>
      {c.submissionPreview ? <PreviewTable preview={c.submissionPreview} caption={P.previewRecorded} /> : <p>{P.notSubmitted}</p>}
      <div>
        {can.cardSubmit && c.status === 'DRAFT' && mine ? (
          <button type="button" onClick={submit}>
            {P.submit} {label}
          </button>
        ) : null}
        {can.cardApprove && c.status === 'PENDING_APPROVAL' && !mine ? (
          <>
            <button
              type="button"
              onClick={() => {
                decide('APPROVE');
              }}
            >
              {P.approve} {label}
            </button>
            <button
              type="button"
              onClick={() => {
                decide('REJECT');
              }}
            >
              {P.reject} {label}
            </button>
          </>
        ) : null}
        {can.cardActivate && c.status === 'APPROVED' ? (
          <>
            <button
              type="button"
              onClick={() => {
                if (window.confirm(P.confirmActivate)) post('activation', { when: 'NOW' });
              }}
            >
              {P.activateNow} {label}
            </button>
            {c.scheduled ? (
              <button
                type="button"
                onClick={() => {
                  post('schedule-cancellation');
                }}
              >
                {P.cancelSchedule} {label}
              </button>
            ) : (
              <form
                aria-label={`${P.schedule} ${label}`}
                onSubmit={(e) => {
                  e.preventDefault();
                  const at = text(new FormData(e.currentTarget).get('at'));
                  if (at !== '') post('activation', { when: 'SCHEDULED', effectiveFrom: new Date(at).toISOString() });
                }}
              >
                <label>
                  {P.scheduleAt} <input name="at" type="datetime-local" required />
                </label>
                <button type="submit">
                  {P.schedule} {label}
                </button>
              </form>
            )}
          </>
        ) : null}
        {can.cardDraft && c.values !== null ? (
          <button
            type="button"
            onClick={() => {
              post('clones', {}, opened);
            }}
          >
            {P.clone} {label}
          </button>
        ) : null}
        {can.cardRollback && (c.status === 'APPROVED' || c.status === 'RETIRED') && c.values !== null ? (
          <button
            type="button"
            onClick={() => {
              if (window.confirm(P.confirmRollback)) post('rollbacks', {}, opened);
            }}
          >
            {P.rollback} {label}
          </button>
        ) : null}
      </div>
      {can.cardDraft && c.status === 'DRAFT' && mine ? (
        <form
          aria-label={P.editValues}
          onSubmit={(e) => {
            e.preventDefault();
            const values = readValues(new FormData(e.currentTarget));
            if (values === null) {
              fail(P.valuesInvalid);
              return;
            }
            post('values', { values });
          }}
        >
          <h3>{P.editValues}</h3>
          <ValuesFields initial={c.values} taxPolicies={taxPolicies} />
          <button type="submit">{P.saveValues}</button>
        </form>
      ) : null}
    </section>
  );
}

// ── previews ────────────────────────────────────────────────────────────────────────────────────────────────────
function ComponentList({ components }: { readonly components: readonly Component[] }) {
  return (
    <ul>
      {components.map((k) => (
        <li key={k.kind}>
          {k.kind} {formatPkr(k.amount.minor)}
          {k.basis && Object.keys(k.basis).length > 0
            ? ` (${Object.entries(k.basis)
                .map(([name, v]) => `${name}: ${String(v)}`)
                .join(', ')})`
            : ''}
        </li>
      ))}
    </ul>
  );
}

function ResultCell({ result }: { readonly result: PreviewResult }) {
  if (result.outcome !== 'PRICED' || result.total === null) return <>{P.tooLong}</>;
  return (
    <>
      <strong>{formatPkr(result.total.minor)}</strong>
      {result.deltaVsFirst ? (
        <div>
          {P.delta}: {formatPkrDelta(result.deltaVsFirst.minor)}
        </div>
      ) : null}
      <details>
        <summary>{P.components}</summary>
        <ComponentList components={result.components} />
      </details>
    </>
  );
}

function PreviewTable({ preview, caption }: { readonly preview: Preview; readonly caption: string }) {
  return (
    <table data-testid="pricing-preview">
      <caption>
        {caption} — {P.benchmark}: {preview.benchmarkSet}
      </caption>
      <thead>
        <tr>
          <th scope="col">{P.trip}</th>
          {preview.cards.map((c) => (
            <th scope="col" key={c.rateCardId}>
              {cardLabel(c)} ({c.status})
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {preview.rows.map((row, n) => (
          <tr key={`${row.label}-${String(n)}`}>
            <th scope="row">
              {row.label} — {(row.distanceM / 1000).toFixed(1)} {P.km}, {Math.round(row.durationS / 60)} {P.minutes}
              {row.airportPickup ? `, ${P.airport}` : ''}
            </th>
            {preview.cards.map((c) => {
              const result = row.results.find((r) => r.rateCardId === c.rateCardId);
              return <td key={c.rateCardId}>{result ? <ResultCell result={result} /> : '—'}</td>;
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Up to three cards priced over the default synthetic benchmark set (no provider call, no quote row; audited). */
function PreviewTool({
  cards,
  chosen,
  setChosen,
}: {
  readonly cards: readonly CardSummary[];
  readonly chosen: readonly string[];
  readonly setChosen: (ids: readonly string[]) => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const priceable = cards.filter((c) => c.values !== null);
  const run = (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    void bff<unknown>('POST', 'pricing/previews', { rateCardIds: chosen })
      .then((r) => {
        setPreview(PricingPreviewSchema.parse(r));
      })
      .catch((err: unknown) => {
        setPreview(null);
        setError(refusalText(err));
      });
  };
  return (
    <section aria-labelledby="preview-heading">
      <h2 id="preview-heading">{P.previewHeading}</h2>
      <p>{P.previewNote}</p>
      {error ? <p role="alert">{error}</p> : null}
      <form aria-label={P.previewHeading} onSubmit={run}>
        <fieldset>
          <legend>{P.previewChoose}</legend>
          {priceable.map((c) => {
            const on = chosen.includes(c.id);
            return (
              <label key={c.id}>
                <input
                  type="checkbox"
                  checked={on}
                  disabled={!on && chosen.length >= 3}
                  onChange={() => {
                    setChosen(on ? chosen.filter((x) => x !== c.id) : [...chosen, c.id]);
                  }}
                />{' '}
                {P.compare} {cardLabel(c)} ({c.status})
              </label>
            );
          })}
        </fieldset>
        <button type="submit" disabled={chosen.length === 0}>
          {P.runPreview}
        </button>
      </form>
      {preview ? <PreviewTable preview={preview} caption={P.previewResult} /> : null}
    </section>
  );
}

// ── support quote lookup ────────────────────────────────────────────────────────────────────────────────────────
/** One quote group by quote or group id, for a recorded reason: districts, amounts, components, versions — no coordinates. */
function QuoteLookup() {
  const [by, setBy] = useState<'quoteGroupId' | 'quoteId'>('quoteGroupId');
  const [view, setView] = useState<QuoteView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lookUp = (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const id = text(f.get('lookupId')).toLowerCase();
    const reasonCode = QUOTE_ACCESS_REASONS.find((r) => r === f.get('reasonCode'));
    setView(null);
    if (reasonCode === undefined || !UUID.test(id)) {
      setError(STRINGS.errors.validation);
      return;
    }
    setError(null);
    setBusy(true);
    void bff<unknown>('POST', 'pricing/quote-lookups', by === 'quoteId' ? { quoteId: id, reasonCode } : { quoteGroupId: id, reasonCode })
      .then((r) => {
        setView(StaffQuoteViewSchema.parse(r));
      })
      .catch((err: unknown) => {
        setError(refusalText(err));
      })
      .finally(() => {
        setBusy(false);
      });
  };
  return (
    <section aria-labelledby="lookup-heading">
      <h2 id="lookup-heading">{P.lookupHeading}</h2>
      <p>{P.lookupNote}</p>
      <form aria-label={P.lookupHeading} onSubmit={lookUp}>
        <label>
          {P.lookupBy}
          <select
            value={by}
            onChange={(e) => {
              setBy(e.target.value === 'quoteId' ? 'quoteId' : 'quoteGroupId');
            }}
          >
            <option value="quoteGroupId">{P.byGroup}</option>
            <option value="quoteId">{P.byQuote}</option>
          </select>
        </label>
        <label>
          {P.lookupId} <input name="lookupId" required autoComplete="off" spellCheck={false} maxLength={36} />
        </label>
        <label>
          {P.reason}
          <select name="reasonCode" required defaultValue="">
            <option value="" disabled>
              {P.reasonPlaceholder}
            </option>
            {QUOTE_ACCESS_REASONS.map((r) => (
              <option key={r} value={r}>
                {P.reasons[r]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={busy}>
          {P.lookUp}
        </button>
      </form>
      {busy ? <p role="status">{P.loading}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {view ? (
        <section aria-labelledby="quote-heading" data-testid="quote-view">
          <h3 id="quote-heading">{P.quoteHeading}</h3>
          <dl>
            <dt>{P.group}</dt>
            <dd>{view.quoteGroupId}</dd>
            <dt>{P.city}</dt>
            <dd>{view.cityCode}</dd>
            <dt>{P.created}</dt>
            <dd>{when(view.createdAt)}</dd>
            <dt>{P.pickupDistrict}</dt>
            <dd>{view.pickupDistrictCode ?? P.notRecorded}</dd>
            <dt>{P.dropoffDistrict}</dt>
            <dd>{view.dropoffDistrictCode ?? P.notRecorded}</dd>
          </dl>
          <table>
            <thead>
              <tr>
                <th scope="col">{P.product}</th>
                <th scope="col">{P.status}</th>
                <th scope="col">{P.total}</th>
                <th scope="col">{P.components}</th>
                <th scope="col">{P.taxIncluded}</th>
                <th scope="col">{P.tolls}</th>
                <th scope="col">{P.cardVersion}</th>
                <th scope="col">{P.engine}</th>
                <th scope="col">{P.expires}</th>
                <th scope="col">{P.quoteId}</th>
              </tr>
            </thead>
            <tbody>
              {view.options.map((o) => (
                <tr key={o.quoteId} data-testid={`quote-option-${o.productCode}`}>
                  <td>
                    {o.productCode}
                    {o.isSynthetic ? ` (${P.synthetic})` : ''}
                  </td>
                  <td>{o.status}</td>
                  <td>{formatPkr(o.total.minor)}</td>
                  <td>
                    <ComponentList components={o.components} />
                  </td>
                  <td>{o.taxIncluded ? `${formatPkr(o.taxIncluded.amount.minor)} (${formatBp(o.taxIncluded.rateBp)})` : P.none}</td>
                  <td>{P.tollPolicies[o.tollPolicy]}</td>
                  <td>{o.rateCardVersion}</td>
                  <td>{o.pricingEngineVersion}</td>
                  <td>{when(o.expiresAt)}</td>
                  <td>{o.quoteId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </section>
  );
}
