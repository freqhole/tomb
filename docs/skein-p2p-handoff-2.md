# skein P2P handoff #2 — reconnection, presence, and friends system (updated through session 3)

## what this is

a summary of work completed across three sessions and a detailed plan for the remaining development. session 1 covered reconnection, presence, and UI fixes. session 2 completed the friends data model v2, midden ALPN registration, accept loop ALPN routing, and the friends protocol handler scaffold. session 3 completed boot.ts wiring, the friendz-bridge module, the friends widget UI overhaul (tab views, online dots, pending requests, privacy settings), and full integration testing. intended to bootstrap a new conversation thread for continuing the skein P2P feature set.

## project context

skein is a collaborative infinite canvas built with PixiJS + automerge-repo, living in `tomb/client/skein/`. it's part of the freqhole monorepo. the full development guide is at `tomb/.github/copilot-instructions.md`, the detailed P2P plan is at `tomb/docs/skein-p2p-plan.md`, and the previous handoff is at `tomb/docs/skein-p2p-handoff.md`.

## what was completed this session

### 1. automatic reconnection with exponential backoff

**problem**: after a page reload, both peers call `addPeer()` simultaneously, creating a QUIC simultaneous-open race. the iroh transport layer fails with `LastOpenPath`, both read loops catch "connection lost", `removePeer()` runs, and nothing retries. peers stay disconnected.

**solution**: added automatic reconnection to `IrohNetworkAdapter` with exponential backoff + jitter.

**file**: `src/p2p/iroh-network-adapter.ts`

new state:

- `intendedPeers: Set<string>` — peers explicitly added via `addPeer()` that the adapter should stay connected to
- `reconnectState: Map<string, { attempt, timer }>` — per-peer backoff tracking
- `failedPeers: Set<string>` — peers that exceeded max reconnection attempts
- `connectionStateListeners: Array<() => void>` — observers of connection state changes

new behavior:

- when `removePeer()` fires for a peer in `intendedPeers`, `scheduleReconnect()` kicks in
- backoff schedule: `1s → 2s → 4s → 8s → 16s → 30s → 30s → 30s` (capped at 30s), plus random 0–1000ms jitter
- after 8 failed attempts (~4 minutes total), gives up and moves the peer to `failedPeers`
- if the peer connects via the accept loop while in backoff, reconnect state is cleared
- `disconnect()` cancels all pending timers

new public API:

- `forgetPeer(nodeId)` — intentionally stop maintaining a connection (no reconnect)
- `getConnectionSummary(): ConnectionSummary` — returns `{ connected, reconnecting, failed }` counts
- `onConnectionStateChange(handler): () => void` — subscribe to state transitions
- `retryFailedPeers()` — re-add all failed peers for fresh reconnection attempts

the jitter is the key fix for the simultaneous-open race — when both peers retry, the random delay means they almost never hit `open_bi()` at the same instant.

**tests**: 11 new tests added (43 total for the adapter) covering scheduled reconnection, no reconnection for accept-only peers, successful reconnect, exponential backoff, max attempts, accept-loop preemption, disconnect cancellation, addPeer reset, and forgetPeer scenarios.

### 2. stoplight connection status indicator

**problem**: the bottom-left pill only showed green/gray (connected/solo) with no transport-level awareness. no way to see reconnection progress or retry failed connections.

**solution**: rewrote `ConnectionStatus` with a 4-state stoplight and click-to-reconnect.

**file**: `src/canvas/connection-status.ts`

new interface — `ConnectionStateSource`:

```typescript
export interface ConnectionStateSource {
  getConnectionSummary(): {
    connected: number;
    reconnecting: number;
    failed: number;
  };
  onStateChange(handler: () => void): () => void;
  retryFailed(): void;
}
```

state priority (highest wins):

1. **red** (`0xef4444`) — `failed > 0` → "N disconnected" — **interactive: click to retry**
2. **yellow** (`0xeab308`) — `reconnecting > 0` → "connecting..."
3. **green** (`0x22c55e`) — online peers > 0 → "N peer(s)"
4. **gray** (`0x6b7280`) — no peers → "solo"

the pill becomes interactive (pointer cursor, event handling) only in the error state. clicking calls `retryFailed()` which feeds back to `IrohNetworkAdapter.retryFailedPeers()`.

