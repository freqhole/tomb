# haruspex supabase prototype (reference only)

this documents the abandoned supabase-based prototype that used to live at `tomb/haruspex/`,
deleted in [xl-refactor phase 0](xl-refactor/PHASE_0_GROUNDWORK.md) (2026-07-06). it was never
wired into the app - no server or client code referenced it. the schema is preserved here
because the group-scoped peer discovery idea is worth remembering when designing haruspex (the
new rust/ts library repo, unrelated name collision aside).

## schema

- `profiles` - extends `auth.users` (supabase auth) with `display_name`, `avatar_url`.
- `groups` - named peer-discovery groups, each with a unique `invite_code` (random hex).
- `group_members` - membership join table; `group_role` enum is `owner | admin | member`.
- `peers` - online freqhole instances: `user_id` + `group_id` + `node_id` (iroh node id) +
  optional `relay_url` + `instance_name` + `last_seen` heartbeat. deliberately no ip addresses -
  iroh only needs the node id (+ optional relay hint) to dial.
- storage buckets: `avatars` (per-user folder, owner-writable/public-readable),
  `group-images` (any authenticated member can upload, public read).

## rpcs

- `join_group_by_invite(code text) -> uuid` - looks up a group by invite code, inserts a
  `group_members` row for the caller, returns the group id.
- `update_peer_presence(node_id, group_id, relay_url?, instance_name?) -> uuid` - upserts a
  `peers` row (heartbeat), keyed on `(user_id, group_id, node_id)`.
- `get_online_peers(stale_minutes = 5) -> table(...)` - lists peers in the caller's groups
  seen within the last N minutes, joined with profile + group info.
- `get_user_by_node_id(node_id text) -> table(...)` - resolves a node id to its owning user,
  but only if that user shares a group with the caller. used for on-the-fly user creation
  when an unknown peer connects over p2p.
- `get_user_group_ids()` - `security definer` helper so the `group_members` RLS policy can
  check group membership without recursing into itself.

## rls approach

every table has RLS enabled. the general shape: rows are visible to members of the same
group (`group_id in (select group_id from group_members where user_id = auth.uid())`), writes
are scoped to the row's own owner (`user_id = auth.uid()`), and elevated group operations
(update/delete on `groups`) require `owner`/`admin` role in `group_members`. a
`security definer` function (`get_user_group_ids`) sidesteps postgres RLS self-recursion on
the `group_members` policy itself.

## what's worth keeping for haruspex

the **group-scoped peer discovery** shape - peers register presence per-group, and lookups
(`get_online_peers`, `get_user_by_node_id`) are always filtered through shared group
membership rather than a global peer directory - lines up with haruspex's friendz/knock model
(subjects + role grants + live group membership, see
[PHASE_4_HARUSPEX_RUST.md](xl-refactor/PHASE_4_HARUSPEX_RUST.md)). the centralized-supabase
transport is not: haruspex's north star is peer-to-peer/federated, not a hosted coordination
service.

the `haruspex_user_id` column left on `user_accountz` (grimoire) is unrelated leftover
plumbing from this prototype; its fate is a phase 6 decision, not touched here.
