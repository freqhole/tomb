// role hierarchy tables: a plain mapping from role name to a privilege
// level, lower number = higher privilege. every function in ./permissions
// takes one of these as an explicit argument rather than assuming any
// fixed set of role names, so an app with its own role vocabulary can use
// the same privilege-comparison logic haruspex ships by default.

/** a role hierarchy: role name -> privilege level (lower = more privileged). */
export type RoleHierarchy<TRole extends string> = Record<TRole, number>;

/** the role names haruspex's own grant model uses (see the rust `Role` enum). */
export type FreqholeRole = "root" | "admin" | "member" | "viewer";

/**
 * the default freqhole role hierarchy - root above admin above member above
 * viewer. a caller with its own role vocabulary supplies its own
 * `RoleHierarchy` instead; nothing in this subpath requires this one.
 */
export const FREQHOLE_ROLE_HIERARCHY: RoleHierarchy<FreqholeRole> = {
  root: 0,
  admin: 10,
  member: 20,
  viewer: 30,
};
