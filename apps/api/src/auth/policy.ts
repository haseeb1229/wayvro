/**
 * Server-authoritative, default-deny route authorization (docs/phase2/PHASE2_AUTH_SESSION_DESIGN.md §9; V02/V07).
 *
 * - Every route handler must declare a policy: `@Public()` (health and public auth routes only) or
 *   `@ConsumerSession()`. `assertRoutePolicies` runs at boot and refuses to start the API if any route lacks one; the
 *   guard additionally denies at request time (defence in depth).
 * - The principal comes only from the server-side session row resolved from the bearer access token. Client-supplied
 *   ids, roles, modes, KYC states or preferences are never read for authorization.
 * - Staff routes (`/v1/admin/*`) use the separate staff realm: `@StaffSession({ permission, stepUp })`. The permission
 *   comes from code-defined roles (staff/roles.ts) of ACTIVE assignments read per request; step-up freshness is checked
 *   on database time. Every authenticated denial is audited (STAFF actor, outcome DENIED, reason code).
 */
import { SetMetadata, type CanActivate, type ExecutionContext, type Type } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { bearerToken, verifyAccessToken, type VerifiedSession } from '@wayvro/identity-core';
import { WayvroError } from '@wayvro/observability';
import { appendAudit, type Queryable } from '@wayvro/server-runtime';
import type { FastifyRequest } from 'fastify';
import { accountRestrictionsInForce } from '../compliance/restrictions.js';
import type { StaffPermission } from '../staff/roles.js';
import { resolveStaffPrincipal, stepUpFresh, type StaffPrincipal, type StaffSessionPolicy } from '../staff/staff-session.js';

export interface StaffRoutePolicy {
  readonly kind: 'staff-session';
  /** Required permission; absent = any ACTIVE staff session (e.g. own profile, logout, step-up). */
  readonly permission?: StaffPermission;
  /** Requires a WebAuthn assertion within STAFF_STEP_UP_SECONDS (privileged actions, H08). */
  readonly stepUp: boolean;
  /** Reachable while the session is idle-LOCKED (unlock, logout, own state). */
  readonly allowLocked: boolean;
}

/**
 * `restrictedOk`: reachable while an ACCOUNT-scope restriction is in force (V13 "restricted session": own state,
 * sessions/security, policies, appeals, data/deletion, sign-out). Every other consumer route answers 403
 * ACCOUNT_RESTRICTED with the reason codes.
 */
export type RoutePolicy = { readonly kind: 'public' } | { readonly kind: 'consumer-session'; readonly restrictedOk: boolean } | StaffRoutePolicy;

const ROUTE_POLICY = 'wayvro:route-policy';
// Nest's handler metadata key for HTTP routes (`@Get`/`@Post`/… set it on the handler function).
const NEST_PATH_METADATA = 'path';

export const Public = (): MethodDecorator => SetMetadata(ROUTE_POLICY, { kind: 'public' } satisfies RoutePolicy);
export const ConsumerSession = (options: { restrictedOk?: boolean } = {}): MethodDecorator =>
  SetMetadata(ROUTE_POLICY, { kind: 'consumer-session', restrictedOk: options.restrictedOk ?? false } satisfies RoutePolicy);
export const StaffSession = (options: { permission?: StaffPermission; stepUp?: boolean; allowLocked?: boolean } = {}): MethodDecorator =>
  SetMetadata(ROUTE_POLICY, {
    kind: 'staff-session',
    ...(options.permission ? { permission: options.permission } : {}),
    stepUp: options.stepUp ?? false,
    allowLocked: options.allowLocked ?? false,
  } satisfies RoutePolicy);

/** The policy declared on a handler (route inventory / AUTHZ-MATRIX tests). @internal */
export function routePolicyOf(handler: unknown): RoutePolicy | undefined {
  return typeof handler === 'function' ? (Reflect.getMetadata(ROUTE_POLICY, handler) as RoutePolicy | undefined) : undefined;
}

