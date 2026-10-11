import { forwardPublicDeletion } from '../../../deletion/forward';

export const dynamic = 'force-dynamic';

/** Web deletion path, step 2: verify the code and record the request (forwarded to POST /v1/public/account-deletion-requests). */
export function POST(request: Request): Promise<Response> {
  return forwardPublicDeletion(request, 'createWebDeletionRequest');
}
