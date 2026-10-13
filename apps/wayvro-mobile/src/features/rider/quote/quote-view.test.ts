import { describe, expect, it } from 'vitest';
import { P3_IDS, quoteGroup, quoteOption, SERVER_NOW } from '../../../__mocks__/p3-fixtures';
import { ApiError } from '../../../core/api/errors';
import { t, type StringKey, type TranslationParams } from '../../../core/i18n/strings';
import type { DraftPlace } from '../flow/draft';
import { announcementFor, countdownState, countdownText } from './countdown';
import { fareView } from './fare-view';
import {
  attributionText,
  earliestExpiry,
  karachiTime,
  lastQuoteSummary,
  pricedView,
  productName,
  quoteRefusal,
  refusalCopy,
  routingRetryDelayMs,
  spokenMoney,
} from './quote-view';

const tr = (key: StringKey, params?: TranslationParams) => t('en', key, params);
const place = (primary: string | null, inServiceArea: boolean | null = true): DraftPlace => ({
  primary,
  secondary: null,
  point: { lat: 31.5, lng: 74.3 },
  placeRef: null,
  source: 'search',
  inServiceArea,
});
const NO_DRAFT = { pickup: null, dropoff: null };

describe('quote countdown on the server-offset clock', () => {
  it('counts down from the server expiry; device time is not used', () => {
    expect(countdownState('2026-10-13T10:05:00.000Z', SERVER_NOW)).toEqual({ remainingS: 272, expired: false });
    expect(countdownState('2026-10-13T10:05:00.000Z', Date.parse('2026-10-13T10:05:00.000Z'))).toEqual({ remainingS: 0, expired: true });
    expect(countdownState('not-a-date', SERVER_NOW)).toEqual({ remainingS: 0, expired: true });
    expect(countdownText(272)).toBe('4:32');
    expect(countdownText(5)).toBe('0:05');
  });

  it('announces only at thresholds: one minute left, then expiry', () => {
    expect([272, 61, 60, 30, 1, 0].map(announcementFor)).toEqual([null, null, 'ONE_MINUTE', 'ONE_MINUTE', 'ONE_MINUTE', 'EXPIRED']);
  });
});

