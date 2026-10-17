/**
 * QUOTE-TAMPER (P3.3; T3-03/T3-04/T3-16; test strategy §4.6 QT-01, QT-05, QT-13): a client can never supply or influence
 * a price — unknown or server-owned fields anywhere in the body are a 400 and never read; amounts are never accepted as
 * input; app-build headers never change pricing; quote ids give no existence oracle. Synthetic data only.
 */
import { randomUUID } from 'node:crypto';
import { QuoteGroupSchema } from '@wayvro/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GeoHarness } from './geo-helpers.js';
import { S, errorOf, getQuote, postQuote, quoteBody, quoteRows, startQuoteApi } from './pricing-helpers.js';
import { signIn, type SignedIn } from './support.js';

let g: GeoHarness & { zoneSetId: string };
let rider: SignedIn;

beforeAll(async () => {
  g = await startQuoteApi({ env: { QUOTES_PER_MINUTE_ACCOUNT: '10000', QUOTES_PER_DAY_ACCOUNT: '100000' } });
  rider = await signIn(g.h);
}, 120_000);
afterAll(async () => {
  await g.h.close();
});

describe('QT-01: client-supplied price data is rejected, never read', () => {
  const tampered: ReadonlyArray<readonly [string, unknown]> = [
    ['fare', { ...quoteBody(), fare: 1 }],
    ['total', { ...quoteBody(), total: { currency: 'PKR', minor: '1' } }],
    ['distanceM', { ...quoteBody(), distanceM: 1 }],
    ['durationS', { ...quoteBody(), durationS: 1 }],
    ['components', { ...quoteBody(), components: [{ kind: 'BASE', amount: { currency: 'PKR', minor: '0' } }] }],
    ['rateCardId', { ...quoteBody(), rateCardId: randomUUID() }],
    ['zoneSetId', { ...quoteBody(), zoneSetId: randomUUID() }],
    ['expiresAt', { ...quoteBody(), expiresAt: new Date(Date.now() + 86_400_000).toISOString() }],
    ['nested fare in pickup', quoteBody({ ...S.points.inside, fare: 1 } as never)],
    ['pickupPointId in pickup', quoteBody({ ...S.points.inside, pickupPointId: randomUUID() } as never)],
    ['coordinates as strings', quoteBody({ lat: '31.52', lng: '74.35' } as never)],
    ['latitude out of range', quoteBody({ lat: 91, lng: 74.35 })],
    ['lowercase city', { ...quoteBody(), cityCode: 'lhr' }],
    ['empty products', { ...quoteBody(), products: [] }],
  ];
  it.each(tampered)('%s ⇒ 400 WAYVRO_E_VALIDATION, no provider call, nothing written', async (_label, body) => {
    const before = { rows: await quoteRows(g.h), route: g.doubles.control.calls('ROUTE') };
    const res = await postQuote(g.h, rider.accessToken, body);
    expect(res.statusCode).toBe(400);
    expect(errorOf(res)?.code).toBe('WAYVRO_E_VALIDATION');
    expect(g.doubles.control.calls('ROUTE')).toBe(before.route);
    expect(await quoteRows(g.h)).toEqual(before.rows);
  });

  it('the rejection is counted as a signal without logging the body', () => {
    expect(g.h.logs.text()).toContain('QUOTE_SCHEMA_REJECTED');
    expect(g.h.logs.text()).not.toContain('"fare"');
  });
});

describe('QT-13 / T3-16: headers and filters never change the price', () => {
  it('spoofed app build/version/platform headers and the products filter leave every amount unchanged', async () => {
    const plain = QuoteGroupSchema.parse((await postQuote(g.h, rider.accessToken, quoteBody())).json());
    const spoofed = await postQuote(g.h, rider.accessToken, quoteBody(), {
      headers: { 'x-wayvro-app-build': '999999', 'x-wayvro-app-version': '99.0.0', 'x-wayvro-platform': 'IOS', 'x-wayvro-mode': 'driver' },
    });
    expect(spoofed.statusCode, spoofed.body).toBe(201);
    const q = QuoteGroupSchema.parse(spoofed.json());
    expect(q.options.map((o) => [o.productCode, o.total, o.components])).toEqual(plain.options.map((o) => [o.productCode, o.total, o.components]));
    // asking for a product that is not ENABLED (COMFORT is CONFIGURED in this harness) never prices it
    const filtered = QuoteGroupSchema.parse(
      (await postQuote(g.h, rider.accessToken, quoteBody(S.points.inside, S.points.insideOther, { products: ['ECONOMY', 'COMFORT'] }))).json(),
    );
    expect(filtered.options.map((o) => [o.productCode, o.total])).toEqual(plain.options.map((o) => [o.productCode, o.total]));
    expect(filtered.unavailable).toEqual([{ productCode: 'COMFORT', reasonCode: 'ZONE_NOT_SERVED', nextOpenAt: null }]);
    const onlyDisabled = await postQuote(g.h, rider.accessToken, quoteBody(S.points.inside, S.points.insideOther, { products: ['COMFORT'] }));
    expect(errorOf(onlyDisabled)).toMatchObject({ code: 'WAYVRO_E_SERVICE_AREA', details: { reasonCodes: ['ZONE_NOT_SERVED'] } });
  });
});

describe('QT-05 / T3-04: no existence oracle on quote ids', () => {
  it('foreign, random and malformed ids answer the same 404 body shape; the response names no account', async () => {
    const q = QuoteGroupSchema.parse((await postQuote(g.h, rider.accessToken, quoteBody())).json());
    expect(JSON.stringify(q)).not.toMatch(/accountId|account_id/);
    const other = await signIn(g.h);
    const shapes = await Promise.all(
      [q.quoteGroupId, randomUUID(), q.options[0]?.quoteId ?? randomUUID()].map(async (id) => {
        const res = await getQuote(g.h, other.accessToken, id);
        return { status: res.statusCode, code: errorOf(res)?.code, message: res.json<{ error: { message: string } }>().error.message };
      }),
    );
    expect(new Set(shapes.map((x) => JSON.stringify(x))).size).toBe(1);
    expect(shapes[0]).toMatchObject({ status: 404, code: 'WAYVRO_E_NOT_FOUND' });
  });
});
