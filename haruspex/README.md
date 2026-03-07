# haruspex

Supabase-based coordination service for freqhole P2P federation.

## what it does

- user authentication (magic link email, OAuth)
- group management (create, join via invite code)
- peer discovery (find online peers in your groups)
- profile/avatar storage

## local development

### prerequisites

- Docker Desktop running
- Supabase CLI: `brew install supabase/tap/supabase`

### start local supabase

```bash
cd haruspex
supabase start
```

first run downloads ~4GB of Docker images. subsequent starts are fast.

### local URLs

after `supabase start`:

| service  | URL                    | notes                          |
| -------- | ---------------------- | ------------------------------ |
| API      | http://127.0.0.1:54321 | PostgREST + Auth               |
| Studio   | http://127.0.0.1:54323 | admin dashboard                |
| Inbucket | http://127.0.0.1:54324 | fake email (magic link emails) |

### local credentials

printed after `supabase start`:

```
anon key: eyJhbG...
service_role key: eyJhbG...
```

also saved to `supabase/.env` (gitignored).

### testing auth flow

1. open Studio: http://127.0.0.1:54323
2. go to Authentication > Users
3. click "Add user" or use the API
4. magic link emails appear in Inbucket: http://127.0.0.1:54324

### reset database

```bash
supabase db reset
```

re-runs all migrations from scratch.

## schema

### tables

- `profiles` - user profiles (extends auth.users)
- `groups` - peer discovery groups
- `group_members` - group membership junction
- `peers` - online peer presence (node_id, relay_url, last_seen)

### key functions

- `join_group_by_invite(code)` - join group using invite code
- `update_peer_presence(node_id, group_id, ...)` - heartbeat/upsert peer
- `get_online_peers(stale_minutes)` - get peers in your groups

## deployment

```bash
# link to cloud project
supabase link --project-ref YOUR_PROJECT_REF

# push migrations
supabase db push

# deploy edge functions (if any)
supabase functions deploy
```

## integration with spume

can use haruspex for:

1. **auth**: magic link → get JWT
2. **register peer**: call `update_peer_presence()` on startup
3. **discover peers**: call `get_online_peers()` to find peers
4. **heartbeat**: periodically call `update_peer_presence()`

the browser client (wasm) uses `@supabase/supabase-js` directly.
