# F R E Q H O L E

this repo is mostly all ai-generated code. mostly a wild adventure staring into the llm abyss 😎 both frightening and thrilling at the same time.

stuff that's here:

1. `/server/` a rust server: `cargo run --bin server` that:

- `sqlx` crate to connect to a postgresql db (see also: [/migrations/](migrations/))
- `webauthn-rs` crate for passkey auth
- `axum` crate for json api, websocket db CRUD stuff, and static file server

2. `/cli/` a rust cli `cargo run --bin cli` that:

- does a lot of what the server does but via terminal ui

3. `/client/js/` a bunch of js that:

- does gui stuff. so `solid-js`, `tailwindcss`, indexed db, and a lot of web-components.
