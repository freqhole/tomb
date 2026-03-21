# freqhole tauri app

desktop app for freqhole. bundles the `freqhole` CLI binary as a sidecar and provides a macOS application experience with system tray, app menu, and setup wizard.

## architecture

```
src/                    # wizard/admin SolidJS frontend (port 1421 in dev)
src-tauri/
  src/
    lib.rs              # tauri app setup, plugin registration
    commands.rs         # tauri commands for wizard operations (grimoire direct calls)
    sidecar.rs          # server process management (start/stop/restart, log capture)
    server_controls.rs  # shared menu/tray server control logic
    menu.rs             # app menu bar (freqhole menu, edit, view)
    tray.rs             # system tray icon and menu
    wizard.rs           # setup wizard window management
```

the tauri app embeds grimoire directly for wizard operations (config creation, user management, scanning). the actual music server runs as a separate `freqhole serve` process managed by the sidecar module.

## development

```bash
# from client/tauri/
npm install
npm run tauri dev
```

this starts:

- vite dev server for wizard UI on port 1421
- vite dev server for main spume UI on port 1420 (via `dev:all`)
- tauri app with hot reload

**important**: the sidecar uses `target/debug/freqhole` in dev mode. if you change grimoire/server code, rebuild the CLI:

```bash
# from workspace root
cargo build -p cli
```

## build

```bash
npm run tauri build
```

bundles the app with the `freqhole` binary included. output in `src-tauri/target/release/bundle/`.

## key behaviors

- **setup wizard**: shows on first run (no config) or when setup incomplete (no root user)
- **sidecar server**: spawns `freqhole serve --config <path>` as child process
- **log capture**: server stdout/stderr captured and viewable in logs view
- **config location**: user-specified during setup (defaults to app data dir), path saved in `freqhole-app-config.toml`
- **migrations**: run explicitly during setup wizard (`auto_run_migrations: false` in config)

## tauri commands

commands in `commands.rs` are called from JS via `invoke()`. they access grimoire directly (no HTTP):

- `check_setup_status` - determine if wizard needs to run
- `create_config` - generate freqhole-config.toml
- `init_from_config` - initialize db and run migrations
- `create_root_user` - create initial admin with API key
- `list_users`, `list_invites`, etc. - admin operations
- `scan_directory` - create import jobs for music files
- `reload_config` - reload config from disk and restart P2P endpoint

P2P state commands in `p2p_state.rs`:

- `p2p_get_status` - get P2P endpoint status
- `p2p_start`, `p2p_stop`, `p2p_restart` - P2P endpoint control
