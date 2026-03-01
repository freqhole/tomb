# Makefile for building freqhole server, CLI binaries, and tauri app
# supports cross-compilation for Raspberry Pi targets
#
# run `make info` to get started and see available commands
# run `make build-all` to build everything!
#
# (optional-ish) add Rust targets:
#   rustup target add aarch64-apple-darwin x86_64-apple-darwin  # for Tauri macOS builds
# you can also add these if you want to build locally, but really, just use docker.
#   rustup target add armv7-unknown-linux-gnueabihf    # 32-bit Pi (Pi 2+)
#   rustup target add aarch64-unknown-linux-gnu        # 64-bit Pi
#   rustup target add x86_64-unknown-linux-gnu		# for Linux builds (or just use docker)

# include .env file if it exists
ifneq (,$(wildcard .env))
    include .env
    export
endif

VERSION := $(shell grep '^version = ' Cargo.toml | head -1 | cut -d '"' -f 2)
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
	cp target/$(CURRENT_TARGET)/release/freqhole $(BUILD_DIR)/$(CURRENT_TARGET)/freqhole
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
	cp target/$(CURRENT_TARGET)/debug/freqhole $(BUILD_DIR)/$(CURRENT_TARGET)/freqhole
	@echo "debug binz: $(BUILD_DIR)/$(CURRENT_TARGET)/"

# docker-based raspi build
.PHONY: build-pi
build-pi:
	@echo "building for Raspberry Pi using Docker"
	@mkdir -p $(BUILD_DIR)/$(PI_64_TARGET)
	$(MAKE) db-prepare
	docker build -f Dockerfile.build -t freqhole-pi-builder .
	docker run --rm -v $(PWD)/$(BUILD_DIR)/$(PI_64_TARGET):/output freqhole-pi-builder \
		sh -c "cp /app/target/aarch64-unknown-linux-gnu/release/server /output/freqhole-server && cp /app/target/aarch64-unknown-linux-gnu/release/freqhole /output/freqhole"
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
		sh -c "cp /app/target/armv7-unknown-linux-gnueabihf/release/server /output/freqhole-server && cp /app/target/armv7-unknown-linux-gnueabihf/release/freqhole /output/freqhole"
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
		sh -c "cp /app/target/x86_64-unknown-linux-gnu/release/server /output/freqhole-server && cp /app/target/x86_64-unknown-linux-gnu/release/freqhole /output/freqhole"
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
	@echo ""
	@echo "building tauri apps..."
	$(MAKE) tauri-build-mac-arm
	$(MAKE) tauri-build-mac-intel
	$(MAKE) tauri-build-linux
	$(MAKE) tauri-build-linux-arm64
	$(MAKE) collect
	@echo ""
	@echo "all targets built!"

.PHONY: clean
clean:
	rm -rf target/freqhole build/
	rm -rf $(TAURI_DIR)/src-tauri/target/release/bundle

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
	@echo "  make tauri-build-linux     - build Linux deb/rpm (via Docker)"
	@echo ""
	@echo "release commands:"
	@echo "  make collect               - gather all built artifacts to build/VERSION/"
	@echo ""
	@echo "version management:"
	@echo "  make bump-version NEW_VERSION=x.y.z - update version everywhere"
	@echo ""
	@echo "info:"
	@echo "  make help/info     - show this information"
	@echo ""

.PHONY: help
help: info

# Tauri app build commands
.PHONY: tauri-build-mac-arm tauri-build-mac-intel tauri-build-linux tauri-build-linux-arm64
TAURI_DIR := client/tauri

tauri-build-mac-arm:
	@echo "building spume client..."
	cd client/spume && npm run build
	@echo "building Tauri app for macOS arm64..."
	cd $(TAURI_DIR) && npm run tauri build -- --target aarch64-apple-darwin

tauri-build-mac-intel:
	@echo "building spume client..."
	cd client/spume && npm run build
	@echo "building Tauri app for macOS x86_64..."
	cd $(TAURI_DIR) && npm run tauri build -- --target x86_64-apple-darwin

tauri-build-linux:
	@echo "building Tauri app for Linux x86_64 using Docker..."
	docker build -f Dockerfile.tauri -t freqhole-tauri-builder-amd64 --platform linux/amd64 \
		--build-arg TARGET_ARCH=x86_64-unknown-linux-gnu .
	@mkdir -p $(BUILD_DIR)/tauri-linux
	docker run --rm -v $(PWD)/$(BUILD_DIR)/tauri-linux:/output freqhole-tauri-builder-amd64 \
		sh -c "cp /app/target/x86_64-unknown-linux-gnu/release/bundle/deb/*.deb /output/ && \
		       cp /app/target/x86_64-unknown-linux-gnu/release/bundle/rpm/*.rpm /output/ && \
		       ls -la /output/"
	@echo "linux x86_64 tauri packages built: $(BUILD_DIR)/tauri-linux/"

