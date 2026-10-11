/**
 * Server-side (React Server Component) view of the staff session: reads the HttpOnly cookie and asks the API for
 * `/v1/admin/me`. Pages render nothing privileged without it; the API still authorises every action.
 */
import { StaffMeSchema, type StaffMe } from '@wayvro/contracts';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, bffConfig, readSessionToken } from './proxy';

export type StaffView =
  { readonly state: 'SIGNED_OUT' } | { readonly state: 'LOCKED'; readonly me: StaffMe } | { readonly state: 'ACTIVE'; readonly me: StaffMe };

export async function currentStaff(): Promise<StaffView> {
  const jar = await cookies();
  const cookie = jar.get(SESSION_COOKIE);
  const token = readSessionToken(cookie ? `${SESSION_COOKIE}=${cookie.value}` : null);
  if (!token) return { state: 'SIGNED_OUT' };
  const res = await fetch(`${bffConfig().apiUrl}/v1/admin/me`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    cache: 'no-store',
  });
  if (res.status !== 200) return { state: 'SIGNED_OUT' };
  const me = StaffMeSchema.parse(await res.json());
  return me.session.status === 'LOCKED' ? { state: 'LOCKED', me } : { state: 'ACTIVE', me };
}
