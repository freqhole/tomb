// role-hierarchy privilege checks + a generic route-auth-style access rule
// evaluator, parameterized over an injected RoleHierarchy rather than any
// one app's fixed role enum. a route-auth binding over a specific app's
// codegen'd auth metadata (e.g. tomb's `RouteAuth`/`routes` types) stays
// app-side; this subpath only owns the privilege-comparison logic itself.

import type { RoleHierarchy } from "./role-table.js";

/**
 * does `actualRole` have at least the privilege of `requiredRole`? lower
 * hierarchy numbers are more privileged, so this holds when `actualRole`'s
 * level is less than or equal to `requiredRole`'s.
 */
export function hasAtLeastRole<TRole extends string>(
  hierarchy: RoleHierarchy<TRole>,
  actualRole: TRole,
  requiredRole: TRole,
): boolean {
  return hierarchy[actualRole] <= hierarchy[requiredRole];
}

/** is `userId` strictly the resource's owner? */
export function isOwner(userId: string, ownerId: string | null): boolean {
  return ownerId !== null && userId === ownerId;
}

/**
 * is `userId` the resource's owner, or does `actualRole` have at least
 * `requiredRole`'s privilege? owner always passes regardless of role.
 */
export function canAccessOwnerOr<TRole extends string>(
  hierarchy: RoleHierarchy<TRole>,
  userId: string,
  ownerId: string | null,
  actualRole: TRole,
  requiredRole: TRole,
): boolean {
  if (isOwner(userId, ownerId)) return true;
  return hasAtLeastRole(hierarchy, actualRole, requiredRole);
}

/**
 * a route-auth-shaped access rule: public (always allowed), authenticated
 * (any signed-in caller), role (a minimum role), owner (strictly the
 * resource's owner), or owner_or (owner, or a minimum role).
 */
export type AccessRule<TRole extends string> =
  | { type: "public" }
  | { type: "authenticated" }
  | { type: "role"; role: TRole }
  | { type: "owner" }
  | { type: "owner_or"; role: TRole };

/** the caller context an `AccessRule` is evaluated against. */
export interface AccessContext<TRole extends string> {
  userRole: TRole | null;
  userId: string | null;
  ownerId: string | null;
}

/** evaluate any `AccessRule` against a caller context. */
export function canAccess<TRole extends string>(
  hierarchy: RoleHierarchy<TRole>,
  rule: AccessRule<TRole>,
  ctx: AccessContext<TRole>,
): boolean {
  switch (rule.type) {
    case "public":
      return true;
    case "authenticated":
      return ctx.userRole !== null;
    case "role":
      return ctx.userRole !== null && hasAtLeastRole(hierarchy, ctx.userRole, rule.role);
    case "owner":
      return ctx.userId !== null && isOwner(ctx.userId, ctx.ownerId);
    case "owner_or":
      return (
        ctx.userId !== null &&
        ctx.userRole !== null &&
        canAccessOwnerOr(hierarchy, ctx.userId, ctx.ownerId, ctx.userRole, rule.role)
      );
  }
}

/** the bundle of role-hierarchy-bound checks `bindRoleHierarchy` produces. */
export interface RoleChecks<TRole extends string> {
  hasAtLeastRole: (actualRole: TRole, requiredRole: TRole) => boolean;
  canAccessOwnerOr: (
    userId: string,
    ownerId: string | null,
    actualRole: TRole,
    requiredRole: TRole,
  ) => boolean;
  isOwner: (userId: string, ownerId: string | null) => boolean;
  canAccess: (rule: AccessRule<TRole>, ctx: AccessContext<TRole>) => boolean;
}

/**
 * bind a role hierarchy once and get back plain functions that no longer
 * need it threaded through every call - convenient for a caller that only
 * ever checks against one hierarchy for its whole lifetime.
 */
export function bindRoleHierarchy<TRole extends string>(
  hierarchy: RoleHierarchy<TRole>,
): RoleChecks<TRole> {
  return {
    hasAtLeastRole: (actualRole, requiredRole) => hasAtLeastRole(hierarchy, actualRole, requiredRole),
    canAccessOwnerOr: (userId, ownerId, actualRole, requiredRole) =>
      canAccessOwnerOr(hierarchy, userId, ownerId, actualRole, requiredRole),
    isOwner,
    canAccess: (rule, ctx) => canAccess(hierarchy, rule, ctx),
  };
}