wiring: `boot.ts` creates a `ConnectionStateSource` wrapper around the adapter and passes it through `InitCanvasOptions.connectionStateSource` to `initCanvas()`.

### 3. heartbeat + stale peer pruning

**problem**: if a peer's browser crashes (no clean "offline" broadcast), the presence manager never marks them offline. the `pruneStale()` method existed but was never called.

**solution**: added periodic intervals to `PresenceManager`.

**file**: `src/canvas/presence-manager.ts`

- `broadcastOnline()` fires every 10 seconds (keeps `lastSeen` fresh for remote peers)
- `pruneStale(30_000)` fires every 15 seconds (marks peers offline if silent for 30s)
- both intervals cleaned up in `destroy()`

### 4. no cursors or connection status on narthex

**problem**: remote cursors and the connection status pill appeared on the narthex home screen where they're not needed.

**solution**: gated PresenceRenderer, ConnectionStatus, cursor broadcasting, and online announcement behind `!options.isNarthex` in `initCanvas()`.

**file**: `src/canvas/init.ts`

- `PresenceManager` is always created (cheap, needed for store/destroy path)
- `presenceRenderer` and `connectionStatus` are nullable (`PresenceRenderer | null`, `ConnectionStatus | null`) in the `SkeinCanvas` interface
- destroy path uses optional chaining

### 5. share dialog peer list with revoke

**problem**: the share dialog only showed the share string and URL — no way to see who has access or revoke it.

**solution**: added a "shared with" section to the share dialog.

**files**: `src/canvas/share-dialog.ts`, `src/canvas/canvas-store.ts`, `src/standalone/boot.ts`

new in share dialog:

- "shared with" label + scrollable list of peer entries
- each peer: truncated node ID (`first8...last8`) + copy button + red "remove" button
- "no peers yet" placeholder when empty

new in canvas store:

- `removePeer(nodeId)` — deletes a peer from the canvas doc's `peers` record

wiring in boot.ts:

- `onShare` callback builds the peer list from `store.peers()` (filtering out self)
- `onRemovePeer` calls `store.removePeer(nodeId)` + `irohAdapter.forgetPeer(nodeId)`

### 6. friends widget width fix

changed friends widget from 260px to 280px to match the profile widget. updated in `boot.ts` (initial seed + re-seed), `friends-widget.ts` (metadata), and the test.

## test status (after session 1)

- **203 unit tests across 15 files — all passing**
- **typecheck clean** (`tsc --noEmit`)

## files changed in session 1

| file                                     | what changed                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------- |
| `src/p2p/iroh-network-adapter.ts`        | reconnection with backoff, connection state API, failedPeers tracking     |
| `src/p2p/iroh-network-adapter.test.ts`   | +11 tests for reconnection + forgetPeer                                   |
| `src/canvas/connection-status.ts`        | full rewrite: stoplight states, ConnectionStateSource, click-to-reconnect |
| `src/canvas/init.ts`                     | connectionStateSource option, narthex gating for presence/cursors         |
| `src/canvas/presence-manager.ts`         | heartbeat interval (10s), stale pruning interval (15s)                    |
| `src/canvas/canvas-store.ts`             | removePeer(nodeId) method                                                 |
| `src/canvas/share-dialog.ts`             | "shared with" peer list section with copy + remove buttons                |
| `src/standalone/boot.ts`                 | connection state wiring, peer list + onRemovePeer in share dialog         |
| `widgets/narthex/friends-widget.ts`      | defaultWidth 260 → 280                                                    |
| `widgets/narthex/friends-widget.test.ts` | updated width assertion                                                   |

## batch 2 — what was completed (session 2)

### test status (after session 2)

- **265 unit tests across 16 files — all passing**
- **typecheck clean** (`tsc --noEmit`)
- **midden cargo check clean**

### 1. friends data model v2

updated the friends widget data model from a flat v1 schema to a rich v2 schema.

**file**: `widgets/narthex/friends-widget.ts`

new schemas:

- `friendNodeIdSchema` — a node ID entry with `nodeId`, `addedAt`, `lastSeenAt`, and profile fields (`username`, `bio`, `avatarDataUrl`)
- `friendEntrySchema` (v2) — `id`, `alias` (user-set nickname), `username` (from profile), `group` (folder-style), `nodeIds: FriendNodeId[]` (multi-device), `createdAt`
- `friendGroupSchema` — `name`, `createdAt`
- `pendingFriendRequestSchema` — `fromNodeId`, `fromUsername`, `receivedAt`, `status` enum (`"pending"` | `"accepted"` | `"rejected"`)
- `friendsSchema` (v2) — `friends`, `groups`, `pendingRequests` arrays

