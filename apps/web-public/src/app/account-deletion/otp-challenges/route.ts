import { forwardPublicDeletion } from '../../../deletion/forward';

export const dynamic = 'force-dynamic';

/** Web deletion path, step 1: request a code (forwarded to POST /v1/public/account-deletion-otp-challenges). */
export function POST(request: Request): Promise<Response> {
  return forwardPublicDeletion(request, 'createWebDeletionOtp');
}
