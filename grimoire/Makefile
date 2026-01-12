# Grimoire Makefile
# Simple commands for database management and development

# Include .env file if it exists
ifneq (,$(wildcard ../.env))
    include ../.env
    export
endif



.PHONY: help db-reset db-migrate db-prepare check build test test-cli test-cli-list test-cli-coverage clean

help:
	@echo "Grimoire Development Commands:"
	@echo ""
	@echo "Database:"
	@echo "  db-reset    - Remove database and run migrations"
	@echo "  db-migrate  - Run database migrations"
	@echo "  db-prepare  - Prepare sqlx query cache"
	@echo ""
	@echo "Development:"
	@echo "  check       - Run cargo check"
	@echo "  build       - Build the project"
	@echo "  test        - Run all tests"
	@echo ""
	@echo "CLI Testing:"
	@echo "  test-cli             - Run all CLI integration tests"
	@echo "  test-cli TEST=x      - Run specific test or pattern (e.g., TEST=playlist_create)"
	@echo "  test-cli-list        - List all CLI tests"
	@echo "  test-cli-coverage    - Generate coverage report for CLI integration tests only"
	@echo ""
	@echo "Cleanup:"
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

# CLI Testing commands
test-cli: db-prepare
	@if [ -z "$(TEST)" ]; then \
		echo "Running all CLI integration tests..."; \
		cargo test --test '*' -- --test-threads=1; \
	else \
		echo "Running tests matching: $(TEST)"; \
		cargo test --test '*' $(TEST) -- --test-threads=1 --nocapture; \
	fi

test-cli-list:
	@echo "Available CLI integration tests:"
	@echo ""
	@cargo test --test '*' -- --list 2>&1 | grep ": test$$" | sed 's/: test$$//' | sort
	@echo ""
	@echo "Total:" $$(cargo test --test '*' -- --list 2>&1 | grep ": test$$" | wc -l | xargs) "tests"

test-cli-coverage: db-prepare
	@echo "Generating coverage report for CLI integration tests..."
	@if ! command -v cargo-llvm-cov >/dev/null 2>&1; then \
		echo ""; \
		echo "Error: cargo-llvm-cov not found. Install with:"; \
		echo "  cargo install cargo-llvm-cov"; \
		echo ""; \
		exit 1; \
	fi
	@mkdir -p coverage
	@echo ""
	@echo "Running CLI integration tests with coverage instrumentation..."
	@cargo llvm-cov --html --output-dir coverage \
		--test '*' \
		-- --test-threads=1
	@echo ""
	@echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
	@echo "✓ CLI Integration Test Coverage Report Generated"
	@echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
	@echo ""
	@echo "  HTML Report: coverage/index.html"
	@echo ""
	@echo "  Open with: open coverage/index.html"
	@echo ""
	@echo "Note: This covers CLI integration tests only (not unit tests)"
	@echo ""

clean:
	@echo "Cleaning build artifacts..."
	cargo clean
	rm -f $(shell echo $(DATABASE_URL) | sed 's|sqlite:||')
	rm -rf .sqlx/
