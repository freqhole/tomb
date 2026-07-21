//! `Caller` - the authenticated (or anonymous) party making a request.
//!
//! generalizes grimoire's real `Caller` (read-only research against
//! `grimoire/src/offal/caller.rs`: `{ user_id, username, role }` with
//! `is_admin`/`is_member` gates over `UserRole::{Root,Admin,Member,Viewer}`)
//! to work without a user account at all - a bare node id that resolved to
//! no `Identity` row is still a valid caller (an anonymous single-device
//! identity), just one whose `identity_id` is `None` and whose `role` a
//! transport typically resolves to `Role::Viewer` for public endpoints.

use uuid::Uuid;

use crate::stores::grant_store::Role;

/// the caller making a request: which identity (if any) resolved from
/// `node_id`, the node id itself (always present - haruspex always knows
/// which device is talking to it), and the role a transport already
/// resolved for this request (typically via `AclEvaluator::effective_role`
/// against the relevant resource before constructing this `Caller`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Caller {
    pub identity_id: Option<Uuid>,
    pub node_id: String,
    pub role: Role,
}

impl Caller {
    pub fn new(node_id: impl Into<String>, role: Role) -> Self {
        Self {
            identity_id: None,
            node_id: node_id.into(),
            role,
        }
    }

    pub fn with_identity(mut self, identity_id: Uuid) -> Self {
        self.identity_id = Some(identity_id);
        self
    }

    /// true iff this caller's role is at least `required` in the
    /// root > admin > member > viewer hierarchy.
    pub fn has_privilege(&self, required: Role) -> bool {
        self.role >= required
    }

    pub fn is_admin(&self) -> bool {
        self.role >= Role::Admin
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn has_privilege_follows_the_role_hierarchy() {
        let root = Caller::new("node-a", Role::Root);
        let admin = Caller::new("node-b", Role::Admin);
        let member = Caller::new("node-c", Role::Member);
        let viewer = Caller::new("node-d", Role::Viewer);

        for caller in [&root, &admin, &member, &viewer] {
            assert!(caller.has_privilege(Role::Viewer));
        }
        for caller in [&root, &admin, &member] {
            assert!(caller.has_privilege(Role::Member));
        }
        assert!(!viewer.has_privilege(Role::Member));

        for caller in [&root, &admin] {
            assert!(caller.has_privilege(Role::Admin));
        }
        assert!(!member.has_privilege(Role::Admin));
        assert!(!viewer.has_privilege(Role::Admin));

        assert!(root.has_privilege(Role::Root));
        assert!(!admin.has_privilege(Role::Root));
    }

    #[test]
    fn is_admin_is_true_for_admin_and_root_only() {
        assert!(Caller::new("node-a", Role::Root).is_admin());
        assert!(Caller::new("node-b", Role::Admin).is_admin());
        assert!(!Caller::new("node-c", Role::Member).is_admin());
        assert!(!Caller::new("node-d", Role::Viewer).is_admin());
    }

    #[test]
    fn with_identity_sets_identity_id_and_new_leaves_it_none() {
        let anonymous = Caller::new("node-a", Role::Viewer);
        assert_eq!(anonymous.identity_id, None);

        let id = Uuid::new_v4();
        let identified = Caller::new("node-a", Role::Member).with_identity(id);
        assert_eq!(identified.identity_id, Some(id));
    }
}
