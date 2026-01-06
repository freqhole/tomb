# Grimoire Makefile
# Simple commands for database management and development

# Include .env file if it exists
ifneq (,$(wildcard ../.env))
    include ../.env
    export
endif



.PHONY: help db-reset db-migrate db-prepare check build test clean

help:
	@echo "Grimoire Development Commands:"
	@echo "  db-reset    - Remove database and run migrations"
	@echo "  db-migrate  - Run database migrations"
	@echo "  db-prepare  - Prepare sqlx query cache"
	@echo "  check       - Run cargo check"
	@echo "  build       - Build the project"
	@echo "  test        - Run tests"
	@echo "  clean       - Clean build artifacts"

# Database commands
db-reset:
	@echo "Resetting database..."
	rm -f $(shell echo $(DATABASE_URL) | sed 's|sqlite:||')
	mkdir -p ../data
	touch $(shell echo $(DATABASE_URL) | sed 's|sqlite:||')
	DATABASE_URL=$(DATABASE_URL) sqlx migrate run --source ../migrations
	@echo "Database reset complete!"

db-migrate:
	@echo "Running migrations..."
	mkdir -p ../data
	touch $(shell echo $(DATABASE_URL) | sed 's|sqlite:||')
	DATABASE_URL=$(DATABASE_URL) sqlx migrate run --source ../migrations

db-prepare: db-migrate
	@echo "Preparing sqlx query cache..."
	DATABASE_URL=$(DATABASE_URL) cargo sqlx prepare

# Development commands
check: db-prepare
	@echo "Running cargo check..."
	cargo check

build: db-prepare
	@echo "Building project..."
	cargo build

test: db-prepare
	@echo "Running tests..."
	cargo test

clean:
	@echo "Cleaning build artifacts..."
	cargo clean
	rm -f $(shell echo $(DATABASE_URL) | sed 's|sqlite:||')
	rm -rf .sqlx/
