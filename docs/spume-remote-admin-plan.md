# spume remote admin views — implementation plan

re-create the wizard's user/invite mgmt + federation knock/peer mgmt as a
remote-scoped admin view inside spume's existing settings module. entry
point lives on each row of `RemotesSettingsView` (only when the caller's
role on that remote is `admin`), so each remote you've connected to gets
its own admin dashboard.

## goals

- manage users (list, create, update role, delete, account-link) on a
  selected remote
- manage invite codes (list, generate, revoke, revoke-all, update-role)
- federation: list/accept/reject/delete knocks; list/remove/allow peer
  nodes; show local node id with QR code (for sharing the remote's id
  inbound)
- works in browser-spume AND charnel-spume via spume's existing P2P
  transports (`WasmTransport`, `CharnelTransport`); HTTP transport gets
  it for free as a side effect

## non-goals (this pass)

- haruspex setup wizard (creds, sync) — wizard-only for now
- P2P identity backup/restore — stays in existing
  `FederationSettingsView`
- a separate "admin target picker" — admin scope is always "this remote
  you clicked from"
- new top-level settings nav item — entry is a per-row button on the
  remotes list

## architecture decision: transport

spume's existing transports (`WasmTransport`, `CharnelTransport`,
`HttpTransport`) all speak the `freqhole/1` ALPN through offal HTTP
routes. the wizard's `admin_dispatch` ALPN (`freqhole-admin/1`) is
charnel-only and not reachable from a browser midden node today.

we already have offal HTTP routes for `/api/admin/knocks/*` (auth: role
admin) that thinly wrap `admin_dispatch::handle`. **extend the same
pattern to users, invites, and peers** so spume's existing typed client
"just works":

- new offal modules under `grimoire/src/offal/admin/`:
  `users.rs`, `invites.rs`, `peers.rs`
- each handler delegates to the existing `admin_dispatch` helpers (or to
  the underlying repository functions they already call) so business
  logic isn't duplicated
- all routes gated `auth: RouteAuth::Role(UserRole::Admin)`

after regen, the spume client gets `client.admin.users_list({...})`,
`.invites_generate({...})`, `.peers_remove({...})`, etc., with full Zod
schemas.

## backend changes

### grimoire/src/offal/admin/users.rs (new)

routes (mirror admin_dispatch commands):

| name                          | method | path                            | req                                | resp                  |
| ----------------------------- | ------ | ------------------------------- | ---------------------------------- | --------------------- |
| `users_list`                  | GET    | `/api/admin/users`              | `ListUsersQuery` (include_deleted) | `Vec<UserSummary>`    |
| `users_get`                   | GET    | `/api/admin/users/{id}`         | path                               | `UserSummary`         |
| `users_create`                | POST   | `/api/admin/users`              | `CreateUserRequest`                | `UserSummary`         |
| `users_update_role`           | POST   | `/api/admin/users/role`         | `UpdateUserRoleRequest`            | `UserSummary`         |
| `users_delete`                | POST   | `/api/admin/users/delete`       | `DeleteUserRequest`                | `EmptyResponse`       |
| `users_generate_account_link` | POST   | `/api/admin/users/account-link` | `GenerateAccountLinkRequest`       | `AccountLinkResponse` |

handlers call the same private functions inside
`admin_dispatch/mod.rs` — refactor those into `pub(crate)` or extract
into a sibling `services` module so both entry points share them.

### grimoire/src/offal/admin/invites.rs (new)

| name                  | method | path                            | req                       | resp                  |
| --------------------- | ------ | ------------------------------- | ------------------------- | --------------------- |
| `invites_list`        | GET    | `/api/admin/invites`            | `ListInvitesQuery`        | `Vec<InviteCodeView>` |
| `invites_generate`    | POST   | `/api/admin/invites`            | `GenerateInviteRequest`   | `InviteCodeView`      |
| `invites_revoke`      | POST   | `/api/admin/invites/revoke`     | `RevokeInviteRequest`     | `EmptyResponse`       |
| `invites_revoke_all`  | POST   | `/api/admin/invites/revoke-all` | `EmptyRequest`            | `RevokeAllResult`     |
| `invites_update_role` | POST   | `/api/admin/invites/role`       | `UpdateInviteRoleRequest` | `InviteCodeView`      |

### grimoire/src/offal/admin/peers.rs (new)

| name                  | method | path                              | req                 | resp                |
| --------------------- | ------ | --------------------------------- | ------------------- | ------------------- |
| `peers_list_all`      | GET    | `/api/admin/peers`                | none                | `Vec<PeerNodeInfo>` |
| `peers_list_for_user` | GET    | `/api/admin/peers/user/{user_id}` | path                | `Vec<PeerNodeInfo>` |
| `peers_allow`         | POST   | `/api/admin/peers/allow`          | `AllowPeerRequest`  | `AllowPeerResult`   |
| `peers_remove`        | POST   | `/api/admin/peers/remove`         | `RemovePeerRequest` | `EmptyResponse`     |

### grimoire/src/offal/admin/mod.rs

