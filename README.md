# F R E Q H O L E

a music server + web client.

this repo has a lot of ai-generated code ...a wild adventure staring (chatting?!) into the llm abyss with claude sonnet iv 😎 both frightening and thrilling at the same time.

stuff that's here:

1. `/server/` a rust server: `cargo run --bin server` that:

- `sqlx` crate to connect to a sqlite db (see also: [/migrations/](migrations/))
- `webauthn-rs` optional feature crate for passkey auth
- `axum` crate for json api, and static file server
- see [assets/config/assets/config/config.example.jsonc](assets/config/config.example.jsonc) to get started (setup cli wizard coming soon! 🧙)

2. `/cli/` a rust cli `cargo run --bin freqhole` (or just `cargo run`, see [docs/docs/grimoire-cli-testing.md](docs/docs/grimoire-cli-testing.md) for a whild all the cli possabilities) that:

- does mostly everything the server does but via terminal ui

3. `/grimoire/` shared (between server & cli) rust code. all the sqlx db logic is here.

4. `/client/js/` a bunch of js that:

- does gui stuff. so `solid-js`, `tailwindcss`, indexed db, @tanstack/solid-virtual for infinite scroll virtualization, @tanstack/solid-query for handy-dandy query stuff, @kobalte/core for some ui stuff like context menus + combobox. oh and there's a storybook!
- `npm run dev` or `npm run storybook` to get started

5. `client-codegen` zod schema generator (derived from rust structs) and a lil' js client that's mainly `fetch()` + zod schema wrapperz for all the api routez

6. `/docs/` probably stale and out-of-date info :feelsgood:

7. `Makefile` for building binaryz + sqlx migration stuff `make help` to get started.

---

made with 💖 in NYC