new exports:

- `FriendNodeId`, `FriendGroup`, `PendingFriendRequest` types
- `migrateV1ToV2(v1Data)` — converts v1 data (single `nodeId`, `name`, `description`) to v2 format. wraps `nodeId` into `nodeIds[]` array, copies `name` → `username`. v1 `description` is intentionally dropped (v2 stores `bio` at the per-nodeId level).
- `friendDisplayName(friend)` — resolves best display name: alias > username > truncated nodeId > `"unknown"`
- `friendDisplayNameFull(friend)` — shows `"username (alias)"` when both exist, otherwise falls back to `friendDisplayName()`

widget `create()` updated to use v2 field names (`friendDisplayName()`, `friend.nodeIds[0]?.nodeId`, `friend.group`).

**tests**: 18 new tests added for the v2 schema, migration function, and display name utilities.

### 2. midden ALPN registration

added `freqhole-friendz/1` as a registered ALPN in the midden WASM crate.

**file**: `client/midden/src/lib.rs`

- new constant: `FRIENDZ_ALPN: &[u8] = b"freqhole-friendz/1"`
- included in `create_with_secret_key()` alpns vec
- included in `create_with_alpns()` base alpns vec
- `accept()` already returns the negotiated ALPN string on the BiStream, so routing happens on the TypeScript side

the midden endpoint now advertises three ALPNs: `freqhole/1`, `iroh/automerge-repo/1`, `freqhole-friendz/1`.

### 3. accept loop ALPN routing

refactored the accept loop in `IrohNetworkAdapter` to dispatch incoming streams by ALPN to registered handlers, instead of hard-rejecting everything that isn't automerge sync.

**file**: `src/p2p/iroh-network-adapter.ts`

new exports:

- `FRIENDZ_ALPN` constant (`"freqhole-friendz/1"`)

new public API:

- `registerAlpnHandler(alpn, handler)` — register a callback for incoming streams with a specific ALPN. the accept loop dispatches matching streams to this handler instead of closing them.
- `getNode(): Promise<MiddenStreamNode>` — exposes the midden node for external protocol handlers that need to open outbound streams (e.g. friends protocol calling `open_bi` with `FRIENDZ_ALPN`).

accept loop changes:

- `SYNC_ALPN` streams are still handled internally (via `registerStream()`)
- registered ALPNs are dispatched to their handler
- unregistered ALPNs are closed (same behavior as before for unknown protocols)
- `disconnect()` clears registered handlers

### 4. friends protocol handler

new module implementing the `freqhole-friendz/1` protocol for friend requests, profile sharing, and presence heartbeat.

**file**: `src/p2p/friends-protocol.ts`

message types (JSON-encoded over length-delimited BiStream):

- `profile-request` / `profile-response` (username, bio, avatarDataUrl)
- `friend-request` / `friend-accept` / `friend-reject` (fromNodeId, fromUsername)
- `heartbeat` (nodeId, username)

`FriendzProtocol` class:

- **incoming stream handling**: `handleStream(stream)` registered as the ALPN handler. dispatches messages by type to event callbacks.
- **privacy enforcement**: `profileVisibility` (`"friends"` | `"everyone"` | `"nobody"`) gates profile-request responses. `friendRequestsFrom` (`"everyone"` | `"nobody"`) gates friend-request delivery.
- **outbound methods**: `sendFriendRequest()`, `sendFriendAccept()`, `sendFriendReject()`, `requestProfile()`
- **heartbeat**: `startHeartbeat(getFriendNodeIds)` sends periodic pings (30s interval). uses a getter function so the friend list is evaluated fresh each tick.
- **online/offline tracking**: `isOnline(nodeId)`, `getOnlinePeers()`, `onOnlineChange()`. peers are online if heartbeat received within 90s.
- **race condition protection**: concurrent `sendMessage` calls to the same unknown peer share a pending connection promise (no stream leaks).
- **setters**: `setLocalUsername()`, `setLocalNodeId()`, `setProfileVisibility()`, `setFriendRequestsFrom()`
- **cleanup**: `destroy()` closes all streams, stops heartbeat, clears listeners and pending connections.