describe('quote view adapter (B03/B04/B06 display)', () => {
  it('shows server values only: route summary, confidence (text), options with seats/luggage/price/toll note, unavailable rows', () => {
    const view = pricedView(tr, 'en', quoteGroup(), { pickup: place('Liberty Market'), dropoff: place(null) }, SERVER_NOW);
    expect(view.route).toMatchObject({
      from: 'Liberty Market',
      to: 'Pinned location',
      summary: '7.4 km · about 22 min',
      confidence: 'Route: medium confidence',
      attribution: null,
    });
    expect(view.options).toEqual([
      {
        quoteId: P3_IDS.quoteEconomy,
        title: 'Economy',
        lines: ['4 seats · small bags', 'Tolls are not included', 'Test price (synthetic data)'],
        price: 'Rs 640',
        expiresAt: '2026-10-13T10:05:00.000Z',
        expired: false,
        spoken: 'Economy. 4 seats. small bags. 640 rupees. Tolls are not included. Test price (synthetic data)',
      },
    ]);
    expect(view.unavailable).toEqual([{ productCode: 'COMFORT', title: 'Comfort', reason: 'Not available here yet' }]);
    expect(view.anyExpired).toBe(false);
  });

  it('an expired or superseded option is greyed and labelled, never silently replaced', () => {
    const expired = pricedView(tr, 'en', quoteGroup(), NO_DRAFT, Date.parse('2026-10-13T10:06:00.000Z'));
    expect(expired.anyExpired).toBe(true);
    expect(expired.options[0]?.lines).toContain('Expired');
    expect(expired.options[0]?.spoken).toContain('Expired');
    expect(expired.options[0]?.price).toBe('Rs 640');
    const superseded = pricedView(tr, 'en', quoteGroup({ options: [quoteOption({ status: 'SUPERSEDED' })] }), NO_DRAFT, SERVER_NOW);
    expect(superseded.options[0]?.expired).toBe(true);
  });

  it('outside-hours unavailable rows give the next opening in Asia/Karachi time; unknown products show their code', () => {
    const group = quoteGroup({
      unavailable: [
        { productCode: 'COMFORT', reasonCode: 'OUTSIDE_SERVICE_HOURS', nextOpenAt: '2026-10-14T01:00:00.000Z' },
        { productCode: 'VAN_XL', reasonCode: 'NO_ACTIVE_RATE_CARD', nextOpenAt: null },
      ],
    });
    expect(pricedView(tr, 'en', group, NO_DRAFT, SERVER_NOW).unavailable).toEqual([
      { productCode: 'COMFORT', title: 'Comfort', reason: 'Not running now · starts again at 06:00' },
      { productCode: 'VAN_XL', title: 'VAN_XL', reason: 'No prices are set for this service yet' },
    ]);
    expect(karachiTime('2026-10-13T19:30:00.000Z')).toBe('00:30');
    expect(karachiTime('nope')).toBeNull();
  });

  it('snapped pickup, required attribution, product names and spoken money', () => {
    const group = quoteGroup({
      pickup: {
        snappedTo: {
          pickupPointId: P3_IDS.document,
          kind: 'AIRPORT',
          nameEn: 'Synthetic Gate 1',
          nameUr: 'مصنوعی گیٹ',
          instructionKey: 'pickup.gate',
          point: { lat: 31.5, lng: 74.4 },
        },
      },
      route: { ...quoteGroup().route, source: { ...quoteGroup().route.source, attributionCode: 'OSM_ODBL' } },
    });
    expect(pricedView(tr, 'en', group, NO_DRAFT, SERVER_NOW).route).toMatchObject({
      snappedPickup: 'Pickup point: Synthetic Gate 1',
      attribution: '© OpenStreetMap contributors',
    });
    expect(pricedView(tr, 'ur', group, NO_DRAFT, SERVER_NOW).route.snappedPickup).toBe('Pickup point: مصنوعی گیٹ');
    expect(attributionText(tr, 'OTHER_DATA')).toBe('Map data attribution: OTHER_DATA');
    expect(productName(tr, 'product.unknown.name', 'COMFORT')).toBe('Comfort');
    expect(productName(tr, null, 'BIKE')).toBe('Bike');
    expect(spokenMoney(tr, { currency: 'PKR', minor: '64050' })).toBe('640 rupees 50 paisa');
    expect(spokenMoney(tr, { currency: 'PKR', minor: 'x' })).toBeNull();
  });

  it('restoration summary: lowest live price, else "prices have been updated"; earliest expiry for the record', () => {
    const group = quoteGroup({
      options: [
        quoteOption(),
        quoteOption({
          quoteId: P3_IDS.quoteComfort,
          productCode: 'COMFORT',
          total: { currency: 'PKR', minor: '90000' },
          display: { nameKey: 'product.comfort.name', seatsMax: 4, luggageClass: 'STANDARD' },
          expiresAt: '2026-10-13T10:04:00.000Z',
        }),
      ],
    });
    expect(lastQuoteSummary(tr, group, SERVER_NOW)).toEqual({ kind: 'priced', line: 'Economy · Rs 640' });
    expect(lastQuoteSummary(tr, group, Date.parse('2026-10-13T10:30:00.000Z'))).toEqual({ kind: 'updated' });
    expect(earliestExpiry(group)).toBe('2026-10-13T10:04:00.000Z');
    expect(earliestExpiry(quoteGroup({ options: [] }))).toBeNull();
  });
});

