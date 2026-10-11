import { describe, expect, it } from 'vitest';
import { ACCOUNT_HINT_CHANNEL, parseAccountHint } from './hints.js';

describe('account-state hint channel', () => {
  it('accepts only well-formed hints (ids and an event type, nothing else)', () => {
    const hint = { accountId: '0198c5a2-1111-7000-8000-000000000001', cause: 'driver.application.decided.v1', eventId: '0198c5a2-1111-7000-8000-000000000002' };
    expect(ACCOUNT_HINT_CHANNEL).toBe('wayvro:account-state:v1');
    expect(parseAccountHint(JSON.stringify(hint))).toEqual(hint);
    expect(parseAccountHint(JSON.stringify({ ...hint, phone: '+923000000000' }))).toBeNull();
    expect(parseAccountHint(JSON.stringify({ ...hint, cause: 'DROP TABLE' }))).toBeNull();
    expect(parseAccountHint('not json')).toBeNull();
  });
});