add `pub mod users; pub mod invites; pub mod peers;` and chain their
`ROUTES` into the module-level `all_routes()`.

### type registry

register all new request/response types in
`grimoire/src/api_registry/type_registry.rs` so `ZodSchema` derive picks
them up for codegen.

### grimoire/src/admin_dispatch/mod.rs refactor

extract the body of each `users_*`, `invites_*`, `peers_*` private fn
into `pub(crate)` helpers (or move them into
`grimoire/src/users/admin_service.rs`) so both the offal handlers and
the existing dispatch arms call the same code. zero behavior change for
existing wizard callers.

### codegen

```sh
cd client-codegen && make all
```

regenerates `client-codegen/freqhole-api-client/src/codegen/{schema,routes}.ts`
which spume already imports.

## frontend changes

### entry point: RemotesSettingsView

[client/spume/src/settings/views/RemotesSettingsView.tsx](client/spume/src/settings/views/RemotesSettingsView.tsx)

for each remote row, conditionally render an `admin` button that routes
to the new admin view. role is **already known** — the existing
`authStatus` signal in this file is a `Map<remote_id, AuthInfo>` where
`AuthInfo` includes `role` (populated by `checkAllAuthStatus` /
`checkSingleAuthStatus` via `whoami`).

rule: show the button when
`authStatus().get(remote.remote_id)?.role === "admin"`. no new fetches,
no extra cache. button is a `<A
href={`/settings/remotes/${remote.remote_id}/admin`}>` styled to match
existing row actions.

### routing

add to the spume router (wherever `/settings/*` is registered):

```
/settings/remotes/:remoteId/admin              → RemoteAdminView (tabs)
/settings/remotes/:remoteId/admin/users        → users tab (default)
/settings/remotes/:remoteId/admin/federation   → federation tab
```

`RemoteAdminView` looks up the remote by id from `getAllRemotes()`,
constructs an `ApiClient` via `getClientForRemote(remote)`, provides it
via context to its children, renders a tab nav + `<Outlet />`. shows a
breadcrumb `< back to remotes` and the remote's display name in a
header banner so users always know which remote they're operating on.

### new files

```
client/spume/src/settings/views/admin/
├── RemoteAdminView.tsx        # container w/ tabs + remote header
├── RemoteAdminContext.tsx     # exposes { remote, client } to children
├── UsersTab.tsx               # users + invites mgmt (port of charnel UsersView)
├── FederationTab.tsx          # knocks + peers + node id/qr
└── components/
    ├── QrCodeDisplay.tsx      # port from charnel/components/
    ├── QrCodeDisplay.css      # ditto
    ├── ConfirmDialog.tsx      # if not already shared (used by 2 existing settings views)
    ├── InviteCodeRow.tsx
    ├── UserRow.tsx
    ├── KnockRow.tsx
    └── PeerRow.tsx
```

### UsersTab.tsx

port logic from
[client/charnel/src/views/UsersView.tsx](client/charnel/src/views/UsersView.tsx):

- replace `useAdminTransport().dispatch(...)` calls with
  `client.admin.users_list({...})` etc. via the codegen client from
  context
- preserve all current UI: users table, invites panel, generate-invite
  form, deactivate-all confirm, copy-link/copy-code buttons,
  show-inactive toggle, role badges, account-link generation
- use spume's existing toast/icon/button components instead of charnel
  styles — match the look of the current `RemotesSettingsView`
  (`bg-[var(--color-bg-elevated)]`, `text-[var(--color-text-primary)]`,
  rounded-lg cards, etc.)
- swap the inline `formatDate` helpers for the shared
  [client/spume/src/utils/dateTime.ts](client/spume/src/utils/dateTime.ts)
  exports

### FederationTab.tsx

port the knock + peer subset of
[client/charnel/src/views/FederationView.tsx](client/charnel/src/views/FederationView.tsx)
(skip everything related to haruspex creds + sync). final UI sections:

1. **identity** — display the remote's node id (read directly from
   `remote.peer_addr` in IDB — already populated for P2P remotes), copy
   button, and `<QrCodeDisplay nodeId={remote.peer_addr} />` for sharing.
   for HTTP-only remotes with no `peer_addr`, hide this section.
2. **access requests (knocks)** — list pending + history; per-row
   accept (with role + username override form) / reject / delete; a
   "reject all pending" action
3. **allowed peers** — list of `PeerNodeInfo` rows with username, role,
   node id (truncated, copyable), last_seen; per-row remove
4. **manual allow** — form to allow an arbitrary node id for a chosen
   user (uses `UserAutocomplete` ported from charnel — small enough to
   just reimplement against `users_list` from the same client)

### QrCodeDisplay port

copy [client/charnel/src/components/QrCodeDisplay.tsx](client/charnel/src/components/QrCodeDisplay.tsx)

- its `.css` into the new admin components folder. dependency: `qrcode`
  package — add via `npm i qrcode @types/qrcode --save-dev` in
  [client/spume/package.json](client/spume/package.json) if not already
  present (verify before installing).

### settings nav

