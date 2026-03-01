# Makefile for building freqhole server and CLI binaries
# Supports cross-compilation for Raspberry Pi targets
#
# some stuff u might need for raspi build:
#
# add Rust targets:
#   rustup target add armv7-unknown-linux-gnueabihf    # 32-bit Pi (Pi 2+)
#   rustup target add aarch64-unknown-linux-gnu        # 64-bit Pi
#
# system dependencies:
#
# macOS (via Homebrew):
#   brew install messense/macos-cross-toolchains/armv7-unknown-linux-gnueabihf
#   brew install messense/macos-cross-toolchains/aarch64-unknown-linux-gnu
#
# Linux (via apt-get):
#   sudo apt-get install gcc-arm-linux-gnueabihf gcc-aarch64-linux-gnu
#
# but it's easier to use docker for both aarch64 & x86_64 builds
# note: [cross](https://github.com/cross-rs/cross) didn't love the openssl deps :/
# also note: .PHONY targetz are kinda silly ¯\_(ツ)_/¯

# Include .env file if it exists
ifneq (,$(wildcard .env))
    include .env
    export
endif

VERSION := $(shell grep '^version = ' server/Cargo.toml | head -1 | cut -d '"' -f 2)
BUILD_DIR := target/freqhole/$(VERSION)
CURRENT_TARGET := $(shell rustc -vV | sed -n 's|host: ||p')

PI_32_TARGET := armv7-unknown-linux-gnueabihf
PI_64_TARGET := aarch64-unknown-linux-gnu
X86_64_TARGET := x86_64-unknown-linux-gnu

RELEASE_MODE := --release
DEBUG_MODE :=

# default target
.PHONY: all
all: build

# build for current platform
.PHONY: build
build:
	@echo "building for current platform: $(CURRENT_TARGET)"
	@mkdir -p $(BUILD_DIR)/$(CURRENT_TARGET)
	cargo build --package server --target $(CURRENT_TARGET) $(RELEASE_MODE)
	cargo build --package cli --target $(CURRENT_TARGET) $(RELEASE_MODE)
	cp target/$(CURRENT_TARGET)/release/server $(BUILD_DIR)/$(CURRENT_TARGET)/freqhole-server
	cp target/$(CURRENT_TARGET)/release/freqhole $(BUILD_DIR)/$(CURRENT_TARGET)/freqhole-cli
	@echo "binz: $(BUILD_DIR)/$(CURRENT_TARGET)/"

# debug build
.PHONY: build-debug
build-debug: RELEASE_MODE :=
build-debug:
	@echo "building debug for current platform: $(CURRENT_TARGET)"
	@mkdir -p $(BUILD_DIR)/$(CURRENT_TARGET)
	cargo build --package server --target $(CURRENT_TARGET)
	cargo build --package cli --target $(CURRENT_TARGET)
	cp target/$(CURRENT_TARGET)/debug/server $(BUILD_DIR)/$(CURRENT_TARGET)/freqhole-server
	cp target/$(CURRENT_TARGET)/debug/cli $(BUILD_DIR)/$(CURRENT_TARGET)/freqhole-cli
	@echo "debug binz: $(BUILD_DIR)/$(CURRENT_TARGET)/"

# docker-based raspi build
.PHONY: build-pi
build-pi:
	@echo "building for Raspberry Pi using Docker"
	@mkdir -p $(BUILD_DIR)/$(PI_64_TARGET)
	$(MAKE) db-prepare
	docker build -f Dockerfile.build -t freqhole-pi-builder .
	docker run --rm -v $(PWD)/$(BUILD_DIR)/$(PI_64_TARGET):/output freqhole-pi-builder \
		sh -c "cp /app/target/aarch64-unknown-linux-gnu/release/server /output/freqhole-server && cp /app/target/aarch64-unknown-linux-gnu/release/freqhole /output/freqhole-cli"
	@echo "pi binaries built: $(BUILD_DIR)/$(PI_64_TARGET)/"

.PHONY: build-pi32
build-pi32:
	@echo "building for Raspberry Pi 32-bit using Docker (webauthn disabled)"
	@mkdir -p $(BUILD_DIR)/$(PI_32_TARGET)
	$(MAKE) db-prepare
	docker build -f Dockerfile.build -t freqhole-pi32-builder . \
		--build-arg BASE_IMAGE=debian:bullseye \
		--build-arg TARGET_ARCH=armv7-unknown-linux-gnueabihf \
		--build-arg CARGO_EXTRA_FLAGS="--no-default-features"
	docker run --rm -v $(PWD)/$(BUILD_DIR)/$(PI_32_TARGET):/output freqhole-pi32-builder \
		sh -c "cp /app/target/armv7-unknown-linux-gnueabihf/release/server /output/freqhole-server && cp /app/target/armv7-unknown-linux-gnueabihf/release/freqhole /output/freqhole-cli"
	@echo "pi 32-bit binz built: $(BUILD_DIR)/$(PI_32_TARGET)/"


