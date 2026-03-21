# tauri builds

## build targets

```bash
# macOS arm64 (M1/M2)
make tauri-build-mac-arm

# macOS intel (x86_64)
make tauri-build-mac-intel

# Linux deb/rpm (via Docker)
make tauri-build-linux

# build everything (server, cli, tauri mac)
make build-all

# gather all artifacts into build/$VERSION/
make collect
```

mac outputs go to `client/charnel/src-tauri/target/*/release/bundle/`. linux packages go to `target/freqhole/$VERSION/tauri-linux/`. `make collect` gathers everything into `build/$VERSION/`.

## prerequisites

1. install npm deps: `cd client/tauri && npm install && cd ../spume && npm install`
2. ensure rust targets exist:
   - mac arm: `rustup target add aarch64-apple-darwin`
   - mac intel: `rustup target add x86_64-apple-darwin`
   - linux: uses Docker (`Dockerfile.tauri`)

## version management

all versions sync from `Cargo.toml` workspace version.

```bash
# bump to new version
make bump-version NEW_VERSION=0.2.0
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

## linux package notes

uses `Dockerfile.tauri` for docker-based builds:

```bash
make tauri-build-linux
```

output: `target/freqhole/$VERSION/tauri-linux/*.deb` and `*.rpm`

install:

- debian/ubuntu: `sudo dpkg -i *.deb`
- fedora/rhel: `sudo rpm -i *.rpm` or `sudo dnf install *.rpm`

note: AppImage bundling doesn't work in Docker (due to FUSE/linuxdeploy issues under emulation).
