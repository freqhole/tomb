# tauri builds

## build targets

```bash
# macOS arm64 (M1/M2)
make tauri-build-mac-arm

# macOS intel (x86_64)
make tauri-build-mac-intel

# Linux AppImage
make tauri-build-linux
```

outputs go to `client/tauri/src-tauri/target/release/bundle/`.

## prerequisites

1. install tauri CLI: `cargo install tauri-cli`
2. install npm deps: `cd client/tauri && npm install && cd ../spume && npm install`
3. ensure rust targets exist:
   - mac arm: `rustup target add aarch64-apple-darwin`
   - mac intel: `rustup target add x86_64-apple-darwin`
   - linux: needs native linux or docker

## version management

all versions sync from `Cargo.toml` workspace version.

```bash
# bump to new version
make bump-version VERSION=0.2.0
```

updates:
- `Cargo.toml` (workspace version)
- tauri.conf.json, package.json files
- TypeScript version.ts constants
- freqhole-config.toml

## mac signing (future)

not yet configured. when ready:
1. set up Apple Developer ID cert
2. add to tauri.conf.json bundle.macOS section
3. notarization via `apple-id` and `password` in bundle config

## linux appimage notes

must build on linux (native or docker). for docker-based builds, see existing `Dockerfile.build` pattern.
