# makefile for building freqhole release binaries and tauri apps
# all builds output to build/ directory
#
# run `make info` to see available commands
# run `make build-all` to build everything!
#
# prerequisites:
#   rustup target add aarch64-apple-darwin x86_64-apple-darwin
#   (...add other targets as needed)
#   docker (for linux/pi builds)

# include .env file if it exists
ifneq (,$(wildcard .env))
    include .env
    export
endif

# default DATABASE_URL if not set in .env
DATABASE_URL ?= sqlite:data/grimoire.db

VERSION := $(shell grep '^version = ' Cargo.toml | head -1 | cut -d '"' -f 2)
GIT_SHA := $(shell git rev-parse --short HEAD 2>/dev/null || echo "unknown")
BUILD_DIR := build

# target triples
MAC_ARM_TARGET := aarch64-apple-darwin
MAC_INTEL_TARGET := x86_64-apple-darwin
LINUX_TARGET := x86_64-unknown-linux-gnu
PI_TARGET := aarch64-unknown-linux-gnu
PI32_TARGET := armv7-unknown-linux-gnueabihf

# default target
.PHONY: all
all: info

# build all targets
.PHONY: build-all
build-all:
	@echo "building all freqhole release artifacts..."
	@echo ""
	$(MAKE) build-mac-arm
	$(MAKE) build-mac-intel
	$(MAKE) build-linux
	$(MAKE) build-pi
	$(MAKE) build-pi32
	@echo ""
	@echo "building tauri apps..."
	$(MAKE) build-tauri-mac-arm
	$(MAKE) build-tauri-mac-intel
	$(MAKE) build-tauri-linux-intel
	$(MAKE) build-tauri-linux-arm64
	@echo ""
	@echo "all targets built! artifacts in $(BUILD_DIR)/$(VERSION)/:"
	@find $(BUILD_DIR)/$(VERSION) -type f | sort | sed 's|^|  |'

# macOS arm64 CLI binary (signs + notarizes if APPLE_* env vars set)
.PHONY: build-mac-arm
build-mac-arm:
	@echo "building freqhole CLI for macOS arm64..."
	cargo build --package cli --release --target $(MAC_ARM_TARGET)
	@mkdir -p $(BUILD_DIR)/$(VERSION)
	cp target/$(MAC_ARM_TARGET)/release/freqhole $(BUILD_DIR)/$(VERSION)/freqhole-$(MAC_ARM_TARGET)
	@echo "built: $(BUILD_DIR)/$(VERSION)/freqhole-$(MAC_ARM_TARGET)"
	@if [ -n "$(APPLE_SIGNING_IDENTITY)" ]; then \
		echo "signing..."; \
		codesign --force --options runtime --sign "$(APPLE_SIGNING_IDENTITY)" $(BUILD_DIR)/$(VERSION)/freqhole-$(MAC_ARM_TARGET); \
		codesign --verify --verbose $(BUILD_DIR)/$(VERSION)/freqhole-$(MAC_ARM_TARGET); \
		echo "signed: $(BUILD_DIR)/$(VERSION)/freqhole-$(MAC_ARM_TARGET)"; \
		if [ -n "$(APPLE_ID)" ] && [ -n "$(APPLE_PASSWORD)" ] && [ -n "$(APPLE_TEAM_ID)" ]; then \
			echo "notarizing (this may take a few minutes)..."; \
			zip -j $(BUILD_DIR)/$(VERSION)/freqhole-$(MAC_ARM_TARGET).zip $(BUILD_DIR)/$(VERSION)/freqhole-$(MAC_ARM_TARGET); \
			xcrun notarytool submit $(BUILD_DIR)/$(VERSION)/freqhole-$(MAC_ARM_TARGET).zip \
				--apple-id "$(APPLE_ID)" --password "$(APPLE_PASSWORD)" --team-id "$(APPLE_TEAM_ID)" --wait; \
			echo "notarized: $(BUILD_DIR)/$(VERSION)/freqhole-$(MAC_ARM_TARGET)"; \
		else \
			echo "skipping notarization (APPLE_ID/PASSWORD/TEAM_ID not all set)"; \
		fi; \
	else \
		echo "skipping signing (APPLE_SIGNING_IDENTITY not set)"; \
	fi