describe('quote refusals (E07/CON-P3-08: no price rather than a guess)', () => {
  const area = (reasons: string[], nextOpenAt?: string) =>
    new ApiError('service-area', { status: 422, reasonCodes: reasons, ...(nextOpenAt === undefined ? {} : { nextOpenAt }) });

  it('maps every refusal state', () => {
    expect(quoteRefusal(area(['ZONE_NOT_SERVED']), { pickup: place('a', false), dropoff: place('b', true) })).toEqual({
      kind: 'service-area',
      reason: 'ZONE_NOT_SERVED',
      nextOpenAt: null,
      failedEnd: 'pickup',
    });
    expect(quoteRefusal(area(['ZONE_NOT_SERVED']), { pickup: place('a', true), dropoff: place('b', false) })).toMatchObject({ failedEnd: 'dropoff' });
    expect(quoteRefusal(area(['ZONE_NOT_SERVED']), { pickup: place('a', false), dropoff: place('b', false) })).toMatchObject({ failedEnd: 'both' });
    expect(quoteRefusal(area(['UNKNOWN_FUTURE_CODE']), NO_DRAFT)).toMatchObject({ reason: 'ZONE_NOT_SERVED', failedEnd: null });
    expect(quoteRefusal(area(['OUTSIDE_SERVICE_HOURS'], '2026-10-14T01:00:00.000Z'), NO_DRAFT)).toEqual({
      kind: 'service-area',
      reason: 'OUTSIDE_SERVICE_HOURS',
      nextOpenAt: '2026-10-14T01:00:00.000Z',
      failedEnd: null,
    });
    expect(quoteRefusal(new ApiError('unavailable', { status: 503, reasonCodes: ['ROUTING_UNAVAILABLE'] }), NO_DRAFT)).toEqual({ kind: 'routing-unavailable' });
    expect(quoteRefusal(new ApiError('maintenance', { status: 503 }), NO_DRAFT)).toEqual({ kind: 'routing-unavailable' });
    expect(quoteRefusal(new ApiError('rate-limited', { status: 429, retryAfterSeconds: 20 }), NO_DRAFT)).toEqual({ kind: 'rate-limited', seconds: 20 });
    expect(quoteRefusal(new ApiError('offline'), NO_DRAFT)).toEqual({ kind: 'offline' });
    expect(quoteRefusal(new ApiError('feature-disabled', { status: 404 }), NO_DRAFT)).toEqual({ kind: 'disabled', reason: 'FEATURE_DISABLED' });
    expect(quoteRefusal(new ApiError('restricted', { status: 403 }), NO_DRAFT)).toEqual({ kind: 'disabled', reason: 'ACCOUNT_RESTRICTED' });
    expect(quoteRefusal(new ApiError('validation', { status: 400, reasonCodes: ['PLACE_REF_EXPIRED'] }), NO_DRAFT)).toEqual({
      kind: 'place-invalid',
      reason: 'PLACE',
    });
    expect(quoteRefusal(new ApiError('validation', { status: 400, reasonCodes: ['OUTSIDE_COUNTRY'] }), NO_DRAFT)).toEqual({
      kind: 'place-invalid',
      reason: 'OUTSIDE_COUNTRY',
    });
    expect(quoteRefusal(new ApiError('validation', { status: 400, reasonCodes: ['SAME_POINT'] }), NO_DRAFT)).toEqual({
      kind: 'place-invalid',
      reason: 'SAME_POINT',
    });
    expect(quoteRefusal(new ApiError('conflict', { status: 404 }), NO_DRAFT)).toEqual({ kind: 'not-found' });
    expect(quoteRefusal(new ApiError('unknown', { status: 403 }), NO_DRAFT)).toEqual({ kind: 'not-found' });
    expect(quoteRefusal(new ApiError('conflict', { status: 409 }), NO_DRAFT)).toEqual({ kind: 'error' });
    expect(quoteRefusal(new Error('raw'), NO_DRAFT)).toEqual({ kind: 'error' });
  });

  it('every refusal has its own words and action; an outage never shows a price', () => {
    expect(refusalCopy(tr, { kind: 'routing-unavailable' })).toEqual({
      title: "We can't calculate prices right now",
      body: 'No price is shown rather than a guess. Please try again shortly.',
      action: 'retry',
    });
    expect(refusalCopy(tr, { kind: 'service-area', reason: 'OUTSIDE_SERVICE_HOURS', nextOpenAt: '2026-10-14T01:00:00.000Z', failedEnd: null }).body).toBe(
      'Rides here start again at 06:00 (Pakistan time).',
    );
    expect(refusalCopy(tr, { kind: 'service-area', reason: 'ZONE_NOT_SERVED', nextOpenAt: null, failedEnd: 'dropoff' })).toMatchObject({
      action: 'change-dropoff',
    });
    expect(refusalCopy(tr, { kind: 'service-area', reason: 'PICKUP_RESTRICTED', nextOpenAt: null, failedEnd: null })).toMatchObject({
      action: 'change-pickup',
    });
    expect(refusalCopy(tr, { kind: 'rate-limited', seconds: 30 }).body).toBe('Too many attempts. Try again in 30 seconds.');
    expect(refusalCopy(tr, { kind: 'disabled', reason: 'ACCOUNT_RESTRICTED' }).action).toBe('appeal');
    const all = [
      { kind: 'offline' as const },
      { kind: 'not-found' as const },
      { kind: 'error' as const },
      { kind: 'disabled' as const, reason: 'FEATURE_DISABLED' as const },
      { kind: 'place-invalid' as const, reason: 'SAME_POINT' as const },
      { kind: 'service-area' as const, reason: 'ROUTE_TOO_LONG' as const, nextOpenAt: null, failedEnd: null },
      { kind: 'service-area' as const, reason: 'NO_ACTIVE_RATE_CARD' as const, nextOpenAt: null, failedEnd: null },
    ];
    for (const refusal of all) {
      const copy = refusalCopy(tr, refusal);
      expect(copy.body).not.toMatch(/Rs |\{/);
      expect(copy.title.length).toBeGreaterThan(0);
    }
  });

  it('routing retries back off 2 s → 30 s', () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(routingRetryDelayMs)).toEqual([2000, 4000, 8000, 16000, 30000, 30000, 30000]);
  });
});

