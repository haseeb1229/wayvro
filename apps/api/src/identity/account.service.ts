/**
 * Account state and profile (K01/A05 display name + locale/V02/V07). Every query is scoped to the principal's account
 * id from the server-side session; no client-supplied id, role or mode is ever read. The rider profile is a distinct
 * profile row (V02): driver data does not exist in P2.1 and is never exposed through rider routes.
 */
import type { AccountState, ProfileUpdateRequest, SecurityEventList } from '@wayvro/contracts';
import { appendAudit } from '@wayvro/server-runtime';
import type pg from 'pg';
import type { Principal } from '../auth/policy.js';
import type { ApiConfig } from '../config.js';
import { success, type IdempotencyStore, type IdempotentResult } from '../platform/idempotency.js';
import { securityEvent } from './session.service.js';

export class AccountService {
  constructor(
    private readonly db: pg.Pool,
    private readonly idempotency: IdempotencyStore,
    private readonly policy: ApiConfig,
  ) {}

  async state(principal: Principal): Promise<AccountState> {
    const r = await this.db.query<{
      id: string;
      display_name: string | null;
      preferred_locale: 'en' | 'ur' | 'ur-Latn';
      created_at: Date;
      rider_profile_id: string;
    }>(
      `select a.id, a.display_name, a.preferred_locale, a.created_at, rp.id rider_profile_id
         from identity.accounts a join profile.rider_profiles rp on rp.account_id = a.id
        where a.id = $1 and a.status = 'ACTIVE'`,
      [principal.accountId],
    );
    const row = r.rows[0];
    if (!row) throw new Error('authenticated account has no active state row');
    return {
      account: { id: row.id, status: 'ACTIVE', displayName: row.display_name, preferredLocale: row.preferred_locale, createdAt: row.created_at.toISOString() },
      session: { id: principal.sessionId, assurance: 'OTP', accessTokenExpiresAt: principal.accessExpiresAt.toISOString() },
      riderProfile: { id: row.rider_profile_id, status: 'ACTIVE' },
      requiredActions: [],
    };
  }

  async updateProfile(principal: Principal, input: ProfileUpdateRequest, idempotencyKey: string): Promise<IdempotentResult> {
    return this.idempotency.execute(
      {
        scope: `acct:${principal.accountId}`,
        operation: 'account-profile.update',
        key: idempotencyKey,
        payload: input,
        ttlSeconds: this.policy.IDEMPOTENCY_TTL_SECONDS,
      },
      async (tx) => {
        const r = await tx.query<{ display_name: string | null; preferred_locale: 'en' | 'ur' | 'ur-Latn' }>(
          `update identity.accounts
              set display_name = case when $2::boolean then $3 else display_name end,
                  preferred_locale = coalesce($4, preferred_locale),
                  version = version + 1
            where id = $1 and status = 'ACTIVE'
            returning display_name, preferred_locale`,
          [principal.accountId, input.displayName !== undefined, input.displayName ?? null, input.preferredLocale ?? null],
        );
        const row = r.rows[0];
        if (!row) throw new Error('authenticated account has no active state row');
        await securityEvent(tx, principal.accountId, 'PROFILE_UPDATED', principal.sessionId);
        await appendAudit(tx, {
          actor: { type: 'ACCOUNT', id: principal.accountId },
          action: 'PROFILE_UPDATED',
          objectType: 'identity.account',
          objectId: principal.accountId,
          outcome: 'SUCCESS',
        });
        return success(200, { displayName: row.display_name, preferredLocale: row.preferred_locale });
      },
    );
  }

  async securityEvents(principal: Principal): Promise<SecurityEventList> {
    const r = await this.db.query<{ id: string; type: SecurityEventList['events'][number]['type']; created_at: Date }>(
      `select id, type, created_at from identity.security_events where account_id = $1 order by created_at desc, id desc limit 50`,
      [principal.accountId],
    );
    return { events: r.rows.map((e) => ({ id: e.id, type: e.type, occurredAt: e.created_at.toISOString() })) };
  }
}
