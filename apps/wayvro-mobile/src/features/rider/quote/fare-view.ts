import type { QuoteComponent, QuoteOption } from '@wayvro/contracts';
import { formatPkr } from '../../../core/i18n/money';
import type { StringKey } from '../../../core/i18n/strings';
import { countdownState } from './countdown';
import { productName, type Tr } from './quote-view';

/**
 * Fare breakdown (B04 display; UX doc §8.5). The server's components are shown EXACTLY as sent, in the server's order,
 * with the server's total last — nothing is added, summed, rounded or re-ordered on the phone. Discounts are never
 * emitted in Phase 3. A malformed amount shows "—" instead of a number.
 */
const KIND_KEY: Readonly<Record<QuoteComponent['kind'], StringKey>> = {
  BASE: 'fare.kind.BASE',
  DISTANCE: 'fare.kind.DISTANCE',
  TIME: 'fare.kind.TIME',
  BOOKING_FEE: 'fare.kind.BOOKING_FEE',
  AIRPORT_FEE: 'fare.kind.AIRPORT_FEE',
  MINIMUM_ADJUSTMENT: 'fare.kind.MINIMUM_ADJUSTMENT',
  TOLL: 'fare.kind.TOLL',
  TAX: 'fare.kind.TAX',
  DISCOUNT: 'fare.kind.DISCOUNT',
  ROUNDING: 'fare.kind.ROUNDING',
};

export interface FareView {
  readonly title: string;
  readonly rows: readonly { readonly key: string; readonly label: string; readonly amount: string }[];
  readonly total: { readonly label: string; readonly amount: string };
  readonly notes: readonly string[];
  readonly expired: boolean;
  readonly reference: string;
}

export function fareView(tr: Tr, option: QuoteOption, serverNowMs: number): FareView {
  const money = (amount: QuoteComponent['amount']): string => formatPkr(amount) ?? tr('fare.amountUnavailable');
  const rows = option.components.map((c, index) => ({
    key: `${c.kind}-${String(index)}`,
    label: tr(KIND_KEY[c.kind]),
    amount: c.kind === 'TOLL' && option.tollPolicy === 'EXCLUDED_DISCLOSED' ? tr('fare.tollNotIncluded') : money(c.amount),
  }));
  const notes: string[] = [];
  if (option.tollPolicy === 'EXCLUDED_DISCLOSED') notes.push(tr('rider.quote.tollsExcluded'));
  if (option.taxIncluded !== null) {
    const rate = (option.taxIncluded.rateBp / 100).toFixed(option.taxIncluded.rateBp % 100 === 0 ? 0 : 2);
    notes.push(tr('fare.taxIncluded', { rate, amount: money(option.taxIncluded.amount) }));
  }
  notes.push(tr('fare.serverNote'));
  return {
    title: productName(tr, option.display.nameKey, option.productCode),
    rows,
    total: { label: tr('fare.total'), amount: money(option.total) },
    notes,
    expired: option.status !== 'PRICED' || countdownState(option.expiresAt, serverNowMs).expired,
    reference: tr('fare.reference', { version: option.rateCardVersion, engine: option.pricingEngineVersion }),
  };
}
