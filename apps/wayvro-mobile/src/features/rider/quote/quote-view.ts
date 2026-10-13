import { QUOTE_UNAVAILABLE_REASONS, type MoneyAmount, type QuoteGroup, type QuoteOption } from '@wayvro/contracts';
import { toApiError } from '../../../core/api/errors';
import { pkrParts, formatPkr } from '../../../core/i18n/money';
import { isStringKey, type StringKey, type TranslationParams, type UiLocale } from '../../../core/i18n/strings';
import type { DraftPlace } from '../flow/draft';
import { countdownState } from './countdown';

/**
 * Quote view-state adapter (B03/B04/B06 display; E07/CON-P3-08; UX doc §8.4). Every price, expiry and availability
 * comes from the server; this adapter only turns it into text. Refusals are explicit states — an outage shows NO price
 * rather than a guess, an expired quote is greyed and labelled (never silently replaced), and outside-area/hours/
 * pickup-restricted each get their own words.
 */
export type Tr = (key: StringKey, params?: TranslationParams) => string;

type ServiceAreaReason = (typeof QUOTE_UNAVAILABLE_REASONS)[number];

export type QuoteRefusal =
  | {
      readonly kind: 'service-area';
      readonly reason: ServiceAreaReason;
      readonly nextOpenAt: string | null;
      readonly failedEnd: 'pickup' | 'dropoff' | 'both' | null;
    }
  /** 503 ROUTING_UNAVAILABLE / dependency or maintenance: no price, no ETA, retry with backoff. */
  | { readonly kind: 'routing-unavailable' }
  | { readonly kind: 'rate-limited'; readonly seconds: number | null }
  | { readonly kind: 'offline' }
  | { readonly kind: 'disabled'; readonly reason: 'FEATURE_DISABLED' | 'ACCOUNT_RESTRICTED' }
  /** The place reference expired or is no longer valid: the rider chooses the place again. */
  | { readonly kind: 'place-invalid'; readonly reason: 'PLACE' | 'OUTSIDE_COUNTRY' | 'SAME_POINT' }
  /** A restored/intent quote group the server does not return to this account (403/404). */
  | { readonly kind: 'not-found' }
  | { readonly kind: 'error' };

const KNOWN_REASONS: ReadonlySet<string> = new Set(QUOTE_UNAVAILABLE_REASONS);
const isReason = (code: string): code is ServiceAreaReason => KNOWN_REASONS.has(code);

function failedEnd(pickup: DraftPlace | null, dropoff: DraftPlace | null): 'pickup' | 'dropoff' | 'both' | null {
  const p = pickup?.inServiceArea === false;
  const d = dropoff?.inServiceArea === false;
  return p && d ? 'both' : p ? 'pickup' : d ? 'dropoff' : null;
}

/** Maps a failed quote call to its refusal state. */
export function quoteRefusal(error: unknown, draft: { readonly pickup: DraftPlace | null; readonly dropoff: DraftPlace | null }): QuoteRefusal {
  const e = toApiError(error);
  switch (e.kind) {
    case 'service-area': {
      const reason = e.detail.reasonCodes.find(isReason) ?? 'ZONE_NOT_SERVED';
      return {
        kind: 'service-area',
        reason,
        nextOpenAt: e.detail.nextOpenAt,
        failedEnd: reason === 'ZONE_NOT_SERVED' ? failedEnd(draft.pickup, draft.dropoff) : null,
      };
    }
    case 'unavailable':
    case 'maintenance':
      return { kind: 'routing-unavailable' };
    case 'rate-limited':
      return { kind: 'rate-limited', seconds: e.detail.retryAfterSeconds };
    case 'offline':
      return { kind: 'offline' };
    case 'feature-disabled':
      return { kind: 'disabled', reason: 'FEATURE_DISABLED' };
    case 'restricted':
      return { kind: 'disabled', reason: 'ACCOUNT_RESTRICTED' };
    case 'validation':
      if (e.detail.reasonCodes.includes('OUTSIDE_COUNTRY')) return { kind: 'place-invalid', reason: 'OUTSIDE_COUNTRY' };
      if (e.detail.reasonCodes.includes('SAME_POINT')) return { kind: 'place-invalid', reason: 'SAME_POINT' };
      return { kind: 'place-invalid', reason: 'PLACE' };
    case 'conflict':
      return e.detail.status === 404 || e.detail.status === 403 ? { kind: 'not-found' } : { kind: 'error' };
    case 'session-expired':
    case 'step-up-required':
    case 'required-action':
    case 'update-required':
    case 'unknown':
      return e.detail.status === 404 || e.detail.status === 403 ? { kind: 'not-found' } : { kind: 'error' };
  }
}

