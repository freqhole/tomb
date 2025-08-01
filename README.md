# F R E Q H O L E

this repo is mostly ai-generated code ...a wild adventure staring (chatting?!) into the llm abyss with claude sonnet iv 😎 both frightening and thrilling at the same time.

stuff that's here:

1. `/server/` a rust server: `cargo run --bin server` that:

- `sqlx` crate to connect to a postgresql db (see also: [/migrations/](migrations/))
- `webauthn-rs` crate for passkey auth
- `axum` crate for json api, websocket db CRUD stuff, and static file server

2. `/cli/` a rust cli `cargo run --bin cli` that:

- does a lot of what the server does but via terminal ui

3. `/grimoire/` shared (between server & cli) rust code

4. `/client/js/` a bunch of js that:

- does gui stuff. so `solid-js`, `tailwindcss`, indexed db, and a lot of web-components.
- `npm run build:web-components:copy` or `npm run dev:freqhole` to get started

5. `/scripts/` handy but probably broken bash shell scriptz 🥺

6. `/docs/` ai vomit🤮

7. `/assets/` mostly generated static filez, i should delete most of these at some point...

8. `Makefile` `make help` to get started

---

made with 💖 in NYC
