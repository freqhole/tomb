//! acl-roles: groups + memberships + role grants, with a group revocation
//! cutting access and `on_access_changed` firing - the acl-evaluator seed
//!
//! run with: `cargo run --example acl-roles --features test-utils`

use haruspex::acl::access_changed::{AccessChangeHub, AccessChangeSubject};
use haruspex::stores::grant_store::Role;
use haruspex::testing::evaluator_fixture;
use tokio_util::sync::CancellationToken;

#[tokio::main]
async fn main() {
    let fx = evaluator_fixture().await;
    let now = 1_700_000_001; // one second after the fixture's seeded_at

    // admin holds Role::Admin on the singleton instance resource.
    let admin_role = fx
        .evaluator
        .effective_role(
            fx.admin.id,
            &haruspex::stores::grant_store::Resource::instance(),
            &[],
            now,
            None,
        )
        .await
        .expect("evaluate admin role");
    println!("admin's effective role on the instance: {admin_role:?}");
    assert_eq!(admin_role, Some(Role::Admin));

    // member is a live member of editors_group, which holds Role::Member on
    // shared_doc - so member's effective role there comes from the group
    // grant, not a direct grant.
    let member_role = fx
        .evaluator
        .effective_role(fx.member.id, &fx.shared_doc, &[], now, None)
        .await
        .expect("evaluate member role");
    println!("member's effective role on the shared doc (via group grant): {member_role:?}");
    assert_eq!(member_role, Some(Role::Member));

    // outsider has no grants and is in no group - the baseline "no access"
    // case the evaluator defaults to.
    let outsider_role = fx
        .evaluator
        .effective_role(fx.outsider.id, &fx.shared_doc, &[], now, None)
        .await
        .expect("evaluate outsider role");
    println!("outsider's effective role on the shared doc: {outsider_role:?}");
    assert_eq!(outsider_role, None);

    // a live connection for `member` registers a cancellation token with
    // the access-change hub when it authenticates - the pattern any
    // transport wraps around a resolved identity.
    let hub = AccessChangeHub::new();
    let member_connection = CancellationToken::new();
    hub.register(
        AccessChangeSubject::Identity(fx.member.id),
        member_connection.clone(),
    )
    .await;
    println!("member's live connection registered a cancellation token");

    // revoke member's membership in editors_group - per access_changed's
    // module docs, group-level fan-out to member identities is the
    // caller's job (this hub has no GroupStore handle), so we look the
    // member up ourselves before firing the hook.
    fx.groups
        .remove_member(fx.editors_group.id, fx.member.id)
        .await
        .expect("revoke group membership");
    let cancelled = hub
        .on_access_changed(AccessChangeSubject::Identity(fx.member.id))
        .await;
    println!("revoked member's editors_group membership; cancelled {cancelled} live token(s)");
    assert_eq!(cancelled, 1);
    assert!(member_connection.is_cancelled());

    // re-evaluate: member no longer has access to the shared doc at all.
    let member_role_after_revocation = fx
        .evaluator
        .effective_role(fx.member.id, &fx.shared_doc, &[], now, None)
        .await
        .expect("re-evaluate member role");
    println!(
        "member's effective role on the shared doc after revocation: {member_role_after_revocation:?}"
    );
    assert_eq!(member_role_after_revocation, None);

    println!("acl-roles complete: group grant worked, revocation cut access immediately, on_access_changed fired");
}