/** Retry backoff after "no price right now": 2 s, 4 s, 8 s, 16 s, then 30 s (no retry storm). `attempt` is 0-based. */
export function routingRetryDelayMs(attempt: number): number {
  return Math.min(30_000, 2_000 * 2 ** Math.max(0, Math.min(attempt, 5)));
}

/** Product display name: the server's nameKey when the app knows it, else a key derived from the code, else the code. */
export function productName(tr: Tr, nameKey: string | null, productCode: string): string {
  const candidates = [nameKey, `product.${productCode.toLowerCase()}.name`];
  for (const key of candidates) if (key !== null && isStringKey(key)) return tr(key);
  return productCode;
}

/** Spoken money ("640 rupees", "640 rupees 50 paisa"); null when the amount is malformed. @internal exported for unit tests */
export function spokenMoney(tr: Tr, amount: MoneyAmount): string | null {
  const parts = pkrParts(amount);
  if (parts === null) return null;
  const rupees = `${parts.negative ? '-' : ''}${parts.rupees}`;
  return parts.paisa === null ? tr('money.spoken', { rupees }) : tr('money.spokenPaisa', { rupees, paisa: parts.paisa });
}

const LUGGAGE_KEY: Readonly<Record<QuoteOption['display']['luggageClass'], StringKey>> = {
  NONE: 'luggage.NONE',
  SMALL: 'luggage.SMALL',
  STANDARD: 'luggage.STANDARD',
  LARGE: 'luggage.LARGE',
};

const CONFIDENCE_KEY: Readonly<Record<QuoteGroup['route']['confidence'], StringKey>> = {
  HIGH: 'confidence.HIGH',
  MEDIUM: 'confidence.MEDIUM',
  LOW: 'confidence.LOW',
  UNKNOWN: 'confidence.UNKNOWN',
};

interface OptionView {
  readonly quoteId: string;
  readonly title: string;
  readonly lines: readonly string[];
  readonly price: string | null;
  readonly expiresAt: string;
  readonly expired: boolean;
  /** Spoken label without the validity (the screen appends it from the live countdown). */
  readonly spoken: string;
}

interface UnavailableView {
  readonly productCode: string;
  readonly title: string;
  readonly reason: string;
}

interface RouteView {
  readonly from: string | null;
  readonly to: string | null;
  readonly summary: string;
  readonly confidenceLevel: QuoteGroup['route']['confidence'];
  readonly confidence: string;
  readonly snappedPickup: string | null;
  readonly attribution: string | null;
}

export interface PricedView {
  readonly route: RouteView;
  readonly options: readonly OptionView[];
  readonly unavailable: readonly UnavailableView[];
  readonly anyExpired: boolean;
}

/** Placeholder-free display line of a place ("Pinned location" when the server knows no address). */
export function placeLine(tr: Tr, place: DraftPlace | null): string | null {
  if (place === null) return null;
  return place.primary ?? tr('rider.place.pinned');
}

/** "Opens 06:00" in Asia/Karachi (UTC+05:00, no DST) from the server's next-opening instant. @internal exported for unit tests */
export function karachiTime(iso: string): string | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const local = new Date(ms + 5 * 60 * 60 * 1000);
  return `${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')}`;
}

