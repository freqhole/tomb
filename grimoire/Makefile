# grimoire Makefile
# Simple commands for database management and development

# Include .env file if it exists
ifneq (,$(wildcard ../.env))
    include ../.env
    export
endif



.PHONY: help db-reset db-migrate db-prepare check build test test-cli test-cli-list test-cli-coverage clean

help:
	@echo "grimoire devel:"
	@echo ""
	@echo "database:"
	@echo "  db-reset    - remove database and run migrations"
	@echo "  db-migrate  - run database migrations"
	@echo "  db-prepare  - prepare sqlx query cache"
	@echo ""
	@echo "development:"
	@echo "  check       - run cargo check"
	@echo "  build       - build the project"
	@echo "  test        - run all tests"
	@echo ""
	@echo "CLI testing:"
	@echo "  test-cli             - run all CLI integration tests"
	@echo "  test-cli TEST=x      - run specific test or pattern (e.g., TEST=playlist_create)"
	@echo "  test-cli-list        - list all CLI tests"
	@echo "  test-cli-coverage    - generate coverage report for CLI integration tests only"
	@echo ""
	@echo "cleanup:"
	@echo "  clean       - clean build artifacts"

# Database commands
db-reset:
	@echo "resetting database..."
	rm -f $(shell echo $(DATABASE_URL) | sed 's|sqlite:||')
	mkdir -p ../data
	touch $(shell echo $(DATABASE_URL) | sed 's|sqlite:||')
	DATABASE_URL=$(DATABASE_URL) sqlx migrate run --source ../migrations
	@echo "database reset complete!"

db-migrate:
	@echo "running migrations..."
	mkdir -p ../data
	touch $(shell echo $(DATABASE_URL) | sed 's|sqlite:||')
	DATABASE_URL=$(DATABASE_URL) sqlx migrate run --source ../migrations

db-prepare: db-migrate
	@echo "preparing sqlx query cache..."
	DATABASE_URL=$(DATABASE_URL) cargo sqlx prepare

# Development commands
check: db-prepare
	@echo "running cargo check..."
	cargo check

build: db-prepare
	@echo "building project..."
	cargo build

test: db-prepare
	@echo "running tests..."
	cargo test

# CLI Testing commands
test-cli: db-prepare
	@if [ -z "$(TEST)" ]; then \
		echo "running all CLI integration tests..."; \
		cargo test --test '*' -- --test-threads=1; \
	else \
		echo "running tests matching: $(TEST)"; \
		cargo test --test '*' $(TEST) -- --test-threads=1 --nocapture; \
	fi

test-cli-list:
	@echo "available CLI integration tests:"
	@echo ""
	@cargo test --test '*' -- --list 2>&1 | grep ": test$$" | sed 's/: test$$//' | sort
	@echo ""
	@echo "total:" $$(cargo test --test '*' -- --list 2>&1 | grep ": test$$" | wc -l | xargs) "tests"

test-cli-coverage: db-prepare
	@echo "generating coverage report for CLI integration tests..."
	@if ! command -v cargo-llvm-cov >/dev/null 2>&1; then \
		echo ""; \
		echo "error: cargo-llvm-cov not found. Install with:"; \
		echo "  cargo install cargo-llvm-cov"; \
		echo ""; \
		exit 1; \
	fi
	@mkdir -p coverage
	@echo ""
	@echo "running CLI integration tests with coverage instrumentation..."
	@cargo llvm-cov --html --output-dir coverage \
		--test '*' \
		-- --test-threads=1
	@echo ""
	@echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
	@echo " CLI Integration Test Coverage Report Generated"
	@echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
	@echo ""
	@echo "  HTML Report: coverage/index.html"
	@echo ""
	@echo "  open with: open coverage/index.html"
	@echo ""
	@echo "note: this covers CLI integration tests only (not unit tests)."
	@echo ""

clean:
	@echo "cleaning build artifacts..."
	cargo clean
	rm -f $(shell echo $(DATABASE_URL) | sed 's|sqlite:||')
	rm -rf .sqlx/