wiring (not yet done — for boot.ts):

```
adapter.registerAlpnHandler(FRIENDZ_ALPN, (stream) => friendz.handleStream(stream));
```

**tests**: 37 tests covering message encoding/decoding, incoming message dispatch, privacy enforcement, outbound message content verification, online/offline status, heartbeat, setters, and cleanup.

### files changed in session 2

| file                                     | what changed                                                                    |
| ---------------------------------------- | ------------------------------------------------------------------------------- |
| `client/midden/src/lib.rs`               | added `FRIENDZ_ALPN` constant, included in both endpoint creation paths         |
| `src/p2p/iroh-network-adapter.ts`        | ALPN routing in accept loop, `registerAlpnHandler()`, `getNode()`, FRIENDZ_ALPN |
| `src/p2p/friends-protocol.ts`            | **new** — FriendzProtocol class, message types, encoding, privacy, heartbeat    |
| `src/p2p/friends-protocol.test.ts`       | **new** — 37 tests for the friends protocol handler                             |
| `widgets/narthex/friends-widget.ts`      | v2 schema, migration, display name utilities, updated create()                  |
| `widgets/narthex/friends-widget.test.ts` | updated + expanded for v2 schema, migration, display name tests                 |

## batch 2 continued — what was completed (session 3)

### test status (after session 3)

- **290 unit tests across 17 files — all passing**
- **typecheck clean** (`tsc --noEmit`)

### 5. friendz-bridge module

new module providing a singleton bridge between the FriendzProtocol instance (created in boot.ts) and widgets that need to call protocol methods. follows the same pattern as `identity.ts` — module-level state with exported accessors.

**file**: `src/p2p/friendz-bridge.ts`

exported API:

- `initBridge(protocol)` / `destroyBridge()` — lifecycle (called by boot.ts)
- `isProtocolReady()` — check if the bridge has an active protocol
- `isOnline(nodeId)` / `getOnlinePeers()` — heartbeat status queries (safe before init — return defaults)
- `onOnlineChange(handler)` — subscribe to online/offline changes. defers registration if bridge not yet ready.
- `onBridgeReady(handler)` — fires when bridge becomes ready (or immediately if already ready)
- `sendFriendRequest(peerNodeId)` / `acceptFriendRequest(fromNodeId)` / `rejectFriendRequest(fromNodeId)` / `requestProfile(peerNodeId)` — outbound actions (throw if not ready)
- `setProfileVisibility(visibility)` / `setFriendRequestsFrom(from)` — privacy setting updates (no-op if not ready)

**tests**: 25 tests covering initial state, delegation, deferred subscriptions, error cases, and privacy setters.

### 6. boot.ts wiring

wired the `FriendzProtocol` into the `SkeinRouter` with full event callback integration.

**file**: `src/standalone/boot.ts`

new class fields:

- `friendzProtocol: FriendzProtocol | null`
- `friendzDocUnsubs: Array<() => void>` — for cleaning up doc change listeners

new method `initFriendzProtocol()`:

1. reads identity, friends widget doc handle, and profile widget doc handle from the narthex canvas store
2. constructs `FriendzProtocol` with callbacks:
   - `getMidden` — reuses the same midden factory as the adapter
   - `getLocalProfile` — reads live from the profile doc handle
   - `isFriend` — checks the friends doc's `friends[].nodeIds[].nodeId` entries
   - initial privacy settings read from the friends doc
3. registers `FRIENDZ_ALPN` handler on the adapter: `adapter.registerAlpnHandler(FRIENDZ_ALPN, stream => protocol.handleStream(stream))`
4. wires all event callbacks to the friends doc:
   - `onFriendRequest` → pushes to `pendingRequests[]` (with dedup check)
   - `onFriendAccept` → adds remote peer as friend entry (with dedup check)
   - `onFriendReject` → logs (informational only — no local state change)
   - `onProfileResponse` → updates the matching friend's `nodeIds[]` profile fields
   - `onHeartbeat` → updates `lastSeenAt` on the matching friend's nodeId entry
5. watches the friends doc for privacy setting changes → syncs to protocol
6. watches the profile doc for username changes → syncs to protocol
7. starts heartbeat with a getter that reads the current friends list from the doc
8. calls `initBridge(protocol)` so widgets can access the protocol

called from `navigateToNarthex()` after canvas initialization. safe to call multiple times (no-ops if already initialized).