function unavailableReason(tr: Tr, row: QuoteGroup['unavailable'][number]): string {
  if (row.reasonCode === 'OUTSIDE_SERVICE_HOURS') {
    const time = row.nextOpenAt === null ? null : karachiTime(row.nextOpenAt);
    return time === null ? tr('rider.unavailable.OUTSIDE_SERVICE_HOURS') : tr('rider.unavailable.opensAt', { time });
  }
  return tr(`rider.unavailable.${row.reasonCode}`);
}

export function pricedView(
  tr: Tr,
  locale: UiLocale,
  group: QuoteGroup,
  draft: { readonly pickup: DraftPlace | null; readonly dropoff: DraftPlace | null },
  serverNowMs: number,
): PricedView {
  const km = (group.route.distanceM / 1000).toFixed(1);
  const minutes = Math.max(1, Math.round(group.route.durationS / 60));
  const snapped = group.pickup.snappedTo;
  const options = group.options.map((option): OptionView => {
    const title = productName(tr, option.display.nameKey, option.productCode);
    const seats = tr('rider.quote.seats', { count: option.display.seatsMax });
    const luggage = tr(LUGGAGE_KEY[option.display.luggageClass]);
    const notes = [
      ...(option.tollPolicy === 'EXCLUDED_DISCLOSED' ? [tr('rider.quote.tollsExcluded')] : []),
      ...(option.isSynthetic ? [tr('rider.quote.synthetic')] : []),
    ];
    const expired = option.status !== 'PRICED' || countdownState(option.expiresAt, serverNowMs).expired;
    const expiredNote = expired ? [tr('rider.quote.expiredLabel')] : [];
    const spokenPrice = expired ? tr('rider.quote.expiredLabel') : (spokenMoney(tr, option.total) ?? tr('rider.quote.noPrice'));
    return {
      quoteId: option.quoteId,
      title,
      lines: [`${seats} · ${luggage}`, ...notes, ...expiredNote],
      price: formatPkr(option.total),
      expiresAt: option.expiresAt,
      expired,
      spoken: [title, seats, luggage, spokenPrice, ...notes].join('. '),
    };
  });
  return {
    route: {
      from: placeLine(tr, draft.pickup),
      to: placeLine(tr, draft.dropoff),
      summary: tr('rider.quote.summary', { km, minutes }),
      confidenceLevel: group.route.confidence,
      confidence: tr(CONFIDENCE_KEY[group.route.confidence]),
      snappedPickup: snapped === null ? null : tr('rider.quote.snappedPickup', { name: locale === 'ur' ? snapped.nameUr : snapped.nameEn }),
      attribution: group.route.source.attributionCode === null ? null : attributionText(tr, group.route.source.attributionCode),
    },
    options,
    unavailable: group.unavailable.map((row) => ({
      productCode: row.productCode,
      title: productName(tr, null, row.productCode),
      reason: unavailableReason(tr, row),
    })),
    anyExpired: options.some((o) => o.expired),
  };
}

/**
 * Restoration card on the rider home (UX doc §6 step 7): a still-priced group offers "Continue with your last price
 * check" with its lowest price; an expired/superseded one says prices have been updated.
 */
export type LastQuoteSummary = { readonly kind: 'priced'; readonly line: string } | { readonly kind: 'updated' };

export function lastQuoteSummary(tr: Tr, group: QuoteGroup, serverNowMs: number): LastQuoteSummary {
  const live = group.options.filter((o) => o.status === 'PRICED' && !countdownState(o.expiresAt, serverNowMs).expired && pkrParts(o.total) !== null);
  const cheapest = live.reduce<QuoteOption | null>((best, o) => (best === null || BigInt(o.total.minor) < BigInt(best.total.minor) ? o : best), null);
  if (cheapest === null) return { kind: 'updated' };
  return { kind: 'priced', line: `${productName(tr, cheapest.display.nameKey, cheapest.productCode)} · ${formatPkr(cheapest.total) ?? ''}` };
}

