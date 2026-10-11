/**
 * Expiry monitoring roster (D03/R02–R06/W07; staff matrix `compliance.expiry_roster.view`): documents of verified
 * drivers that expire within N days or have expired. Paginated, city-scoped, masked (number last 4 only), in-app only —
 * there is no download or export route (SEC-EXPORT).
 */
import { WayvroError } from '@wayvro/observability';
import type pg from 'pg';
import { citiesFor, type StaffPrincipal } from '../staff/staff-session.js';

export class MonitoringService {
  constructor(private readonly db: pg.Pool) {}

  async expiryRoster(staff: StaffPrincipal, query: { withinDays?: number | undefined; cursor?: string | undefined; limit?: number | undefined }) {
    const cities = citiesFor(staff, 'compliance.expiry_roster.view');
    const limit = query.limit ?? 20;
    let after: { expiresOn: string; id: string } | null = null;
    if (query.cursor !== undefined) {
      const [expiresOn, id] = Buffer.from(query.cursor, 'base64url').toString('utf8').split('|');
      if (!expiresOn || !id || !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn) || !/^[0-9a-f-]{36}$/.test(id)) throw new WayvroError('WAYVRO_E_VALIDATION');
      after = { expiresOn, id };
    }
    const r = await this.db.query<{
      id: string;
      document_type_code: string;
      profile_id: string;
      city_code: string;
      status: string;
      expires_on: string;
      number_last4: string | null;
    }>(
      `select d.id, d.document_type_code, p.id profile_id, a.city_code, d.status, to_char(d.expires_on, 'YYYY-MM-DD') expires_on, d.number_last4
         from compliance.compliance_documents d
         join compliance.driver_applications a on a.id = d.driver_application_id
         join compliance.driver_profiles p on p.application_id = a.id
        where d.status in ('VALID', 'EXPIRED') and d.expires_on is not null
          and d.expires_on <= current_date + ($1::int * interval '1 day')
          and ($2::text[] is null or a.city_code = any($2::text[]))
          and ($3::date is null or (d.expires_on, d.id) > ($3::date, $4::uuid))
        order by d.expires_on, d.id
        limit $5`,
      [query.withinDays ?? 30, cities === null ? null : [...cities], after?.expiresOn ?? null, after?.id ?? null, limit + 1],
    );
    const rows = r.rows.slice(0, limit);
    const last = rows.at(-1);
    return {
      items: rows.map((d) => ({
        documentId: d.id,
        documentType: d.document_type_code,
        driverProfileId: d.profile_id,
        cityCode: d.city_code,
        status: d.status,
        expiresOn: d.expires_on,
        numberLast4: d.number_last4,
      })),
      nextCursor: r.rows.length > limit && last ? Buffer.from(`${last.expires_on}|${last.id}`).toString('base64url') : null,
    };
  }
}
