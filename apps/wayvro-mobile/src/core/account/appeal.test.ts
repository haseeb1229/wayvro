import { describe, expect, it } from 'vitest';
import { buildAppeal } from './appeal';

const DECISION = '0190c000-0000-7000-8000-000000000001';
const RESTRICTION = '0190c000-0000-7000-8000-000000000002';

describe('appeal statements (K05, V13)', () => {
  it('needs 10 to 2000 characters after trimming, for a decision or a restriction', () => {
    expect(buildAppeal({ reviewDecisionId: DECISION }, '  too short ')).toEqual({ ok: false });
    expect(buildAppeal({ reviewDecisionId: DECISION }, 'x'.repeat(2001))).toEqual({ ok: false });
    expect(buildAppeal({ reviewDecisionId: DECISION }, ' The photos were clear; please look again. ')).toEqual({
      ok: true,
      request: { reviewDecisionId: DECISION, statement: 'The photos were clear; please look again.' },
    });
    expect(buildAppeal({ restrictionId: RESTRICTION }, 'Please review this restriction.')).toEqual({
      ok: true,
      request: { restrictionId: RESTRICTION, statement: 'Please review this restriction.' },
    });
  });
});