cleanup in `destroy()`:

- unsubscribes all doc change listeners (stored in `friendzDocUnsubs`)
- calls `destroyBridge()`
- calls `protocol.destroy()`

### 7. friends widget UI overhaul

complete rewrite of the `create()` function with a tabbed view system, online/offline dots, pending friend requests, and privacy settings.

**file**: `widgets/narthex/friends-widget.ts`

schema update:

- added `profileVisibility: z.enum(["friends", "everyone", "nobody"]).default("friends")`
- added `friendRequestsFrom: z.enum(["everyone", "nobody"]).default("everyone")`

new imports from `friendz-bridge`:

- `isOnline` (aliased as `bridgeIsOnline`), `onOnlineChange`, `acceptFriendRequest`, `rejectFriendRequest`, `setProfileVisibility`, `setFriendRequestsFrom`

view system — `viewMode: "list" | "requests" | "settings" | "add"`:

1. **tab bar** (below header separator) — three clickable text tabs: "friends", "requests (N)", "settings". active tab has accent-colored underline. hidden in "add" mode.

2. **list view** (default) — scrollable friend rows with:
   - green/gray online dot (6px) before the avatar circle, color from `bridgeIsOnline()` checking all friend nodeIds
   - avatar, display name, subtitle (group or truncated nodeId)
   - remove button (existing)
   - "add friend" button pinned at bottom

3. **requests view** — pending friend requests from `pendingRequests.filter(r => r.status === "pending")`:
   - each row (52px): avatar + username/nodeId + accept button (green ✓) + reject button (red ×)
   - accept: calls `acceptFriendRequest()` via bridge, updates doc (marks request accepted, adds friend entry)
   - reject: calls `rejectFriendRequest()` via bridge, updates doc (marks request rejected)
   - empty state: "no pending requests"

4. **settings view** — two privacy controls:
   - "profile visibility" — three pill buttons: friends / everyone / nobody
   - "incoming requests" — two pill buttons: everyone / nobody
   - active option highlighted with accent color
   - clicks update the automerge doc and call the bridge

5. **add view** — existing add-friend form (name + node ID fields), unchanged from before

online change subscription: `onOnlineChange()` triggers re-layout when in list view so dots update live. cleaned up in `destroy()`.

### 8. privacy settings in friends doc

moved privacy settings into the friends doc (not the profile doc) for simplicity — the friends widget can read/write them directly without cross-widget access.

- `profileVisibility`: controls who can see our profile via the protocol. `"friends"` (default) = only respond to profile requests from known friends. `"everyone"` = respond to any profile request. `"nobody"` = never respond.
- `friendRequestsFrom`: controls who can send us friend requests. `"everyone"` (default) = accept incoming requests (still needs manual approval). `"nobody"` = silently ignore all incoming requests.

when the user changes a setting in the widget, it:

1. writes to the automerge doc (`ctx.doc.change()`)
2. calls the bridge setter (`bridgeSetProfileVisibility()` / `bridgeSetFriendRequestsFrom()`)
3. boot.ts watches the doc and syncs changes to the protocol (handles the case where the bridge setter fails)

### files changed in session 3

| file                                     | what changed                                                                    |
| ---------------------------------------- | ------------------------------------------------------------------------------- |
| `src/p2p/friendz-bridge.ts`              | **new** — module-level bridge for widget ↔ protocol communication              |
| `src/p2p/friendz-bridge.test.ts`         | **new** — 25 tests for the bridge module                                        |
| `src/standalone/boot.ts`                 | FriendzProtocol creation, ALPN handler registration, event callbacks, heartbeat |
| `widgets/narthex/friends-widget.ts`      | tab views, online dots, requests view, settings view, privacy schema fields     |
| `widgets/narthex/friends-widget.test.ts` | updated for new schema defaults (profileVisibility, friendRequestsFrom)         |

---

## what's next — remaining work

the core friends system infrastructure is now complete. the remaining items are polish, UX improvements, and connecting features end-to-end.

### friends data model v2

the current friends widget has a flat data model — each friend is `{ id, name, description, nodeId, createdAt }`. this needs to expand significantly.

**current model** (`widgets/narthex/friends-widget.ts`):

