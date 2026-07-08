# haruspex dev commands

DATABASE_URL ?= sqlite:$(CURDIR)/haruspex.db

.PHONY: db-setup
db-setup: db-migrate

.PHONY: db-migrate
db-migrate:
	@command -v sqlx >/dev/null 2>&1 || cargo install sqlx-cli --no-default-features --features sqlite,rustls --locked
	DATABASE_URL=$(DATABASE_URL) sqlx database create
	DATABASE_URL=$(DATABASE_URL) sqlx migrate run --source rust/migrations

.PHONY: test
test:
	cargo test --workspace

.PHONY: fmt
fmt:
	cargo fmt --all

.PHONY: clippy
clippy:
	cargo clippy --workspace --all-targets -- -D warnings