# macOS x86_64 CLI binary (signs + notarizes if APPLE_* env vars set)
.PHONY: build-mac-intel
build-mac-intel:
	@echo "building freqhole CLI for macOS x86_64 (vendored OpenSSL)..."
	OPENSSL_STATIC=1 cargo build --package cli --release --target $(MAC_INTEL_TARGET) --features grimoire/vendored-openssl
	@mkdir -p $(BUILD_DIR)/$(VERSION)
	cp target/$(MAC_INTEL_TARGET)/release/freqhole $(BUILD_DIR)/$(VERSION)/freqhole-$(MAC_INTEL_TARGET)
	@echo "built: $(BUILD_DIR)/$(VERSION)/freqhole-$(MAC_INTEL_TARGET)"
	@if [ -n "$(APPLE_SIGNING_IDENTITY)" ]; then \
		echo "signing..."; \
		codesign --force --options runtime --sign "$(APPLE_SIGNING_IDENTITY)" $(BUILD_DIR)/$(VERSION)/freqhole-$(MAC_INTEL_TARGET); \
		codesign --verify --verbose $(BUILD_DIR)/$(VERSION)/freqhole-$(MAC_INTEL_TARGET); \
		echo "signed: $(BUILD_DIR)/$(VERSION)/freqhole-$(MAC_INTEL_TARGET)"; \
		if [ -n "$(APPLE_ID)" ] && [ -n "$(APPLE_PASSWORD)" ] && [ -n "$(APPLE_TEAM_ID)" ]; then \
			echo "notarizing (this may take a few minutes)..."; \
			zip -j $(BUILD_DIR)/$(VERSION)/freqhole-$(MAC_INTEL_TARGET).zip $(BUILD_DIR)/$(VERSION)/freqhole-$(MAC_INTEL_TARGET); \
			xcrun notarytool submit $(BUILD_DIR)/$(VERSION)/freqhole-$(MAC_INTEL_TARGET).zip \
				--apple-id "$(APPLE_ID)" --password "$(APPLE_PASSWORD)" --team-id "$(APPLE_TEAM_ID)" --wait; \
			echo "notarized: $(BUILD_DIR)/$(VERSION)/freqhole-$(MAC_INTEL_TARGET)"; \
		else \
			echo "skipping notarization (APPLE_ID/PASSWORD/TEAM_ID not all set)"; \
		fi; \
	else \
		echo "skipping signing (APPLE_SIGNING_IDENTITY not set)"; \
	fi

# Linux x86_64 CLI binary (via Docker)
.PHONY: build-linux
build-linux:
	@echo "building freqhole CLI for Linux x86_64 using Docker..."
	$(MAKE) db-prepare
	docker build -f Dockerfile.build -t freqhole-linux-builder . \
		--platform linux/amd64 \
		--build-arg TARGET_ARCH=$(LINUX_TARGET)
	@mkdir -p $(BUILD_DIR)/$(VERSION)
	docker run --rm -v $(PWD)/$(BUILD_DIR)/$(VERSION):/output freqhole-linux-builder \
		sh -c "cp /app/target/$(LINUX_TARGET)/release/freqhole /output/freqhole-$(LINUX_TARGET)"
	@echo "built: $(BUILD_DIR)/$(VERSION)/freqhole-$(LINUX_TARGET)"

# Raspberry Pi aarch64 CLI binary (via Docker)
.PHONY: build-pi
build-pi:
	@echo "building freqhole CLI for Raspberry Pi (aarch64) using Docker..."
	$(MAKE) db-prepare
	docker build -f Dockerfile.build -t freqhole-pi-builder .
	@mkdir -p $(BUILD_DIR)/$(VERSION)
	docker run --rm -v $(PWD)/$(BUILD_DIR)/$(VERSION):/output freqhole-pi-builder \
		sh -c "cp /app/target/$(PI_TARGET)/release/freqhole /output/freqhole-$(PI_TARGET)"
	@echo "built: $(BUILD_DIR)/$(VERSION)/freqhole-$(PI_TARGET)"

# Raspberry Pi 32-bit CLI binary (via Docker, webauthn disabled)
.PHONY: build-pi32
build-pi32:
	@echo "building freqhole CLI for Raspberry Pi 32-bit using Docker (webauthn disabled)..."
	$(MAKE) db-prepare
	docker build -f Dockerfile.build -t freqhole-pi32-builder . \
		--build-arg BASE_IMAGE=debian:bullseye \
		--build-arg TARGET_ARCH=$(PI32_TARGET) \
		--build-arg CARGO_EXTRA_FLAGS="--no-default-features"
	@mkdir -p $(BUILD_DIR)/$(VERSION)
	docker run --rm -v $(PWD)/$(BUILD_DIR)/$(VERSION):/output freqhole-pi32-builder \
		sh -c "cp /app/target/$(PI32_TARGET)/release/freqhole /output/freqhole-$(PI32_TARGET)"
	@echo "built: $(BUILD_DIR)/$(VERSION)/freqhole-$(PI32_TARGET)"

