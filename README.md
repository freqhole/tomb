# F R E Q H O L E

self-hosted music library with web, android, and desktop clientz that can talk http or p2p. browse & sort music by artist, album, or your own taxonomies. create playlists and radio streams that you can share with your friends. mobile friendly with offline playback support.

_a note on ai:_ this repo has a lot of ai-generated code ...a wild adventure staring into the llm abyss with claude sonnet iv 😎 (both frightening and thrilling at the same time; what a weird time to be a devel). `BEWARE!`

stuff that's here:

1. `/grimoire/` shared lib, rust code; all the p2p transport (via the lovely [iroh crate](https://github.com/n0-computer/iroh/)), sqlx db + biz logic is here

2. `/client/spume/` a bunch of js that:
   - does gui stuff. so `solid-js`, `tailwindcss`, indexed db, `@tanstack/solid-virtual` for infinite scroll virtualization, `@tanstack/solid-query` for handy-dandy query stuff, `@kobalte/core` for some ui stuff like context menus + combobox; there's a storybook and service worker o my offline-friendly PWA!
   - `npm run dev` or `npm run storybook` to get started; see: [storybook.dev.spume.freqhole.net](https://storybook.dev.spume.freqhole.net/)
   - see also: [spume.freqhole.net](https://spume.freqhole.net)

3. `/client/charnel/` a desktop & android app built with [tauri](https://v2.tauri.app/) that:
   - also does gui stuff, but as a (webview) app; p2p connections don't need http relay!
   - includes some extra admin wizard stuff like managing local scan directories and user invites
   - `npm run tauri dev` to get started
   - see also: [/client/charnel/README.md](/client/charnel/README.md)

4. `/cli/` + `/client/rathole/` a rust cli `cargo run -p cli --bin rathole` that:
   - uses [ratatui](https://ratatui.rs/) for fabulous terminal user interfacez! see: [/client/rathole/](/client/rathole/) see also: [spume.freqhole.net/rathole](https://spume.freqhole.net/rathole)
   - does api "plumbing" commands via args `cargo run -p cli --bin rathole help`; wrapz most of the [/grimoire/](/grimoire/) api.
   - bundles the server/ package and can start the http server (`freqhole http`), P2P endpoint (`freqhole p2p`), or both (`freqhole serve`).
   - see also: [/docs/grimoire-cli-testing.md](/docs/grimoire-cli-testing.md)

5. `/server/` a rust server: `cargo run --bin server` that does http stuff:
   - `sqlx` crate to connect to a sqlite db (see also: [/migrations/](migrations/))
   - `webauthn-rs` optional feature crate for passkey auth
   - `axum` crate for json api, and static file server
   - see [/assets/config/freqhole-config.toml](/assets/config/freqhole-config.toml) and run (`cargo run --bin `)`freqhole setup` to get started 🧙

6. misc  
   a. `/migrations/` sql migrations + views for sqlite db  
   b. `/haruspex/` a centralized identity prototype for supabase; mostly abandoned  
   c. `/flatpak/` some helper scriptz for building .flatpak linux release bundles of charnel (tauri) app  
   d. `/client/midden/` wasm module for iroh relay transport  
   e. `/client-codegen/` zod schema generator (derived from rust structs) and a lil' js client that's mainly `fetch()` + zod schema wrapperz for all the api routez. see also: [/client-codegen/README.md](/client-codegen/README.md)

7. `/docs/` probably-stale and out-of-date .md filez here! :feelsgood:

8. `Makefile` for building binz + sqlx migration stuff `make help` to get started.

---

made with 💖 in NYC
