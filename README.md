# F R E Q H O L E

a music server + web client.

this repo has a lot of ai-generated code ...a wild adventure staring (chatting?!) into the llm abyss with claude sonnet iv 😎 both frightening and thrilling at the same time.

stuff that's here:

1. `/server/` a rust server: `cargo run --bin server` that:

- `sqlx` crate to connect to a sqlite db (see also: [/migrations/](migrations/))
- `webauthn-rs` optional feature crate for passkey auth
- `axum` crate for json api, and static file server

2. `/cli/` a rust cli `cargo run --bin cli` that:

- does mostly everything the server does but via terminal ui

3. `/grimoire/` shared (between server & cli) rust code. all the sqlx db logic is here.

4. `/client/js/` a bunch of js that:

- does gui stuff. so `solid-js`, `tailwindcss`, indexed db, and a lot of web-components.
- `npm run dev:freqhole` to get started

6. `/docs/` mostly ai vomit 🤮

7. `Makefile` for building rust packages + sqlx migration stuff `make help` to get started.

---

made with 💖 in NYC
