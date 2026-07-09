export type { FreqholeRole, RoleHierarchy } from "./role-table.js";
export { FREQHOLE_ROLE_HIERARCHY } from "./role-table.js";

export type { AccessContext, AccessRule, RoleChecks } from "./access.js";
export {
  bindRoleHierarchy,
  canAccess,
  canAccessOwnerOr,
  hasAtLeastRole,
  isOwner,
} from "./access.js";
