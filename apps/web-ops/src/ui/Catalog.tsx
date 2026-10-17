'use client';

/**
 * Phase 3 catalog screens (P3.1; E08/H10/R28): city products (ENABLE request/decision, suspension), vehicle eligibility
 * rules and zone sets — every change maker-checker through the BFF; the API authorises every call (buttons are UX
 * only). Geometry is shown as a SUMMARY table (no map preview until the renderer freeze). Everything is rendered as
 * plain text; nothing from the API or an uploaded file is ever interpreted as markup.
 */
import { useEffect, useState } from 'react';
import { STRINGS } from '../content/strings';
import { BffError, bff } from './client';

const C = STRINGS.catalog;
const Z = STRINGS.zones;
const message = (e: unknown): string => {
  if (!(e instanceof BffError)) return STRINGS.errors.generic;
  const base =
    e.status === 403
      ? STRINGS.errors.forbidden
      : e.status === 409
        ? STRINGS.errors.conflict
        : e.status === 400
          ? STRINGS.errors.validation
          : STRINGS.errors.generic;
  return e.reasonCodes.length > 0 ? `${base} ${C.refused} ${e.reasonCodes.join(', ')}` : base;
};

/** Load-on-version + act-then-reload, shared by the three screens (`empty` is shown until the first load). */
function useResource<T>(path: string, empty: T): { data: T; status: string | null; act: (fn: () => Promise<unknown>) => void } {
  const [data, setData] = useState<T>(empty);
  const [version, setVersion] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    bff<T>('GET', path)
      .then((r) => {
        if (live) setData(r);
      })
      .catch((e: unknown) => {
        if (live) setStatus(message(e));
      });
    return () => {
      live = false;
    };
  }, [path, version]);
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
  return { data, status, act };
}

interface CityProduct {
  cityCode: string;
  productCode: string;
  vehicleClass: string;
  status: string;
  pendingTransition: string | null;
  legalBasisRef: string | null;
  isSynthetic: boolean;
  changedByStaffId: string | null;
  reasonCode: string | null;
}

export interface CatalogPermissions {
  readonly enableRequest: boolean;
  readonly enableApprove: boolean;
  readonly suspend: boolean;
  readonly ruleDraft: boolean;
  readonly ruleApprove: boolean;
  readonly ruleActivate: boolean;
  readonly zoneDraft: boolean;
  readonly zoneApprove: boolean;
  readonly zoneActivate: boolean;
}

/** A form value as trimmed text (a file input never feeds these forms). */
const text = (v: FormDataEntryValue | null): string => (typeof v === 'string' ? v.trim() : '');

const promptCode = (text: string): string | null => {
  const v = window.prompt(text)?.trim().toUpperCase() ?? '';
  return /^[A-Z][A-Z0-9_]{2,63}$/.test(v) ? v : null;
};

