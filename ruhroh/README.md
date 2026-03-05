# ruhroh - iroh federation prototype

a minimal prototype demonstrating peer-to-peer communication between "freqhole servers" using iroh.

## architecture

```
┌─────────────────────────────────────────────────────────────┐
│  ruhroh-central (coordination server)                       │
│  - invite code management                                   │
│  - server registration (node_id ↔ server_id)                │
│  - group management & peer discovery                        │
└─────────────────────────────────────────────────────────────┘
         │                              │
         │ register                     │ lookup peers
         ▼                              ▼
┌─────────────────────┐          ┌─────────────────────┐
│  ruhroh-client A    │◄────────►│  ruhroh-client B    │
│  NodeId: abc123...  │   iroh   │  NodeId: xyz789...  │
│                     │  (QUIC)  │                     │
└─────────────────────┘          └─────────────────────┘
```

## building

```bash
cd ruhroh
cargo build --release
```

## usage

### 1. start central server

```bash
# terminal 1
cargo run --bin ruhroh-central -- --port 3000
```

### 2. create invite codes

```bash
# terminal 2: create invites for two clients
curl -X POST http://localhost:3000/api/admin/invites \
  -H "Content-Type: application/json" \
  -d '{"label": "alice"}'

curl -X POST http://localhost:3000/api/admin/invites \
  -H "Content-Type: application/json" \
  -d '{"label": "bob"}'

# note the invite codes from the responses
```

### 3. register clients

```bash
# terminal 2: register alice
cargo run --bin ruhroh-client -- \
  --data-dir ./alice-data \
  register <alice-invite-code> "alice"

# terminal 3: register bob
cargo run --bin ruhroh-client -- \
  --data-dir ./bob-data \
  register <bob-invite-code> "bob"
```

### 4. create a group and join

```bash
# create a group (using curl for now)
curl -X POST http://localhost:3000/api/groups \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <alice-api-key>" \
  -d '{"name": "music-lovers"}'

# note the group_id

# bob joins the group
cargo run --bin ruhroh-client -- \
  --data-dir ./bob-data \
  join <group-id>
```

### 5. start chat

```bash
# terminal 2: alice starts chat
cargo run --bin ruhroh-client -- \
  --data-dir ./alice-data \
  chat

# terminal 3: bob starts chat
cargo run --bin ruhroh-client -- \
  --data-dir ./bob-data \
  chat
```

now alice and bob can send messages to each other!

### chat commands

```
<number> <message>              - send chat to peer
songs <number>                  - query peer's freqhole songs
playlists <number>              - query peer's freqhole playlists
get-blob <number> <id> <path>   - fetch a blob from peer's freqhole
share <file>                    - share a local file, get ticket
fetch <ticket> <path>           - download from ticket
quit                            - exit
```

### standalone commands

```bash
# query peer's songs directly
cargo run --bin ruhroh-client -- --data-dir ./alice-data songs bob

# share a file (keeps running until Ctrl+C)
cargo run --bin ruhroh-client -- --data-dir ./alice-data share /path/to/file.mp3

# fetch a file from ticket
cargo run --bin ruhroh-client -- --data-dir ./bob-data fetch <ticket> /tmp/file.mp3

# test node_id-only connection (validates relay discovery)
cargo run --bin ruhroh-client -- --data-dir ./alice-data connect-test bob
```

## features

### HTTP-over-iroh proxy

peers can query each other's local freqhole API (`/api/songs/query`, `/api/music/playlists/list`, etc.) transparently over iroh's QUIC connections.

### blob transfer via iroh-blobs

music files can be requested by freqhole blob_id. the serving peer looks up the local file path in grimoire and serves it via iroh-blobs. uses disk-based FsStore, not memory.

## API endpoints (central server)

### public

- `POST /api/register` - register with invite code

### authenticated (bearer token)

- `GET /api/servers/{id}` - get server info
- `GET /api/servers/{id}/peers` - get peers in same groups
- `POST /api/groups` - create a group
- `GET /api/groups` - list all groups
- `POST /api/groups/{id}/join` - join a group
- `POST /api/groups/{id}/leave` - leave a group
- `GET /api/groups/{id}/members` - get group members

