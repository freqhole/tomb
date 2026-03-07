# midden

browser WASM client for freqhole P2P federation.

## what it does

midden provides a `MiddenNode` class that lets browsers connect to freqhole peers over iroh P2P. just need the peer's node_id (public key) to connect - iroh handles discovery via relay.

## building

requires wasm-pack and LLVM toolchain:

```bash
# install wasm-pack
cargo install wasm-pack

# on macOS, ensure LLVM is installed
brew install llvm

# build (dev mode)
make build

# build (release mode, optimized)
make build-release
```

output goes to `pkg/` directory.

## usage

```typescript
import { MiddenNode } from "midden";

// create node (waits for relay connection)
const node = await MiddenNode.create();
console.log("my node_id:", node.node_id());

// make API request to peer - accepts plain node_id or full endpoint JSON
const response = await node.proxy_request(
  peerNodeId, // e.g. "abc123def456..." or '{"id":"...","addrs":[...]}'
  "GET",
  "/api/music/songs?limit=10",
  null,
);
console.log(response.status, response.body);

// fetch blob from peer
const blob = await node.fetch_blob(peerNodeId, blobId);
console.log(blob.size(), blob.content_type());
// blob.data() returns Uint8Array
```

### peer address formats

midden accepts two formats for `peer_addr`:

1. **plain node_id** (64 hex chars): uses iroh relay for discovery

   ```
   13a257b5367d6b5b7ceb67ec6246c3dafbe886af8ed429408cd7619c7a4787b1
   ```

2. **full endpoint JSON**: includes relay URL and/or direct IP hints
   ```json
   {
     "id": "13a257b5...",
     "addrs": [{ "Relay": "https://..." }, { "Ip": "192.168.1.100:57383" }]
   }
   ```

## protocol

uses same protocol as grimoire's federation transport:

- ALPN: `freqhole/1`
- messages: `ProxyRequest`, `ProxyResponse`, `BlobStreamRequest`, `BlobStreamResponse`
- blob streaming: length-prefixed header followed by raw bytes

see `grimoire/src/federation/transport/protocol.rs` for details.