/** City products: lifecycle state per city with the maker-checker ENABLE flow and the single-staff suspension. */
export function CityProducts({ selfId, can }: { readonly selfId: string; readonly can: CatalogPermissions }) {
  const { data, status, act } = useResource<{ products: CityProduct[] }>('catalog/city-products', { products: [] });
  const key = (p: CityProduct) => ({ cityCode: p.cityCode, productCode: p.productCode });
  return (
    <section aria-labelledby="products-heading">
      <h2 id="products-heading">{C.productsHeading}</h2>
      <p>{C.note}</p>
      {status ? <p role="alert">{status}</p> : null}
      <table>
        <thead>
          <tr>
            <th scope="col">{C.city}</th>
            <th scope="col">{C.product}</th>
            <th scope="col">{C.vehicleClass}</th>
            <th scope="col">{C.status}</th>
            <th scope="col">{C.pending}</th>
            <th scope="col">{C.legalBasis}</th>
            <th scope="col">{C.reason}</th>
            <th scope="col">{C.actions}</th>
          </tr>
        </thead>
        <tbody>
          {data.products.map((p) => (
            <tr key={`${p.cityCode}-${p.productCode}`} data-testid={`city-product-${p.cityCode}-${p.productCode}`}>
              <td>{p.cityCode}</td>
              <td>{p.productCode}</td>
              <td>{p.vehicleClass}</td>
              <td>
                {p.status}
                {p.isSynthetic ? ` (${C.synthetic})` : ''}
              </td>
              <td>{p.pendingTransition ?? '—'}</td>
              <td>{p.legalBasisRef ?? '—'}</td>
              <td>{p.reasonCode ?? '—'}</td>
              <td>
                {can.enableRequest && p.pendingTransition === null && p.status !== 'ENABLED' && p.status !== 'DISABLED_LEGAL_GATE' ? (
                  <button
                    type="button"
                    onClick={() => {
                      const legalBasisRef = window.prompt(C.legalPrompt)?.trim() ?? '';
                      const reasonCode = promptCode(C.reasonPrompt);
                      if (legalBasisRef.length >= 3 && reasonCode)
                        act(() => bff('POST', 'catalog/city-products/enable-requests', { ...key(p), legalBasisRef, reasonCode }));
                    }}
                  >
                    {C.requestEnable} {p.productCode}
                  </button>
                ) : null}
                {can.enableApprove && p.pendingTransition === 'ENABLE' && p.changedByStaffId !== selfId ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        act(() => bff('POST', 'catalog/city-products/enable-decisions', { ...key(p), decision: 'APPROVE' }));
                      }}
                    >
                      {STRINGS.staff.approve} {p.productCode}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        act(() => bff('POST', 'catalog/city-products/enable-decisions', { ...key(p), decision: 'REJECT' }));
                      }}
                    >
                      {STRINGS.staff.reject} {p.productCode}
                    </button>
                  </>
                ) : null}
                {can.suspend && p.status === 'ENABLED' ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (!window.confirm(C.confirmSuspend)) return;
                      const reasonCode = promptCode(C.suspendReasonPrompt);
                      if (reasonCode) act(() => bff('POST', 'catalog/city-products/suspensions', { ...key(p), reasonCode }));
                    }}
                  >
                    {C.suspend} {p.productCode}
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

interface Rule {
  id: string;
  cityCode: string;
  productCode: string;
  version: number;
  status: string;
  isSynthetic: boolean;
  sourceReference: string;
  minModelYear: number | null;
  maxVehicleAgeYears: number | null;
  minSeats: number | null;
  acRequired: boolean;
  allowedBodyTypes: string[];
  draftedByStaffId: string | null;
}

/** Shared lifecycle buttons for a maker-checker configuration version (rules and zone sets). */
function LifecycleButtons({
  base,
  item,
  selfId,
  canDraft,
  canApprove,
  canActivate,
  act,
  label,
}: {
  readonly base: string;
  readonly item: { id: string; status: string; draftedByStaffId: string | null };
  readonly selfId: string;
  readonly canDraft: boolean;
  readonly canApprove: boolean;
  readonly canActivate: boolean;
  readonly act: (fn: () => Promise<unknown>) => void;
  readonly label: string;
}) {
  const post = (suffix: string, body: unknown = {}) => {
    act(() => bff('POST', `${base}/${item.id}/${suffix}`, body));
  };
  return (
    <>
      {canDraft && item.status === 'DRAFT' ? (
        <button
          type="button"
          onClick={() => {
            post('submission');
          }}
        >
          {C.submit} {label}
        </button>
      ) : null}
      {canApprove && item.status === 'PENDING_APPROVAL' && item.draftedByStaffId !== selfId ? (
        <>
          <button
            type="button"
            onClick={() => {
              post('approval', { decision: 'APPROVE' });
            }}
          >
            {STRINGS.staff.approve} {label}
          </button>
          <button
            type="button"
            onClick={() => {
              post('approval', { decision: 'REJECT' });
            }}
          >
            {STRINGS.staff.reject} {label}
          </button>
        </>
      ) : null}
      {canActivate && item.status === 'APPROVED' ? (
        <button
          type="button"
          onClick={() => {
            if (window.confirm(C.confirmActivate)) post('activation');
          }}
        >
          {C.activate} {label}
        </button>
      ) : null}
      {canActivate && (item.status === 'APPROVED' || item.status === 'ACTIVE') ? (
        <button
          type="button"
          onClick={() => {
            if (window.confirm(C.confirmRetire)) post('retirement');
          }}
        >
          {C.retire} {label}
        </button>
      ) : null}
      {canDraft && (item.status === 'APPROVED' || item.status === 'ACTIVE' || item.status === 'RETIRED') ? (
        <button
          type="button"
          onClick={() => {
            post('clones');
          }}
        >
          {C.clone} {label}
        </button>
      ) : null}
    </>
  );
}