describe('fare breakdown (components exactly as sent, total last)', () => {
  it('keeps server order and amounts; tolls excluded are disclosed; total is the server total', () => {
    const view = fareView(tr, quoteOption({ taxIncluded: { rateBp: 1600, amount: { currency: 'PKR', minor: '8828' } } }), SERVER_NOW);
    expect(view.rows.map((r) => [r.label, r.amount])).toEqual([
      ['Base fare', 'Rs 150'],
      ['Distance', 'Rs 370'],
      ['Time', 'Rs 110'],
      ['Tolls', 'Not included'],
      ['Rounding', 'Rs 10'],
    ]);
    expect(view.total).toEqual({ label: 'Total', amount: 'Rs 640' });
    expect(view.notes).toEqual(['Tolls are not included', 'Includes tax at 16%: Rs 88.28', "Prices are calculated by Wayvro's servers."]);
    expect(view.reference).toBe('Rate card 3 · pe-v1');
    expect(view.expired).toBe(false);
  });

  it('renders every component kind with its own label', () => {
    const kinds = ['BASE', 'DISTANCE', 'TIME', 'BOOKING_FEE', 'AIRPORT_FEE', 'MINIMUM_ADJUSTMENT', 'TOLL', 'TAX', 'DISCOUNT', 'ROUNDING'] as const;
    const view = fareView(
      tr,
      quoteOption({ tollPolicy: 'NOT_APPLICABLE', components: kinds.map((kind) => ({ kind, amount: { currency: 'PKR', minor: '100' } })) }),
      SERVER_NOW,
    );
    expect(new Set(view.rows.map((r) => r.label)).size).toBe(kinds.length);
    expect(view.rows.every((r) => r.amount === 'Rs 1')).toBe(true);
    expect(fareView(tr, quoteOption({ status: 'EXPIRED' }), SERVER_NOW).expired).toBe(true);
  });
});
