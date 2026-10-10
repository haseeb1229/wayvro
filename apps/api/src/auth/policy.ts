/**
 * Server-authoritative, default-deny route authorization (docs/phase2/PHASE2_AUTH_SESSION_DESIGN.md §9; V02/V07).
 *
 * - Every route handler must declare a policy: `@Public()` (health and public auth routes only) or
 *   `@ConsumerSession()`. `assertRoutePolicies` runs at boot and refuses to start the API if any route lacks one; the
 *   guard additionally denies at request time (defence in depth).
 * - The principal comes only from the server-side session row resolved from the bearer access token. Client-supplied
 *   ids, roles, modes, KYC states or preferences are never read for authorization.
 * - Staff RBAC/ABAC is a separate realm (P2.4) and does not exist here.
 */
import { SetMetadata, type CanActivate, type ExecutionContext, type Type } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { bearerToken, verifyAccessToken, type VerifiedSession } from '@wayvro/identity-core';
import { WayvroError } from '@wayvro/observability';
import type { Queryable } from '@wayvro/server-runtime';
import type { FastifyRequest } from 'fastify';

export type RoutePolicy = { readonly kind: 'public' } | { readonly kind: 'consumer-session' };

const ROUTE_POLICY = 'wayvro:route-policy';
// Nest's handler metadata key for HTTP routes (`@Get`/`@Post`/… set it on the handler function).
const NEST_PATH_METADATA = 'path';

export const Public = (): MethodDecorator => SetMetadata(ROUTE_POLICY, { kind: 'public' } satisfies RoutePolicy);
export const ConsumerSession = (): MethodDecorator => SetMetadata(ROUTE_POLICY, { kind: 'consumer-session' } satisfies RoutePolicy);

/** The authenticated principal: resolved from the session row, never from the request body or headers. */
export type Principal = VerifiedSession;

export interface AuthenticatedRequest extends FastifyRequest {
  principal?: Principal;
}

/**
 * Lists every route handler of the given controllers that has no policy (empty = complete).
 * @internal exported for the route-policy completeness test.
 */
export function routePolicyProblems(controllers: readonly Type[]): string[] {
  const problems: string[] = [];
  for (const controller of controllers) {
    const proto = controller.prototype as Record<string, unknown>;
    for (const name of Object.getOwnPropertyNames(proto)) {
      const handler = proto[name];
      if (name === 'constructor' || typeof handler !== 'function') continue;
      if (Reflect.getMetadata(NEST_PATH_METADATA, handler) === undefined) continue;
      const policy = Reflect.getMetadata(ROUTE_POLICY, handler) as RoutePolicy | undefined;
      if (!policy) problems.push(`${controller.name}.${name} has no route policy`);
    }
  }
  return problems;
}

export function assertRoutePolicies(controllers: readonly Type[]): void {
  const problems = routePolicyProblems(controllers);
  if (problems.length > 0) throw new Error(`default-deny: every route must declare a policy\n - ${problems.join('\n - ')}`);
}

export class PolicyGuard implements CanActivate {
  private readonly reflector = new Reflector();

  constructor(private readonly db: Queryable) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const policy = this.reflector.get<RoutePolicy | undefined>(ROUTE_POLICY, context.getHandler());
    if (!policy) throw new WayvroError('WAYVRO_E_FORBIDDEN');
    if (policy.kind === 'public') return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = bearerToken(request.headers.authorization);
    const session = token ? await verifyAccessToken(this.db, token) : null;
    if (!session) throw new WayvroError('WAYVRO_E_UNAUTHENTICATED');
    // Coarse "last used" for the session list (at most one write per session every 5 minutes).
    await this.db.query(`update identity.sessions set last_used_at = now() where id = $1 and last_used_at < now() - interval '5 minutes'`, [session.sessionId]);
    request.principal = session;
    return true;
  }
}

/** The principal set by the guard; a handler with a consumer policy can rely on it. */
export function principalOf(request: AuthenticatedRequest): Principal {
  if (!request.principal) throw new WayvroError('WAYVRO_E_UNAUTHENTICATED');
  return request.principal;
}
