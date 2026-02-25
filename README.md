# F R E Q H O L E

a music server && web + desktop client.

_a note on ai:_ this repo has a lot of ai-generated code ...a wild adventure staring into the llm abyss with claude sonnet iv 😎 (both frightening and thrilling at the same time; what a weird time to be a devel).

stuff that's here:

1. `/server/` a rust server: `cargo run --bin server` that:

- `sqlx` crate to connect to a sqlite db (see also: [/migrations/](migrations/))
- `webauthn-rs` optional feature crate for passkey auth
- `axum` crate for json api, and static file server
- see [/assets/config/config.jsonc](/assets/config/config.jsonc) to get started (setup cli wizard coming soon! 🧙)

2. `/cli/` a rust cli `cargo run --bin freqhole` (or just `cargo run`) that:

- does mostly everything the server does (plus a few more admin/maintenance thingz) but via terminal ui (simple `clap` arg parser)
- bundles the server/ package and can start the http server (also used as a sidecar proc in the tauri app)
- see also: [/docs/grimoire-cli-testing.md](/docs/grimoire-cli-testing.md)

3. `/grimoire/` shared (between server & cli) rust code; all the sqlx db logic is here

4. `/client/spume/` a bunch of js that:

- does gui stuff. so `solid-js`, `tailwindcss`, indexed db, `@tanstack/solid-virtual` for infinite scroll virtualization, `@tanstack/solid-query` for handy-dandy query stuff, `@kobalte/core` for some ui stuff like context menus + combobox; oh and there's a storybook!
- `npm run dev` or `npm run storybook` to get started

5. `/client/tauri/` a desktop app built with tauri that:

- also does gui stuff, but as a (webview) app
- includes some extra admin stuff like managing local scan directories and user invites
- `npm run tauri dev` to get started
- see also: [/client/tauri/README.md](/client/tauri/README.md)

5. `client-codegen` zod schema generator (derived from rust structs) and a lil' js client that's mainly `fetch()` + zod schema wrapperz for all the api routez. see also: [/client-codegen/README.md](/client-codegen/README.md)

6. `/docs/` probably-stale and out-of-date .md filez here! :feelsgood:

7. `Makefile` for building binz + sqlx migration stuff `make help` to get started.

---

made with 💖 in NYC