# docker-based x86_64 linux build
.PHONY: build-linux
build-linux:
	@echo "building for x86_64 Linux using Docker"
	@mkdir -p $(BUILD_DIR)/$(X86_64_TARGET)
	$(MAKE) db-prepare
	docker build -f Dockerfile.build -t freqhole-linux-builder . \
		--platform linux/amd64 \
		--build-arg TARGET_ARCH=x86_64-unknown-linux-gnu
	docker run --rm -v $(PWD)/$(BUILD_DIR)/$(X86_64_TARGET):/output freqhole-linux-builder \
		sh -c "cp /app/target/x86_64-unknown-linux-gnu/release/server /output/freqhole-server && cp /app/target/x86_64-unknown-linux-gnu/release/freqhole /output/freqhole-cli"
	@echo "linux x86_64 binz built: $(BUILD_DIR)/$(X86_64_TARGET)/"

# all targetz including current platform if different
.PHONY: build-all
build-all:
	@if [ "$(CURRENT_TARGET)" != "$(PI_64_TARGET)" ] && [ "$(CURRENT_TARGET)" != "$(PI_32_TARGET)" ] && [ "$(CURRENT_TARGET)" != "$(X86_64_TARGET)" ]; then \
		echo "building for current platform: $(CURRENT_TARGET)"; \
		$(MAKE) build; \
	fi
	$(MAKE) build-linux
	$(MAKE) build-pi
	$(MAKE) build-pi32
	@echo "all targets built:"
	@if [ "$(CURRENT_TARGET)" != "$(PI_64_TARGET)" ] && [ "$(CURRENT_TARGET)" != "$(PI_32_TARGET)" ] && [ "$(CURRENT_TARGET)" != "$(X86_64_TARGET)" ]; then \
		echo "  - current platform: $(BUILD_DIR)/$(CURRENT_TARGET)/"; \
	fi
	
	@echo "  - linux x86_64: $(BUILD_DIR)/$(X86_64_TARGET)/"
	@echo "  - raspberry Pi: $(BUILD_DIR)/$(PI_64_TARGET)/"
	@echo "  - raspberry Pi32: $(BUILD_DIR)/$(PI_32_TARGET)/"

.PHONY: clean
clean:
	rm -rf target/freqhole

.PHONY: info
info:
	@echo "FREQHOLE build information"
	@echo "========================="
	@echo "version: $(VERSION)"
	@echo "build directory: $(BUILD_DIR)"
	@echo "current target: $(CURRENT_TARGET)"
	@echo "linux targets: $(X86_64_TARGET)"
	@echo "pi targets: $(PI_32_TARGET), $(PI_64_TARGET)"
	@echo ""
	@echo "build commands:"
	@echo "  make build         - build for current platform (release)"
	@echo "  make build-debug   - build for current platform (debug)"
	@echo "  make build-pi      - build for RaspberryPi using Docker"
	@echo "  make build-linux   - build for x86_64 Linux using Docker"
	@echo "  make build-all     - build for all targets (current + cross-compilation)"
	@echo "  make clean         - clean build artifacts"
	@echo ""
	@echo "database commands:"
	@echo "  make db-reset      - remove database and run migrations"
	@echo "  make db-migrate    - run database migrations"
	@echo "  make db-prepare    - prepare sqlx query cache"
	@echo ""
	@echo "CLI testing commands:"
	@echo "  make test-cli              - run all CLI integration testz"
	@echo "  make test-cli TEST=pattern - run specific test or pattern"
	@echo "  make test-cli-list         - list all CLI testz"
	@echo "  make test-cli-coverage     - generate coverage report"
	@echo ""
	@echo "Tauri app commands:"
	@echo "  make tauri-build-mac-arm   - build macOS app (arm64)"
	@echo "  make tauri-build-mac-intel - build macOS app (x86_64)"
	@echo "  make tauri-build-linux     - build Linux AppImage (x86_64)"
	@echo ""
	@echo "version management:"
	@echo "  make bump-version VERSION=x.y.z - update version everywhere"
	@echo ""
	@echo "info:"
	@echo "  make help/info     - show this information"
	@echo ""

.PHONY: help
help: info

# Database commands (from grimoire)
.PHONY: db-reset db-migrate db-prepare
db-reset:
	@echo "resetting database..."
	@DB_PATH=$(shell echo $(DATABASE_URL) | sed 's|sqlite:||'); \
		BLOB_DB=$$(echo $$DB_PATH | sed 's|\.db$$|-blobdata.db|'); \
		rm -f "$$DB_PATH" "$$BLOB_DB"
	$(MAKE) db-migrate