.PHONY: clean
clean:
	rm -rf build/
	rm -rf $(TAURI_DIR)/src-tauri/target/release/bundle

.PHONY: info
info:
	@echo "FREQHOLE release build"
	@echo "======================"
	@echo "version: $(VERSION)"
	@echo "output:  $(BUILD_DIR)/$(VERSION)/"
	@echo ""
	@echo "CLI binaries:"
	@echo "  make build-mac-arm   - macOS arm64 (signs + notarizes if APPLE_* set)"
	@echo "  make build-mac-intel - macOS x86_64 (signs + notarizes if APPLE_* set)"
	@echo "  make build-linux     - Linux x86_64 (Docker)"
	@echo "  make build-pi        - Linux aarch64 (Docker)"
	@echo "  make build-pi32      - Linux armv7 (Docker)"
	@echo ""
	@echo "Tauri desktop apps:"
	@echo "  make build-tauri-mac-arm     - macOS arm64 .dmg (signs if APPLE_SIGNING_IDENTITY set)"
	@echo "  make build-tauri-mac-intel   - macOS x86_64 .dmg (signs if APPLE_SIGNING_IDENTITY set)"
	@echo "  make build-tauri-linux-intel - Linux x86_64 .deb/.rpm (Docker)"
	@echo "  make build-tauri-linux-arm64 - Linux aarch64 .deb/.rpm (Docker)"
	@echo ""
	@echo "Flatpak (via Docker, needs .deb first):"
	@echo "  make build-flatpak-intel - Linux x86_64 .flatpak"
	@echo "  make build-flatpak-arm64 - Linux aarch64 .flatpak"
	@echo ""
	@echo "Code signing env vars (set in .env):"
	@echo "  APPLE_SIGNING_IDENTITY - signing identity (e.g. \"Developer ID Application: ...\")"
	@echo "  APPLE_ID               - Apple ID email (for notarization)"
	@echo "  APPLE_PASSWORD - app-specific password (for notarization)"
	@echo "  APPLE_TEAM_ID  - team ID (for notarization)"
	@echo ""
	@echo "Build all:"
	@echo "  make build-all  - build everything"
	@echo "  make clean      - remove build artifacts"
	@echo ""
	@echo "Database:"
	@echo "  make db-reset   - reset database and run migrations"
	@echo "  make db-migrate - run migrations"
	@echo "  make db-prepare - prepare sqlx query cache"
	@echo ""
	@echo "Testing:"
	@echo "  make test-cli              - run CLI integration tests"
	@echo "  make test-cli TEST=pattern - run specific test"
	@echo ""
	@echo "Version:"
	@echo "  make bump-version NEW_VERSION=x.y.z"
	@echo ""

.PHONY: help
help: info

# Tauri app build commands
.PHONY: build-tauri-mac-arm build-tauri-mac-intel build-tauri-linux-intel build-tauri-linux-arm64
TAURI_DIR := client/charnel

# macOS arm64 Tauri app (signed + notarized if env vars set)
build-tauri-mac-arm:
	@echo "building spume client..."
	FREQHOLE_GIT_SHA=$(GIT_SHA) cd client/spume && npm run build
	@echo "building Tauri app for macOS arm64..."
	@if [ -n "$(APPLE_SIGNING_IDENTITY)" ]; then \
		echo "  signing enabled (APPLE_SIGNING_IDENTITY set)"; \
		APPLE_SIGNING_IDENTITY="$(APPLE_SIGNING_IDENTITY)" cd $(TAURI_DIR) && npm run tauri build -- --target aarch64-apple-darwin; \
	else \
		echo "  signing disabled (APPLE_SIGNING_IDENTITY not set)"; \
		cd $(TAURI_DIR) && npm run tauri build -- --target aarch64-apple-darwin; \
	fi
	@mkdir -p $(BUILD_DIR)/$(VERSION)
	cp target/aarch64-apple-darwin/release/bundle/dmg/freqhole_$(VERSION)_aarch64.dmg $(BUILD_DIR)/$(VERSION)/
	@echo "built: $(BUILD_DIR)/$(VERSION)/freqhole_$(VERSION)_aarch64.dmg"
	@if [ -n "$(APPLE_SIGNING_IDENTITY)" ] && [ -n "$(APPLE_ID)" ] && [ -n "$(APPLE_PASSWORD)" ] && [ -n "$(APPLE_TEAM_ID)" ]; then \
		echo "notarizing dmg (this may take a few minutes)..."; \
		xcrun notarytool submit $(BUILD_DIR)/$(VERSION)/freqhole_$(VERSION)_aarch64.dmg \
			--apple-id "$(APPLE_ID)" --password "$(APPLE_PASSWORD)" --team-id "$(APPLE_TEAM_ID)" --wait; \
		xcrun stapler staple $(BUILD_DIR)/$(VERSION)/freqhole_$(VERSION)_aarch64.dmg; \
		echo "notarized + stapled: $(BUILD_DIR)/$(VERSION)/freqhole_$(VERSION)_aarch64.dmg"; \
	fi