```typescript
const friendEntrySchema = z.object({
  id: z.string(),
  name: z.string().default(""),
  description: z.string().default(""),
  nodeId: z.string().default(""),
  createdAt: z.string().default(""),
});

export const friendsSchema = z.object({
  friends: z.array(friendEntrySchema).default([]),
});
```

**new model** — a friend is a person who may have multiple devices (node IDs). each node ID can have profile info fetched from the remote peer. the local user can set an alias for the friend.

```typescript
interface FriendNodeId {
  nodeId: string; // 64-char hex iroh node ID
  addedAt: string; // ISO date
  lastSeenAt: string; // ISO date, updated by heartbeat
  // profile fields populated by fetching the peer's profile doc
  username: string; // from remote profile
  bio: string; // from remote profile
  avatarDataUrl: string; // from remote profile (base64 data URL)
}

interface FriendEntry {
  id: string; // UUID — canonical friend identity
  alias: string; // user-set nickname (takes display priority)
  username: string; // best-effort: copied from most recently seen nodeId's profile
  group: string; // folder-style group name (empty string = ungrouped)
  nodeIds: FriendNodeId[];
  createdAt: string; // ISO date
}

interface FriendGroup {
  name: string; // group display name
  createdAt: string;
}

interface FriendsState {
  friends: FriendEntry[];
  groups: FriendGroup[];
}
```

**display name resolution**: when showing a friend, use `alias` if set, otherwise `username`, otherwise truncated nodeId of the first entry. format: if alias is set, show `username (alias)`. if only alias, show `alias`. if only username, show `username`.

**groups**: folder-style (exclusive) — each friend belongs to exactly one group. groups are used for sorting/filtering the friends list widget. the default group is `""` (ungrouped). users can create/rename/delete groups from the friends widget.

**migration**: the existing friends data is a simple array of `FriendEntry` with a single `nodeId` field. need a migration path: wrap the existing `nodeId` into a `nodeIds: [{ nodeId, ... }]` array, copy `name` → `username`, set `alias: ""`, `group: ""`.

### profile sharing protocol — `freqhole-friendz/1` ALPN

a new ALPN for friend-related P2P communication, separate from the automerge sync ALPN.

**midden changes needed**: register `freqhole-friendz/1` as an additional ALPN alongside the existing `freqhole/1` and `iroh/automerge-repo/1`. the accept loop in the iroh adapter already filters by ALPN — a new handler will be needed for `freqhole-friendz/1` streams.

**message protocol**: JSON-encoded messages over length-delimited BiStream (same framing as automerge sync). message types:

```typescript
type FriendsProtocolMessage =
  // request the peer's profile
  | { type: "profile-request" }
  // response with profile data
  | {
      type: "profile-response";
      username: string;
      bio: string;
      avatarDataUrl: string;
    }
  // send a friend request
  | { type: "friend-request"; fromNodeId: string; fromUsername: string }
  // accept a friend request
  | { type: "friend-accept"; fromNodeId: string; fromUsername: string }
  // reject a friend request
  | { type: "friend-reject"; fromNodeId: string }
  // periodic presence ping
  | { type: "heartbeat"; nodeId: string; username: string };
```

**friend request flow**:

1. peer A opens a `freqhole-friendz/1` stream to peer B
2. A sends `{ type: "friend-request", fromNodeId: ..., fromUsername: ... }`
3. B receives the request → notification appears in friends widget
4. B accepts → sends `{ type: "friend-accept", ... }` back, both sides add each other to their friends doc
5. B rejects → sends `{ type: "friend-reject", ... }`, A gets a notification that the request was declined
6. after becoming friends, both sides can exchange `profile-request`/`profile-response` to populate profile fields

**privacy settings** (stored in profile doc):

- `profileVisibility`: `"friends"` | `"everyone"` | `"nobody"` (default: `"friends"`)
  - `"friends"` — only respond to profile requests from known friends
  - `"everyone"` — respond to any profile request
  - `"nobody"` — never respond to profile requests
- `friendRequestsFrom`: `"everyone"` | `"nobody"` (default: `"everyone"`)
  - `"everyone"` — accept incoming friend requests (still needs manual approval)
  - `"nobody"` — silently ignore all incoming friend requests

**notification UI**: pending friend requests are stored in the friends doc (persisted across reloads). the friends widget shows a badge count for pending requests and a list with accept/reject buttons.

```typescript
interface PendingFriendRequest {
  fromNodeId: string;
  fromUsername: string;
  receivedAt: string;
  status: "pending" | "accepted" | "rejected";
}
```