db-migrate:
	@echo "running migrations..."
	mkdir -p data
	touch $(shell echo $(DATABASE_URL) | sed 's|sqlite:||')
	cd grimoire && DATABASE_URL=$(DATABASE_URL) sqlx migrate run --source ../migrations
	@echo "creating views..."
	@for view in migrations/views/*.sql; do \
		echo "  applying $${view}..."; \
		sqlite3 $(shell echo $(DATABASE_URL) | sed 's|sqlite:||') < "$${view}"; \
	done
	@echo "creating blob_data database..."
	@DB_PATH=$(shell echo $(DATABASE_URL) | sed 's|sqlite:||'); \
		BLOB_DB=$$(echo $$DB_PATH | sed 's|\.db$$|-blobdata.db|'); \
		touch "$$BLOB_DB"; \
		sqlite3 "$$BLOB_DB" "CREATE TABLE IF NOT EXISTS blob_data (id TEXT PRIMARY KEY, data BLOB NOT NULL);"
	@echo "database setup complete!"

db-prepare: db-migrate
	@echo "preparing sqlx query cache..."
	cd grimoire && DATABASE_URL=$(DATABASE_URL) cargo sqlx prepare

# CLI Testing commands (from grimoire)
.PHONY: test-cli test-cli-list test-cli-coverage
test-cli: db-prepare
	@if [ -z "$(TEST)" ]; then \
		echo "running all CLI integration tests..."; \
		cd cli && cargo test --test '*' -- --test-threads=1; \
	else \
		echo "running tests matching: $(TEST)"; \
		cd cli && cargo test --test '*' $(TEST) -- --test-threads=1 --nocapture; \
	fi

test-cli-list:
	@echo "available CLI integration tests:"
	@echo ""
	@cd cli && cargo test --test '*' -- --list 2>&1 | grep ": test$$" | sed 's/: test$$//' | sort
	@echo ""
	@echo "total:" $$(cd cli && cargo test --test '*' -- --list 2>&1 | grep ": test$$" | wc -l | xargs) "tests"

test-cli-coverage: db-prepare
	@echo "generating coverage report for CLI integration testz..."
	@if ! command -v cargo-llvm-cov >/dev/null 2>&1; then \
		echo ""; \
		echo "error: cargo-llvm-cov not found. install with:"; \
		echo "  cargo install cargo-llvm-cov"; \
		echo ""; \
		exit 1; \
	fi
	@mkdir -p cli/coverage
	@echo ""
	@echo "running CLI integration testz with coverage instrumentation..."
	@echo "note: testz spawn instrumented binary, coverage data collected from subprocesses"
	@cd cli && cargo llvm-cov --html --output-dir coverage \
		--bin freqhole \
		test --test '*' \
		-- --test-threads=1
	@echo ""
	@echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
	@echo "CLI integration test coverage report generated"
	@echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
	@echo ""
	@echo "  HTML report: cli/coverage/html/index.html"
	@echo ""
	@echo "note: this covers CLI integration testz (not unit testz)!"
	@echo ""

# Tauri app build commands
.PHONY: tauri-build-mac-arm tauri-build-mac-intel tauri-build-linux
TAURI_DIR := client/tauri

tauri-build-mac-arm:
	@echo "building Tauri app for macOS arm64..."
	cd $(TAURI_DIR) && npm run tauri build -- --target aarch64-apple-darwin

tauri-build-mac-intel:
	@echo "building Tauri app for macOS x86_64..."
	cd $(TAURI_DIR) && npm run tauri build -- --target x86_64-apple-darwin

tauri-build-linux:
	@echo "building Tauri app for Linux x86_64 AppImage..."
	cd $(TAURI_DIR) && npm run tauri build -- --target x86_64-unknown-linux-gnu

# Version management
.PHONY: bump-version
bump-version:
	@if [ -z "$(VERSION)" ]; then \
		echo "usage: make bump-version VERSION=x.y.z"; \
		echo "current version: $(shell grep '^version = ' Cargo.toml | head -1 | cut -d '\"' -f 2)"; \
		exit 1; \
	fi
	@echo "bumping version to $(VERSION)..."
	@# Cargo workspace version 
	sed -i '' 's/^version = "[^"]*"/version = "$(VERSION)"/' Cargo.toml
	@# tauri.conf.json
	sed -i '' 's/"version": "[^"]*"/"version": "$(VERSION)"/' $(TAURI_DIR)/src-tauri/tauri.conf.json
	@# package.json files
	cd $(TAURI_DIR) && npm version $(VERSION) --no-git-tag-version
	cd client/spume && npm version $(VERSION) --no-git-tag-version
	@# TypeScript version constants
	sed -i '' 's/VERSION = "[^"]*"/VERSION = "$(VERSION)"/' client/spume/src/version.ts
	sed -i '' 's/VERSION = "[^"]*"/VERSION = "$(VERSION)"/' $(TAURI_DIR)/src/version.ts
	@# freqhole-config.toml
	sed -i '' 's/^version = "[^"]*"/version = "$(VERSION)"/' assets/config/freqhole-config.toml
	@echo "version bumped to $(VERSION)"
	@echo ""
	@echo "verify changes with: git diff"