# macOS x86_64 Tauri app (signed + notarized if env vars set)
build-tauri-mac-intel:
	@echo "building spume client..."
	FREQHOLE_GIT_SHA=$(GIT_SHA) cd client/spume && npm run build
	@echo "building Tauri app for macOS x86_64..."
	@if [ -n "$(APPLE_SIGNING_IDENTITY)" ]; then \
		echo "  signing enabled (APPLE_SIGNING_IDENTITY set)"; \
		APPLE_SIGNING_IDENTITY="$(APPLE_SIGNING_IDENTITY)" cd $(TAURI_DIR) && npm run tauri build -- --target x86_64-apple-darwin; \
	else \
		echo "  signing disabled (APPLE_SIGNING_IDENTITY not set)"; \
		cd $(TAURI_DIR) && npm run tauri build -- --target x86_64-apple-darwin; \
	fi
	@mkdir -p $(BUILD_DIR)/$(VERSION)
	cp target/x86_64-apple-darwin/release/bundle/dmg/freqhole_$(VERSION)_x64.dmg $(BUILD_DIR)/$(VERSION)/
	@echo "built: $(BUILD_DIR)/$(VERSION)/freqhole_$(VERSION)_x64.dmg"
	@if [ -n "$(APPLE_SIGNING_IDENTITY)" ] && [ -n "$(APPLE_ID)" ] && [ -n "$(APPLE_PASSWORD)" ] && [ -n "$(APPLE_TEAM_ID)" ]; then \
		echo "notarizing dmg (this may take a few minutes)..."; \
		xcrun notarytool submit $(BUILD_DIR)/$(VERSION)/freqhole_$(VERSION)_x64.dmg \
			--apple-id "$(APPLE_ID)" --password "$(APPLE_PASSWORD)" --team-id "$(APPLE_TEAM_ID)" --wait; \
		xcrun stapler staple $(BUILD_DIR)/$(VERSION)/freqhole_$(VERSION)_x64.dmg; \
		echo "notarized + stapled: $(BUILD_DIR)/$(VERSION)/freqhole_$(VERSION)_x64.dmg"; \
	fi

build-tauri-linux-intel:
	@echo "building Tauri app for Linux x86_64 using Docker..."
	$(MAKE) db-prepare
	docker build -f Dockerfile.tauri -t freqhole-tauri-builder-amd64 --platform linux/amd64 \
		--build-arg TARGET_ARCH=x86_64-unknown-linux-gnu \
		--build-arg FREQHOLE_GIT_SHA=$(GIT_SHA) .
	@mkdir -p $(BUILD_DIR)/$(VERSION)
	docker run --rm -v $(PWD)/$(BUILD_DIR)/$(VERSION):/output freqhole-tauri-builder-amd64 \
		sh -c "cp /app/target/x86_64-unknown-linux-gnu/release/bundle/deb/*.deb /output/ && \
		       cp /app/target/x86_64-unknown-linux-gnu/release/bundle/rpm/*.rpm /output/"
	@echo "built: $(BUILD_DIR)/$(VERSION)/freqhole_$(VERSION)_amd64.deb"
	@echo "built: $(BUILD_DIR)/$(VERSION)/freqhole-$(VERSION)-1.x86_64.rpm"

build-tauri-linux-arm64:
	@echo "building Tauri app for Linux aarch64 using Docker..."
	$(MAKE) db-prepare
	docker build -f Dockerfile.tauri -t freqhole-tauri-builder-arm64 --platform linux/arm64 \
		--build-arg TARGET_ARCH=aarch64-unknown-linux-gnu \
		--build-arg FREQHOLE_GIT_SHA=$(GIT_SHA) .
	@mkdir -p $(BUILD_DIR)/$(VERSION)
	docker run --rm -v $(PWD)/$(BUILD_DIR)/$(VERSION):/output freqhole-tauri-builder-arm64 \
		sh -c "cp /app/target/aarch64-unknown-linux-gnu/release/bundle/deb/*.deb /output/ && \
		       cp /app/target/aarch64-unknown-linux-gnu/release/bundle/rpm/*.rpm /output/"
	@echo "built: $(BUILD_DIR)/$(VERSION)/freqhole_$(VERSION)_arm64.deb"
	@echo "built: $(BUILD_DIR)/$(VERSION)/freqhole-$(VERSION)-1.aarch64.rpm"