no changes to
[client/spume/src/settings/layouts/SettingsLayout.tsx](client/spume/src/settings/layouts/SettingsLayout.tsx)
nav. the admin views are accessible only via the per-row button on the
remotes page; deep links still work.

### settings module exports

extend [client/spume/src/settings/index.ts](client/spume/src/settings/index.ts)
to export `RemoteAdminView`, `UsersTab`, `FederationTab` so the spume
router can mount them without reaching into subpaths.

## auth + transport notes

- the existing `whoami` cache in `RemotesSettingsView` (the
  `authStatus` signal) is the source of truth for "am i admin on this
  remote". no new fetches needed for gating.
- when the remote is offline / unreachable, the admin button hides; the
  admin view itself shows an "offline" banner and disables actions
- all writes funnel through the existing typed client, so retries,
  toast errors, and structured `error_type` checks work the same as
  every other spume view

## testing plan

### grimoire (rust)

- unit tests for each new offal handler verifying the same outputs as
  the corresponding `admin_dispatch` arm (shared fixtures)
- integration test in `cli/tests/` that hits the server via http and
  asserts a non-admin caller gets `forbidden`

### spume (vitest)

- `RemoteAdminView` mounts, fetches whoami, renders correct tab
- mocked `ApiClient` returning canned `users_list` / `invites_list` /
  `knocks_list` / `peers_list_all` — assert rows render
- "admin button is hidden when whoami.role !== admin"

### manual qa

1. configure two freqhole servers (A + B), allow A's node as a peer on B
2. open spume, add B as a remote, log in as admin on B
3. confirm `admin` button shows on B's row in remotes view
4. click → users tab loads B's users
5. generate invite, copy code, redeem from another device
6. switch to federation tab; from a third node, knock; refresh and
   accept the knock; confirm peer appears in allowed peers list
7. show QR code for B's node id, scan with phone, confirms node id

## migration / rollout

- this is purely additive on the server — existing wizard
  `admin_dispatch` keeps working unchanged
- spume client requires `cd client-codegen && make all` after the
  grimoire changes land
- no data migration

## file-level checklist

backend:

- [ ] `grimoire/src/offal/admin/users.rs` (new)
- [ ] `grimoire/src/offal/admin/invites.rs` (new)
- [ ] `grimoire/src/offal/admin/peers.rs` (new)
- [ ] `grimoire/src/offal/admin/mod.rs` (register new modules)
- [ ] `grimoire/src/admin_dispatch/mod.rs` (extract shared helpers)
- [ ] `grimoire/src/api_registry/type_registry.rs` (register new types)
- [ ] `grimoire/src/users/admin_service.rs` or similar (optional, if
      extracting helpers into a service module)

codegen:

- [ ] `cd client-codegen && make all`
- [ ] verify generated entries in
      `client-codegen/freqhole-api-client/src/codegen/routes.ts`

frontend:

- [ ] `client/spume/package.json` (add `qrcode` if missing)
- [ ] `client/spume/src/settings/views/admin/RemoteAdminView.tsx`
- [ ] `client/spume/src/settings/views/admin/RemoteAdminContext.tsx`
- [ ] `client/spume/src/settings/views/admin/UsersTab.tsx`
- [ ] `client/spume/src/settings/views/admin/FederationTab.tsx`
- [ ] `client/spume/src/settings/views/admin/components/QrCodeDisplay.{tsx,css}`
- [ ] `client/spume/src/settings/views/admin/components/{ConfirmDialog,UserRow,InviteCodeRow,KnockRow,PeerRow}.tsx`
- [ ] `client/spume/src/settings/views/RemotesSettingsView.tsx` (admin
      button + whoami cache)
- [ ] `client/spume/src/settings/index.ts` (re-exports)
- [ ] spume router registration for `/settings/remotes/:remoteId/admin/*`

tests:

- [ ] grimoire offal handler unit tests
- [ ] cli http integration test for forbidden-non-admin
- [ ] spume vitest specs for admin button gating + tab rendering

## reference: source materials

- wizard users view:
  [client/charnel/src/views/UsersView.tsx](client/charnel/src/views/UsersView.tsx)
- wizard federation view (skim knocks/peers sections):
  [client/charnel/src/views/FederationView.tsx](client/charnel/src/views/FederationView.tsx)
- qr component:
  [client/charnel/src/components/QrCodeDisplay.tsx](client/charnel/src/components/QrCodeDisplay.tsx)
- admin dispatch handlers (source of truth for behavior):
  [grimoire/src/admin_dispatch/mod.rs](grimoire/src/admin_dispatch/mod.rs)
- existing offal-route-over-admin example to model new modules after:
  [grimoire/src/offal/admin/knocks.rs](grimoire/src/offal/admin/knocks.rs)
- existing spume settings layout/nav (do not modify):
  [client/spume/src/settings/layouts/SettingsLayout.tsx](client/spume/src/settings/layouts/SettingsLayout.tsx)
- spume client transport selection (already handles per-remote):
  [client/spume/src/app/api/client.ts](client/spume/src/app/api/client.ts)