tauri-build-linux-arm64:
	@echo "building Tauri app for Linux aarch64 using Docker..."
	docker build -f Dockerfile.tauri -t freqhole-tauri-builder-arm64 --platform linux/arm64 \
		--build-arg TARGET_ARCH=aarch64-unknown-linux-gnu .
	@mkdir -p $(BUILD_DIR)/tauri-linux
	docker run --rm -v $(PWD)/$(BUILD_DIR)/tauri-linux:/output freqhole-tauri-builder-arm64 \
		sh -c "cp /app/target/aarch64-unknown-linux-gnu/release/bundle/deb/*.deb /output/ && \
		       cp /app/target/aarch64-unknown-linux-gnu/release/bundle/rpm/*.rpm /output/ && \
		       ls -la /output/"
	@echo "linux arm64 tauri packages built: $(BUILD_DIR)/tauri-linux/"

# Collect all built artifacts into build/$VERSION/
COLLECT_DIR := build/$(VERSION)
.PHONY: collect
collect:
	@echo "collecting artifacts into $(COLLECT_DIR)/..."
	@mkdir -p $(COLLECT_DIR)
	@# CLI binaries in arch folders, then zip each
	@if [ -d "$(BUILD_DIR)" ]; then \
		for dir in $(BUILD_DIR)/*/; do \
			name=$$(basename "$$dir"); \
			if [ "$$name" != "tauri-linux" ] && [ -f "$$dir/freqhole" ]; then \
				mkdir -p "$(COLLECT_DIR)/$$name"; \
				cp "$$dir/freqhole" "$(COLLECT_DIR)/$$name/freqhole"; \
				(cd $(COLLECT_DIR) && zip -r "freqhole-$$name.zip" "$$name"); \
			fi \
		done \
	fi
	@# Tauri macOS dmg files
	@for dmg in target/*/release/bundle/dmg/*.dmg; do \
		[ -f "$$dmg" ] && cp "$$dmg" $(COLLECT_DIR)/ 2>/dev/null || true; \
	done
	@# Tauri macOS app bundles (zip them)
	@for app in target/*/release/bundle/macos/*.app; do \
		if [ -d "$$app" ]; then \
			name=$$(basename "$$app" .app); \
			arch=$$(echo "$$app" | grep -o 'aarch64\|x86_64' || echo "unknown"); \
			(cd $$(dirname "$$app") && zip -r "$(PWD)/$(COLLECT_DIR)/$$name-$$arch.app.zip" $$(basename "$$app")); \
		fi \
	done
	@# Tauri Linux deb/rpm
	@for pkg in $(BUILD_DIR)/tauri-linux/*.deb $(BUILD_DIR)/tauri-linux/*.rpm target/*/release/bundle/deb/*.deb target/*/release/bundle/rpm/*.rpm; do \
		[ -f "$$pkg" ] && cp "$$pkg" $(COLLECT_DIR)/ 2>/dev/null || true; \
	done
	@echo ""
	@echo "artifacts collected to $(COLLECT_DIR)/:"
	@find $(COLLECT_DIR) -type f | sed 's|^|  |'

# version management
.PHONY: bump-version
bump-version:
	@if [ -z "$(NEW_VERSION)" ]; then \
		echo "usage: make bump-version NEW_VERSION=x.y.z"; \
		echo "current version: $(VERSION)"; \
		exit 1; \
	fi
	@echo "bumping version to $(NEW_VERSION)..."
	@# Cargo workspace version 
	sed -i '' 's/^version = "[^"]*"/version = "$(NEW_VERSION)"/' Cargo.toml
	@# tauri.conf.json
	sed -i '' 's/"version": "[^"]*"/"version": "$(NEW_VERSION)"/' $(TAURI_DIR)/src-tauri/tauri.conf.json
	@# package.json files
	cd $(TAURI_DIR) && npm version $(NEW_VERSION) --no-git-tag-version
	cd client/spume && npm version $(NEW_VERSION) --no-git-tag-version
	@# TypeScript version constants
	sed -i '' 's/VERSION = "[^"]*"/VERSION = "$(NEW_VERSION)"/' client/spume/src/version.ts
	sed -i '' 's/VERSION = "[^"]*"/VERSION = "$(NEW_VERSION)"/' $(TAURI_DIR)/src/version.ts
	@# freqhole-config.toml
	sed -i '' 's/^version = "[^"]*"/version = "$(NEW_VERSION)"/' assets/config/freqhole-config.toml
	@echo "version bumped to $(NEW_VERSION)"
	@echo ""
	@echo "verify changes with: git diff"

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