### friends presence heartbeat — `freqhole-friendz/1` ALPN

global friend online/offline status, independent of canvas-level presence (which uses automerge ephemeral messages and only works within a single canvas document).

**how it works**:

- when skein boots and an identity exists, open `freqhole-friendz/1` streams to all friends' node IDs
- send periodic `heartbeat` messages (every 30s) with nodeId and username
- track `lastSeenAt` per friend node ID
- mark a friend as offline if no heartbeat received within 90s
- the friends widget shows online/offline status (green/gray dot next to each friend)

**this is distinct from canvas presence**: canvas presence (PresenceManager) uses automerge-repo's ephemeral messaging and only works for peers syncing the same document. friends heartbeat works globally — you can see that a friend is online even if they're not on the same canvas.

### friends widget UI updates

the friends widget needs significant UI changes to support the new data model:

- **group headers** in the friends list (collapsible sections)
- **online/offline dot** next to each friend (green/gray, from heartbeat)
- **alias display** — show `username (alias)` or just `alias` or just `username`
- **friend detail view** — tap a friend to see all their node IDs, set alias, change group, remove friend
- **pending requests section** — badge count + list with accept/reject buttons
- **settings section** — profileVisibility and friendRequestsFrom dropdowns
- **add friend flow update** — the current "add friend" form adds a bare node ID. update to send a friend request instead of directly adding. the friend gets added to the local list only after acceptance.

### "add friend" from share dialog

in the share dialog's peer list, each peer row could have an "add friend" button (in addition to copy and remove). clicking it:

1. sends a `friend-request` message over `freqhole-friendz/1`
2. the remote peer sees a notification in their friends widget
3. on acceptance, both sides exchange profiles and add each other

this bridges the share/friends flows — you share a canvas with someone, then you can friend them directly from the share dialog.

### implementation order (updated)

~~1. **friends data model v2** — done (session 2)~~
~~2. **midden ALPN registration** — done (session 2)~~
~~3. **friends protocol handler** — done (session 2)~~
~~4. **boot.ts wiring** — done (session 3)~~
~~5. **friend request flow** — done (session 3, integrated into widget + boot.ts)~~
~~6. **friends heartbeat** — done (session 3, wired in boot.ts + online dots in widget)~~
~~7. **privacy settings** — done (session 3, in friends doc + settings view in widget)~~ 8. **profile sharing end-to-end** — request profiles from friends on connect, populate FriendNodeId profile fields, show avatars/bios in friend detail view 9. **"add friend" from share dialog** — add a "friend" button to share dialog peer rows, send friend request over protocol 10. **midden WASM rebuild** — run `make build` in `client/midden/` to include the `freqhole-friendz/1` ALPN in the browser WASM bundle (currently only in Rust source)

### friends widget UI polish (worth doing)

- **collapsible group headers** — currently groups just show as subtitle text. add collapsible section headers that group friends by their `group` field.
- **friend detail view** — tap a friend row to see all their nodeIds, set alias, change group, view profile (bio/avatar), remove friend. this is a 5th view mode in the widget.
- **avatar images** — once profile sharing populates `avatarDataUrl` on friend nodeId entries, render actual avatar images in friend rows instead of initial-letter circles.
- **"send request" in add form** — the current "add friend" form directly adds a friend entry. change it to send a friend-request over the protocol instead, so the friend gets added only after the remote peer accepts.
- **outbound request tracking** — currently the sender doesn't know if their request was rejected. add an `outboundRequests` array to track requests we've sent and their status.

### canvas-level presence improvements (also worth doing)

- **transport→presence bridge** — listen for `peer-disconnected` on the adapter and immediately mark that peer offline in the PresenceManager (rather than waiting 30s for stale pruning)
- **display names on cursors** — extend the presence protocol with a `username` field so cursors show names instead of truncated hex IDs. the PresenceManager could look up usernames from the friends doc via the bridge.
- **periodic broadcastOnline on reconnect** — after the adapter reconnects to a peer, immediately fire `broadcastOnline()` so the remote peer sees us come back without waiting for the next heartbeat interval

## key files to read first