/** The authenticated principal: resolved from the session row, never from the request body or headers. */
export type Principal = VerifiedSession;

export interface AuthenticatedRequest extends FastifyRequest {
  principal?: Principal;
  staff?: StaffPrincipal;
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

  constructor(
    private readonly db: Queryable,
    private readonly staffPolicy: StaffSessionPolicy,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const policy = this.reflector.get<RoutePolicy | undefined>(ROUTE_POLICY, context.getHandler());
    if (!policy) throw new WayvroError('WAYVRO_E_FORBIDDEN');
    if (policy.kind === 'public') return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (policy.kind === 'staff-session') {
      request.staff = await this.authorizeStaff(request, policy);
      return true;
    }
    const token = bearerToken(request.headers.authorization);
    const session = token ? await verifyAccessToken(this.db, token) : null;
    if (!session) throw new WayvroError('WAYVRO_E_UNAUTHENTICATED');
    // Coarse "last used" for the session list (at most one write per session every 5 minutes).
    await this.db.query(`update identity.sessions set last_used_at = now() where id = $1 and last_used_at < now() - interval '5 minutes'`, [session.sessionId]);
    if (!policy.restrictedOk) {
      const restrictions = await accountRestrictionsInForce(this.db, session.accountId, new Date());
      if (restrictions.length > 0) throw new WayvroError('WAYVRO_E_ACCOUNT_RESTRICTED', { details: { reasonCodes: restrictions.map((r) => r.reasonCode) } });
    }
    request.principal = session;
    return true;
  }

  private async authorizeStaff(request: AuthenticatedRequest, policy: StaffRoutePolicy): Promise<StaffPrincipal> {
    const staff = await resolveStaffPrincipal(this.db, bearerToken(request.headers.authorization), this.staffPolicy, policy.allowLocked);
    if (policy.permission !== undefined && !staff.permissions.has(policy.permission)) {
      await denyStaff(this.db, staff, `MISSING_${policy.permission.toUpperCase().replaceAll('.', '_')}`);
      throw new WayvroError('WAYVRO_E_FORBIDDEN');
    }
    if (policy.stepUp && !(await stepUpFresh(this.db, staff, this.staffPolicy))) {
      await denyStaff(this.db, staff, 'STEP_UP_STALE');
      throw new WayvroError('WAYVRO_E_STEP_UP_REQUIRED');
    }
    // H08: every permissioned action taken while a break-glass grant is active is tagged in the audit log.
    if (staff.breakGlassId !== null && policy.permission !== undefined) {
      await appendAudit(this.db, {
        actor: { type: 'STAFF', id: staff.staffId },
        action: 'BREAK_GLASS_ACTION',
        objectType: 'staff.break_glass_grant',
        objectId: staff.breakGlassId,
        outcome: 'SUCCESS',
        reasonCode: policy.permission.toUpperCase().replaceAll('.', '_'),
      });
    }
    return staff;
  }
}

/** The staff principal set by the guard for a staff route. */
export function staffOf(request: AuthenticatedRequest): StaffPrincipal {
  if (!request.staff) throw new WayvroError('WAYVRO_E_UNAUTHENTICATED');
  return request.staff;
}

/** Staff realm: session (realm-separated token kind), permission of an ACTIVE assignment, step-up freshness. */
async function denyStaff(db: Queryable, staff: StaffPrincipal, reasonCode: string): Promise<void> {
  await appendAudit(db, {
    actor: { type: 'STAFF', id: staff.staffId },
    action: 'STAFF_ACCESS_DENIED',
    objectType: 'staff.session',
    objectId: staff.sessionId,
    outcome: 'DENIED',
    reasonCode,
  });
}

/** The principal set by the guard; a handler with a consumer policy can rely on it. */
export function principalOf(request: AuthenticatedRequest): Principal {
  if (!request.principal) throw new WayvroError('WAYVRO_E_UNAUTHENTICATED');
  return request.principal;
}