/** The earliest expiry of a group's options (what the restoration record stores); null when nothing was priced. */
export function earliestExpiry(group: QuoteGroup): string | null {
  const times = group.options.map((o) => o.expiresAt).sort((a, b) => Date.parse(a) - Date.parse(b));
  return times[0] ?? null;
}

/** Required licence attribution as text (B03); unknown codes are shown as the code itself, never dropped. @internal exported for unit tests */
export function attributionText(tr: Tr, code: string): string {
  return code === 'OSM_ODBL' ? tr('geo.attribution.OSM_ODBL') : tr('geo.attribution.other', { code });
}

/** The copy of a refusal (title + body + primary action). */
export interface RefusalCopy {
  readonly title: string;
  readonly body: string;
  readonly action: 'retry' | 'change-pickup' | 'change-dropoff' | 'change-trip' | 'appeal' | 'none';
}

export function refusalCopy(tr: Tr, refusal: QuoteRefusal): RefusalCopy {
  switch (refusal.kind) {
    case 'service-area': {
      if (refusal.reason === 'OUTSIDE_SERVICE_HOURS') {
        const time = refusal.nextOpenAt === null ? null : karachiTime(refusal.nextOpenAt);
        return {
          title: tr('rider.hours.title'),
          body: time === null ? tr('rider.hours.body') : tr('rider.hours.bodyNext', { time }),
          action: 'change-trip',
        };
      }
      if (refusal.reason === 'PICKUP_RESTRICTED')
        return { title: tr('rider.area.restrictedTitle'), body: tr('rider.area.restrictedBody'), action: 'change-pickup' };
      if (refusal.reason === 'ROUTE_TOO_LONG') return { title: tr('rider.area.tooLongTitle'), body: tr('rider.area.tooLongBody'), action: 'change-dropoff' };
      if (refusal.reason === 'NO_ACTIVE_RATE_CARD') return { title: tr('rider.area.noPricesTitle'), body: tr('rider.area.noPricesBody'), action: 'none' };
      const which = refusal.failedEnd ?? 'unknown';
      return {
        title: tr('rider.area.title'),
        body: tr(`rider.area.body.${which}`),
        action:
          refusal.failedEnd === 'dropoff' ? 'change-dropoff' : refusal.failedEnd === null || refusal.failedEnd === 'both' ? 'change-trip' : 'change-pickup',
      };
    }
    case 'routing-unavailable':
      return { title: tr('rider.degraded.title'), body: tr('rider.degraded.noGuess'), action: 'retry' };
    case 'rate-limited':
      return {
        title: tr('rider.quote.busyTitle'),
        body: refusal.seconds === null ? tr('error.rateLimitedNoTime') : tr('error.rateLimited', { seconds: refusal.seconds }),
        action: 'retry',
      };
    case 'offline':
      return { title: tr('rider.offline.title'), body: tr('rider.quote.offline'), action: 'retry' };
    case 'disabled':
      return refusal.reason === 'ACCOUNT_RESTRICTED'
        ? { title: tr('rider.disabled.title'), body: tr('rider.disabled.restricted'), action: 'appeal' }
        : { title: tr('rider.disabled.title'), body: tr('rider.disabled.switchedOff'), action: 'none' };
    case 'place-invalid':
      return { title: tr('rider.place.invalidTitle'), body: tr(`rider.place.invalid.${refusal.reason}`), action: 'change-trip' };
    case 'not-found':
      return { title: tr('rider.quote.notFoundTitle'), body: tr('rider.quote.notFoundBody'), action: 'change-trip' };
    case 'error':
      return { title: tr('rider.quote.errorTitle'), body: tr('error.unknown'), action: 'retry' };
  }
}