| file                                | what it does                                                                                   |
| ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| `docs/skein-p2p-plan.md`            | full plan with all phases, decisions, and status                                               |
| `docs/skein-p2p-handoff.md`         | previous handoff (phases A–C)                                                                  |
| `src/standalone/boot.ts`            | SkeinRouter — navigation, join flow, reconnection, FriendzProtocol wiring, event callbacks     |
| `src/p2p/iroh-network-adapter.ts`   | automerge-repo ↔ iroh bridge, reconnection, ALPN routing (`registerAlpnHandler`), `getNode()` |
| `src/p2p/friends-protocol.ts`       | FriendzProtocol class, message types, privacy, heartbeat, online/offline tracking              |
| `src/p2p/friendz-bridge.ts`         | module-level bridge for widget ↔ protocol communication (singleton pattern)                   |
| `src/p2p/identity.ts`               | iroh identity management (lazy midden init)                                                    |
| `src/canvas/connection-status.ts`   | stoplight pill with ConnectionStateSource interface                                            |
| `src/canvas/presence-manager.ts`    | ephemeral presence (cursors, online/offline, locks) with heartbeat                             |
| `src/canvas/canvas-store.ts`        | typed mutations on canvas doc (addPeer, removePeer, etc.)                                      |
| `src/canvas/share-dialog.ts`        | share modal with peer list, copy, and remove buttons                                           |
| `src/canvas/init.ts`                | initCanvas() — canvas lifecycle, presence gating for narthex                                   |
| `widgets/narthex/friends-widget.ts` | friends widget — v2 data model, tabbed UI (list/requests/settings/add), online dots, privacy   |
| `widgets/narthex/profile-widget.ts` | profile widget (privacy settings are in the friends doc, not here)                             |
| `client/midden/src/lib.rs`          | WASM crate — iroh endpoint with 3 ALPNs (freqhole/1, automerge-repo/1, friendz/1)              |

## architectural notes for the next developer

- **midden ALPN registration is done in Rust source.** `freqhole-friendz/1` is registered in the WASM crate. however, `make build` in `client/midden/` has not been run yet — the WASM pkg needs to be rebuilt for the browser to pick up the new ALPN. run `cd client/midden && make build` before testing in the browser.

- **the full protocol stack is wired end-to-end.** the adapter routes incoming `freqhole-friendz/1` streams to the `FriendzProtocol` via `registerAlpnHandler()`. boot.ts creates the protocol, wires all event callbacks to the friends doc, and initializes the bridge. the friends widget uses the bridge to check online status, accept/reject requests, and update privacy settings.

- **the friends doc is per-widget and local-only.** the friends widget gets its own automerge document (the widget manager creates one automatically). this doc holds the friends list, pending requests, groups, and privacy settings. it's not shared with anyone. profile data from friends is fetched over the protocol and written into this local doc by boot.ts event callbacks.

- **friend requests must survive page reloads** — pending requests are stored in the friends doc (automerge, persisted in IndexedDB). the notification badge reads from this persisted state.

- **display name utilities are implemented** — `friendDisplayName()` and `friendDisplayNameFull()` in `friends-widget.ts` implement the resolution logic. these should be used by cursor labels, share dialog, and anywhere else peer info appears. they are exported from the widget module.

- **heartbeat is wired and running.** `startHeartbeat()` is called in `initFriendzProtocol()` with a getter that reads the current friends list from the automerge doc. online dots in the friends widget update live via the `onOnlineChange` subscription through the bridge.

- **privacy settings live in the friends doc** (not the profile doc as originally planned). this simplifies the widget — it can read/write privacy settings from its own doc without cross-widget access. boot.ts watches the friends doc for changes and syncs them to the protocol.

- **the friendz bridge handles deferred initialization gracefully.** widgets can import and call bridge functions before the protocol is ready. state queries return safe defaults (false, []), subscriptions are deferred and registered when the bridge becomes ready, and actions throw with a clear error message. the `onBridgeReady()` function lets widgets react to initialization.

- **known limitation: accept is optimistic.** when the user accepts a friend request in the widget, the local doc is updated immediately (request marked accepted, friend added) even if the network message fails to send. the `acceptFriendRequest()` call is fire-and-forget. a future improvement would be to add an intermediate "accept-pending" state and confirm only after the remote peer acknowledges.

- **known limitation: outbound request rejection is invisible.** when a friend request we sent is rejected by the remote peer, boot.ts logs the rejection but doesn't persist it anywhere. the sender has no UI indication that their request was declined. a future `outboundRequests` array could track this.
