# ruhroh-wasm

Browser client for ruhroh P2P federation using iroh compiled to WebAssembly.

## Prerequisites

- Rust with `wasm32-unknown-unknown` target: `rustup target add wasm32-unknown-unknown`
- wasm-pack: `cargo install wasm-pack`
- LLVM (macOS): `brew install llvm` (required for wasm32 compilation on Apple Silicon)
- Node.js for the dev server

## Build Commands

```bash
# Build WASM (dev mode)
make build

# Build WASM (release/optimized)
make build-release

# Run dev server (after building)
make dev

# Build + run dev server
make serve

# Clean build artifacts
make clean
```

The Makefile handles the LLVM CC/AR environment variables automatically.

## Manual Build (if not using Makefile)

```bash
CC=/opt/homebrew/opt/llvm/bin/clang \
  AR=/opt/homebrew/opt/llvm/bin/llvm-ar \
  wasm-pack build --dev --weak-refs --reference-types -t bundler
```

## Development

### Run Everything

```bash
# Terminal 1: central server
cd ruhroh && cargo run -p ruhroh-central

# Terminal 2: create an invite code
curl -X POST http://localhost:3000/api/admin/invites \
  -H "Content-Type: application/json" \
  -d '{"label":"browser-test"}'
# Note the "code" in the response

# Terminal 3: native client (register + chat mode)
cd ruhroh && cargo run -p ruhroh-client -- register -d demo-alice \
  --central http://localhost:3000 --invite <CODE> --name alice
cd ruhroh && cargo run -p ruhroh-client -- chat -d demo-alice

# Terminal 4: browser client
cd ruhroh/ruhroh-wasm && make serve
```

Then open http://localhost:3333:

1. Enter central URL: `http://localhost:3000`
2. Enter invite code from step 2
3. Enter display name
4. Click "register & start node"
5. Create or join a group
6. Select a peer from the list
7. Send chat messages, proxy requests, or fetch blobs

### Without Central Server

Click "start without central" and paste the full JSON address from a native client:

```json
{ "id": "...", "addrs": [{ "Relay": "https://..." }] }
```

## Features

- **Chat**: Send messages to peers via iroh P2P
- **Proxy**: Make HTTP requests to peer's freqhole API
- **Blob fetch**: Request audio or image files from peer's freqhole blob storage
  - Auto-detects mime type from magic bytes (JPEG, PNG, GIF, WebP, MP3, FLAC, OGG, WAV)
  - Displays images inline or plays audio
- **Central discovery**: Register with central server, join groups, discover peers

## Testing Image Blobs

To validate that image blob streaming works over P2P:

1. Start everything as above (central, native client in chat mode, browser)
2. Query the peer's songs to find an image blob ID:
   - In browser: use proxy to `POST /api/songs/query` with body `{"limit":1}`
   - Look for `images` array in response, get `remote_blob_id`
3. Paste the image blob ID in the "fetch blob" input
4. Click "fetch" - should detect image type and display inline

Expected log output:

```
fetching blob abc123...
received 45678 bytes
detected mime type: image/jpeg
displaying image!
```

## Architecture

```
ruhroh-wasm/
├── src/lib.rs      # Rust WASM bindings (RuhrohNode)
├── pkg/            # wasm-pack output (generated)
├── www/            # Vite frontend
│   ├── index.html  # UI
│   └── src/main.js # Client logic + central API
└── Makefile        # Build commands
```

The browser client creates an iroh endpoint that connects through public relays (no direct UDP in browsers). It speaks the same `ruhroh/1` ALPN protocol as the native client.
