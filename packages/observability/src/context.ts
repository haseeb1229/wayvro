/** Request/correlation context propagated through async work with AsyncLocalStorage. */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { RequestIdSchema } from '@wayvro/contracts';

export interface RequestContext {
  readonly requestId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Accepts a caller-supplied id only if it has the contract shape; otherwise generates a new one (never trusts junk). */
export function resolveRequestId(incoming: unknown): string {
  const candidate = Array.isArray(incoming) ? (incoming[0] as unknown) : incoming;
  return RequestIdSchema.safeParse(candidate).success ? (candidate as string) : randomUUID();
}

export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function currentContext(): RequestContext | undefined {
  return storage.getStore();
}