# Flatpak builds (via Docker - no special privileges needed)
.PHONY: build-flatpak-intel build-flatpak-arm64 build-flatpak-builder

# build the flatpak builder image (includes GNOME runtime, ~1GB download first time)
build-flatpak-builder:
	@echo "building flatpak builder image (includes GNOME Platform runtime)..."
	docker build -f Dockerfile.flatpak -t freqhole-flatpak-builder --platform linux/amd64 .

build-flatpak-intel: $(BUILD_DIR)/$(VERSION)/freqhole_$(VERSION)_amd64.deb build-flatpak-builder
	@echo "building Flatpak for x86_64..."
	docker run --rm --privileged \
		-v $(PWD)/$(BUILD_DIR)/$(VERSION):/debs:ro \
		-v $(PWD)/$(BUILD_DIR)/$(VERSION):/output \
		freqhole-flatpak-builder \
		/debs/freqhole_$(VERSION)_amd64.deb /output/freqhole_$(VERSION)_x86_64.flatpak x86_64
	@echo "built: $(BUILD_DIR)/$(VERSION)/freqhole_$(VERSION)_x86_64.flatpak"

build-flatpak-arm64: $(BUILD_DIR)/$(VERSION)/freqhole_$(VERSION)_arm64.deb
	@echo "building Flatpak for aarch64..."
	docker build -f Dockerfile.flatpak -t freqhole-flatpak-builder-arm64 --platform linux/arm64 .
	docker run --rm --privileged \
		-v $(PWD)/$(BUILD_DIR)/$(VERSION):/debs:ro \
		-v $(PWD)/$(BUILD_DIR)/$(VERSION):/output \
		freqhole-flatpak-builder-arm64 \
		/debs/freqhole_$(VERSION)_arm64.deb /output/freqhole_$(VERSION)_aarch64.flatpak aarch64
	@echo "built: $(BUILD_DIR)/$(VERSION)/freqhole_$(VERSION)_aarch64.flatpak"
# version management
.PHONY: bump-version
bump-version:
	@echo "current version: $(VERSION)"
	@if [ -z "$(NEW_VERSION)" ]; then \
		read -p "enter new version: " ver && \
		if [ -z "$$ver" ]; then \
			echo "error: version cannot be empty"; \
			exit 1; \
		fi && \
		$(MAKE) bump-version NEW_VERSION=$$ver; \
	else \
		echo "bumping version to $(NEW_VERSION)..."; \
		echo "  updating Cargo.toml..."; \
		sed -i '' 's/^version = "[^"]*"/version = "$(NEW_VERSION)"/' Cargo.toml; \
		echo "  updating client/midden/Cargo.toml..."; \
		sed -i '' 's/^version = "[^"]*"/version = "$(NEW_VERSION)"/' client/midden/Cargo.toml; \
		echo "  updating tauri.conf.json..."; \
		sed -i '' 's/"version": "[^"]*"/"version": "$(NEW_VERSION)"/' $(TAURI_DIR)/src-tauri/tauri.conf.json; \
		echo "  updating package.json files..."; \
		(cd $(TAURI_DIR) && npm version $(NEW_VERSION) --no-git-tag-version --allow-same-version); \
		(cd client/spume && npm version $(NEW_VERSION) --no-git-tag-version --allow-same-version); \
		(cd client-codegen/freqhole-api-client && npm version $(NEW_VERSION) --no-git-tag-version --allow-same-version); \
		echo "  updating version.ts files..."; \
		sed -i '' 's/VERSION = "[^"]*"/VERSION = "$(NEW_VERSION)"/' client/spume/src/version.ts; \
		sed -i '' 's/VERSION = "[^"]*"/VERSION = "$(NEW_VERSION)"/' $(TAURI_DIR)/src/version.ts; \
		echo "  updating freqhole-config.toml..."; \
		sed -i '' 's/^version = "[^"]*"/version = "$(NEW_VERSION)"/' assets/config/freqhole-config.toml; \
		echo "  updating about.html..."; \
		sed -i '' 's/>v[0-9]*\.[0-9]*\.[0-9]*</>v$(NEW_VERSION)</' $(TAURI_DIR)/public/about.html; \
		echo ""; \
		echo "version bumped to $(NEW_VERSION)"; \
		echo ""; \
		echo "verify changes with: git diff"; \
	fi

# database commands (from grimoire)
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

# CLI testing commands (from grimoire)
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