### admin (no auth for prototype)

- `POST /api/admin/invites` - create invite code
- `GET /api/admin/invites` - list invites

## protocol

ALPN: `ruhroh/1` for messaging/proxy, `iroh-blobs` for file transfer.

```rust
enum RuhrohMessage {
    Chat { from: String, text: String },
    ProxyRequest { id: u64, method: String, path: String, body: Option<String> },
    ProxyResponse { id: u64, status: u16, body: String },
    BlobRequest { id: u64, blob_id: String },
    BlobResponse { id: u64, ticket: Option<String>, error: Option<String> },
}
```

## next steps

- [x] P2P chat messaging
- [x] HTTP proxy to peer's freqhole API
- [x] blob transfer via iroh-blobs
- [x] validate node_id-only connections (no IPs needed)
- [ ] validate image blob streaming
- [ ] browser/WASM client (ruhroh-wasm)
- [ ] integrate with freqhole server
- [ ] persist connections (reconnect on failure)
- [ ] real admin auth for invite creation

## validation tests

### 1. node_id-only connection test

validates that P2P connections work with ONLY the peer's node_id (public key) - no IP addresses, no full endpoint address. iroh discovers peers via relay servers.

```bash
# terminal 1: bob starts listening
cargo run --bin ruhroh-client -- --data-dir ./demo-bob chat

# terminal 2: alice runs connect test
cargo run --bin ruhroh-client -- --data-dir ./demo-alice connect-test bob

# expected output:
# === P2P Connection Test (node_id only: true) ===
# ...
# Connected in 234ms
# ...
# Validation result: SUCCESS - P2P connection works with node_id only!
# No IP addresses were needed for this connection.
```

this proves:

- haruspex only needs to store `node_id` (public key), not IP addresses
- peers can connect via relay discovery
- no privacy concerns about storing/sharing IP addresses

### 2. image blob streaming test

validates that small blobs (thumbnails, album art) stream efficiently over P2P and display correctly in the browser.

```bash
# terminal 1: central server
cd ruhroh && cargo run --bin ruhroh-central -- --port 3000

# terminal 2: bob (native) starts listening
cargo run --bin ruhroh-client -- --data-dir ./demo-bob chat

# terminal 3: browser client
cd ruhroh-wasm && make serve
# open http://localhost:3333, register, join bob's group
```

in browser:

1. select bob as peer
2. use proxy to query songs: `POST /api/songs/query` with body `{"limit":1}`
3. find an image's `remote_blob_id` in the response
4. paste blob ID in "fetch blob" input, click fetch
5. should detect mime type and display image inline

expected log:

```
fetching blob abc123...
received 45678 bytes
detected mime type: image/jpeg
displaying image!
```

this proves:

- small blobs (images) work with same streaming mechanism as audio
- mime type auto-detection works (magic bytes)
- no need for separate binary transport for images

## integration plan

ruhroh stays as its own isolated crate. freqhole server embeds it as a feature.

### identity & discovery

- **central server** is the source of truth for user identities and groups
- freqhole servers register with central, get assigned to groups
- peer discovery: freqhole asks central "who's in my groups?" → gets node_ids
- iroh dials peers by node_id (uses public relays, no stored addresses)

### auth flow (rough sketch)

1. freqhole server registers with central server (invite code → server_id + api_key)
2. freqhole asks central for peer list in its groups
3. when peer A connects to peer B:
   - A presents its central server identity (node_id maps to server_id)
   - B verifies with central that A is allowed (same group membership)
   - B creates a local user/api_key for A (or reuses existing)
   - A's requests to B's freqhole API use that api_key

### streaming (no caching)

fetched songs stream directly, not persisted locally. the peer's freqhole serves blobs on-demand via iroh-blobs.

### open questions

- how does freqhole verify peer identity? node_id is crypto-verified by iroh, but how to map node_id → central server_id on incoming connection?
- when a new peer joins a group, how does freqhole learn about it? poll central? webhook?
- should the central server issue short-lived tokens for peer-to-peer auth, or just verify membership on each connection?