const criteria = (r: Rule): string =>
  [
    r.minModelYear !== null ? `model year ≥ ${String(r.minModelYear)}` : null,
    r.maxVehicleAgeYears !== null ? `age ≤ ${String(r.maxVehicleAgeYears)} y` : null,
    r.minSeats !== null ? `seats ≥ ${String(r.minSeats)}` : null,
    r.acRequired ? 'AC' : null,
    r.allowedBodyTypes.length > 0 ? r.allowedBodyTypes.join('/') : null,
  ]
    .filter((x) => x !== null)
    .join(', ') || C.criteriaAny;

/** Vehicle eligibility rules per (city, product): draft, submit, approve by a different manager, activate, retire, clone. */
export function EligibilityRules({ selfId, can }: { readonly selfId: string; readonly can: CatalogPermissions }) {
  const { data, status, act } = useResource<{ rules: Rule[] }>('catalog/eligibility-rules', { rules: [] });
  const num = (v: FormDataEntryValue | null): number | null => (typeof v === 'string' && v.trim() !== '' ? Number(v) : null);
  return (
    <section aria-labelledby="rules-heading">
      <h2 id="rules-heading">{C.rulesHeading}</h2>
      <p>{C.rulesNote}</p>
      {status ? <p role="alert">{status}</p> : null}
      <table>
        <thead>
          <tr>
            <th scope="col">{C.city}</th>
            <th scope="col">{C.product}</th>
            <th scope="col">{C.version}</th>
            <th scope="col">{C.status}</th>
            <th scope="col">{C.criteria}</th>
            <th scope="col">{C.source}</th>
            <th scope="col">{C.actions}</th>
          </tr>
        </thead>
        <tbody>
          {data.rules.map((r) => (
            <tr key={r.id} data-testid={`rule-${r.productCode}-v${String(r.version)}`}>
              <td>{r.cityCode}</td>
              <td>{r.productCode}</td>
              <td>{r.version}</td>
              <td>
                {r.status}
                {r.isSynthetic ? ` (${C.synthetic})` : ''}
              </td>
              <td>{criteria(r)}</td>
              <td>{r.sourceReference}</td>
              <td>
                <LifecycleButtons
                  base="catalog/eligibility-rules"
                  item={r}
                  selfId={selfId}
                  canDraft={can.ruleDraft}
                  canApprove={can.ruleApprove}
                  canActivate={can.ruleActivate}
                  act={act}
                  label={`${r.productCode} v${String(r.version)}`}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {can.ruleDraft ? (
        <form
          aria-label={C.draftRule}
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const bodies = text(f.get('bodyTypes'))
              .split(',')
              .map((b) => b.trim().toUpperCase())
              .filter((b) => b !== '');
            act(() =>
              bff('POST', 'catalog/eligibility-rules', {
                cityCode: text(f.get('cityCode')).toUpperCase(),
                productCode: text(f.get('productCode')).toUpperCase(),
                sourceReference: text(f.get('sourceReference')),
                isSynthetic: f.get('isSynthetic') === 'on',
                minModelYear: null,
                maxVehicleAgeYears: num(f.get('maxAge')),
                minSeats: num(f.get('minSeats')),
                acRequired: f.get('acRequired') === 'on',
                allowedBodyTypes: bodies,
              }),
            );
          }}
        >
          <h3>{C.draftRule}</h3>
          <label>
            {C.city} <input name="cityCode" required defaultValue="LHR" maxLength={3} />
          </label>
          <label>
            {C.product} <input name="productCode" required maxLength={24} />
          </label>
          <label>
            {C.source} <input name="sourceReference" required minLength={3} maxLength={300} />
          </label>
          <label>
            {C.maxAge} <input name="maxAge" type="number" min={0} max={60} />
          </label>
          <label>
            {C.minSeats} <input name="minSeats" type="number" min={1} max={12} />
          </label>
          <label>
            <input name="acRequired" type="checkbox" /> {C.acRequired}
          </label>
          <label>
            {C.bodyTypes} <input name="bodyTypes" />
          </label>
          <label>
            <input name="isSynthetic" type="checkbox" /> {C.isSynthetic}
          </label>
          <button type="submit">{C.draftButton}</button>
        </form>
      ) : null}
    </section>
  );
}

interface ZoneSetSummary {
  id: string;
  cityCode: string;
  version: number;
  status: string;
  isSynthetic: boolean;
  sourceReference: string;
  draftedByStaffId: string | null;
  zoneCount: number;
}
interface ZoneSetDetail extends ZoneSetSummary {
  zones: Array<{
    code: string;
    kind: string;
    nameEn: string;
    products: string[];
    polygonCount: number;
    vertexCount: number;
    areaKm2: number;
    bbox: { minLat: number; minLng: number; maxLat: number; maxLng: number };
  }>;
  pickupPoints: Array<{ id: string; zoneCode: string; kind: string; nameEn: string; status: string; lat: number; lng: number }>;
  serviceHours: Array<{ productCode: string | null; weekday: number; opensLocal: string; closesLocal: string }>;
}
interface ImportResult {
  applied: boolean;
  issues: Array<{ featureIndex: number | null; code: string | null; issue: string; detail: string | null }>;
  zoneCount: number;
  pickupPointCount: number;
}

/** One zone set: geometry summary, pickup points, hours; DRAFT editing (GeoJSON import with validation report, hours). */
function ZoneSetDetailView({ id, onChanged }: { readonly id: string; readonly onChanged: () => void }) {
  const [detail, setDetail] = useState<ZoneSetDetail | null>(null);
  const [report, setReport] = useState<ImportResult | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    bff<ZoneSetDetail>('GET', `catalog/zone-sets/${id}`)
      .then((d) => {
        if (live) setDetail(d);
      })
      .catch((e: unknown) => {
        if (live) setStatus(message(e));
      });
    return () => {
      live = false;
    };
  }, [id, version]);
  const changed = () => {
    setVersion((v) => v + 1);
    onChanged();
  };
  if (!detail) return status ? <p role="alert">{status}</p> : null;
  const draft = detail.status === 'DRAFT';
  return (
    <section aria-labelledby="zone-set-detail-heading" data-testid="zone-set-detail">
      <h2 id="zone-set-detail-heading">
        {detail.cityCode} v{detail.version} — {detail.status}
        {detail.isSynthetic ? ` (${C.synthetic})` : ''}
      </h2>
      <p>{detail.sourceReference}</p>
      {status ? <p role="alert">{status}</p> : null}
      <table>
        <caption>{Z.zonesTable}</caption>
        <thead>
          <tr>
            <th scope="col">{Z.code}</th>
            <th scope="col">{Z.kind}</th>
            <th scope="col">{Z.name}</th>
            <th scope="col">{Z.products}</th>
            <th scope="col">{Z.polygons}</th>
            <th scope="col">{Z.vertices}</th>
            <th scope="col">{Z.area}</th>
            <th scope="col">{Z.bbox}</th>
          </tr>
        </thead>
        <tbody>
          {detail.zones.map((z) => (
            <tr key={z.code} data-testid={`zone-${z.code}`}>
              <td>{z.code}</td>
              <td>{z.kind}</td>
              <td>{z.nameEn}</td>
              <td>{z.products.length > 0 ? z.products.join(', ') : Z.allProducts}</td>
              <td>{z.polygonCount}</td>
              <td>{z.vertexCount}</td>
              <td>{z.areaKm2}</td>
              <td>
                {z.bbox.minLat}, {z.bbox.minLng} — {z.bbox.maxLat}, {z.bbox.maxLng}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <table>
        <caption>{Z.pointsTable}</caption>
        <thead>
          <tr>
            <th scope="col">{Z.code}</th>
            <th scope="col">{Z.kind}</th>
            <th scope="col">{Z.name}</th>
            <th scope="col">{C.status}</th>
            <th scope="col">lat, lng</th>
          </tr>
        </thead>
        <tbody>
          {detail.pickupPoints.map((p) => (
            <tr key={p.id}>
              <td>{p.zoneCode}</td>
              <td>{p.kind}</td>
              <td>{p.nameEn}</td>
              <td>{p.status}</td>
              <td>
                {p.lat}, {p.lng}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <table>
        <caption>{Z.hoursTable}</caption>
        <thead>
          <tr>
            <th scope="col">{Z.weekday}</th>
            <th scope="col">{C.product}</th>
            <th scope="col">{Z.window}</th>
          </tr>
        </thead>
        <tbody>
          {detail.serviceHours.length === 0 ? (
            <tr>
              <td colSpan={3}>{Z.noHours}</td>
            </tr>
          ) : (
            detail.serviceHours.map((h) => (
              <tr key={`${h.productCode ?? 'all'}-${String(h.weekday)}-${h.opensLocal}`}>
                <td>{Z.weekdays[h.weekday]}</td>
                <td>{h.productCode ?? Z.allProducts}</td>
                <td>
                  {h.opensLocal}–{h.closesLocal}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      {draft ? (
        <>
          <form
            aria-label={Z.importHeading}
            onSubmit={(e) => {
              e.preventDefault();
              setStatus(null);
              setReport(null);
              const text = new FormData(e.currentTarget).get('geojson');
              let featureCollection: unknown;
              try {
                featureCollection = JSON.parse(typeof text === 'string' ? text : '');
              } catch {
                setStatus(Z.invalidJson);
                return;
              }
              void bff<ImportResult>('POST', `catalog/zone-sets/${id}/zone-imports`, { featureCollection })
                .then((r) => {
                  setReport(r);
                  if (r.applied) changed();
                })
                .catch((err: unknown) => {
                  setStatus(message(err));
                });
            }}
          >
            <h3>{Z.importHeading}</h3>
            <label>
              {Z.importLabel}
              <textarea name="geojson" rows={8} cols={80} required />
            </label>
            <button type="submit">{Z.importButton}</button>
          </form>
          {report ? (
            report.applied ? (
              <p role="status">
                {Z.imported} {report.zoneCount}
              </p>
            ) : (
              <div role="alert">
                <p>{Z.rejected}</p>
                <table data-testid="import-report">
                  <thead>
                    <tr>
                      <th scope="col">{Z.feature}</th>
                      <th scope="col">{Z.code}</th>
                      <th scope="col">{Z.issue}</th>
                      <th scope="col">{Z.detail}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.issues.map((i, n) => (
                      <tr key={`${String(i.featureIndex)}-${i.issue}-${String(n)}`}>
                        <td>{i.featureIndex === null ? Z.collection : i.featureIndex}</td>
                        <td>{i.code ?? '—'}</td>
                        <td>{i.issue}</td>
                        <td>{i.detail ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : null}
          <form
            aria-label={Z.hoursHeading}
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const opensLocal = text(f.get('opens'));
              const closesLocal = text(f.get('closes'));
              setStatus(null);
              void bff('POST', `catalog/zone-sets/${id}/service-hours`, {
                hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ productCode: null, weekday, opensLocal, closesLocal })),
              })
                .then(changed)
                .catch((err: unknown) => {
                  setStatus(message(err));
                });
            }}
          >
            <h3>{Z.hoursHeading}</h3>
            <label>
              {Z.opens} <input name="opens" required pattern="([01][0-9]|2[0-3]):[0-5][0-9]" defaultValue="06:00" />
            </label>
            <label>
              {Z.closes} <input name="closes" required pattern="([01][0-9]|2[0-3]):[0-5][0-9]|24:00" defaultValue="23:00" />
            </label>
            <button type="submit">{Z.hoursButton}</button>
          </form>
        </>
      ) : null}
    </section>
  );
}

/** Zone sets: list, draft, open one (summary + import + hours) and the maker-checker lifecycle. */
export function ZoneSets({ selfId, can }: { readonly selfId: string; readonly can: CatalogPermissions }) {
  const { data, status, act } = useResource<{ zoneSets: ZoneSetSummary[] }>('catalog/zone-sets', { zoneSets: [] });
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <section aria-labelledby="zone-sets-heading">
        <h2 id="zone-sets-heading">{Z.heading}</h2>
        <p>{Z.note}</p>
        {status ? <p role="alert">{status}</p> : null}
        <table>
          <thead>
            <tr>
              <th scope="col">{C.city}</th>
              <th scope="col">{C.version}</th>
              <th scope="col">{C.status}</th>
              <th scope="col">{Z.zonesTable}</th>
              <th scope="col">{C.source}</th>
              <th scope="col">{C.actions}</th>
            </tr>
          </thead>
          <tbody>
            {data.zoneSets.map((s) => (
              <tr key={s.id} data-testid={`zone-set-v${String(s.version)}`}>
                <td>{s.cityCode}</td>
                <td>{s.version}</td>
                <td>
                  {s.status}
                  {s.isSynthetic ? ` (${C.synthetic})` : ''}
                </td>
                <td>{s.zoneCount}</td>
                <td>{s.sourceReference}</td>
                <td>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(s.id);
                    }}
                  >
                    {Z.view} v{s.version}
                  </button>
                  <LifecycleButtons
                    base="catalog/zone-sets"
                    item={s}
                    selfId={selfId}
                    canDraft={can.zoneDraft}
                    canApprove={can.zoneApprove}
                    canActivate={can.zoneActivate}
                    act={act}
                    label={`v${String(s.version)}`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {can.zoneDraft ? (
          <form
            aria-label={Z.draftHeading}
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              act(() =>
                bff('POST', 'catalog/zone-sets', {
                  cityCode: text(f.get('cityCode')).trim().toUpperCase(),
                  sourceReference: text(f.get('sourceReference')),
                  isSynthetic: f.get('isSynthetic') === 'on',
                }),
              );
            }}
          >
            <h3>{Z.draftHeading}</h3>
            <label>
              {C.city} <input name="cityCode" required defaultValue="LHR" maxLength={3} />
            </label>
            <label>
              {Z.sourceReference} <input name="sourceReference" required minLength={3} maxLength={300} />
            </label>
            <label>
              <input name="isSynthetic" type="checkbox" defaultChecked /> {C.isSynthetic}
            </label>
            <button type="submit">{Z.draftButton}</button>
          </form>
        ) : null}
      </section>
      {open ? (
        <ZoneSetDetailView
          // re-mounts when the set changes state through the list actions (e.g. submitted), so DRAFT-only forms disappear
          key={`${open}-${data.zoneSets.find((z) => z.id === open)?.status ?? ''}`}
          id={open}
          onChanged={() => {
            act(() => Promise.resolve());
          }}
        />
      ) : null}
    </>
  );
}
