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
	@echo "building charnel gui apps..."
	$(MAKE) build-tauri-android-arm64
	$(MAKE) build-tauri-android
	$(MAKE) build-tauri-mac-arm
	$(MAKE) build-tauri-mac-intel
	$(MAKE) build-tauri-linux-intel
	$(MAKE) build-tauri-linux-arm64
	$(MAKE)	build-flatpak-intel
	$(MAKE)	build-flatpak-arm64
	@echo ""
	@echo "building cli binz..."
	@echo ""
	$(MAKE) build-mac-arm
	$(MAKE) build-mac-intel
	$(MAKE) build-linux
	$(MAKE) build-pi
	$(MAKE) build-pi32
	@echo ""
	$(MAKE) docker-cleanup-all
	@echo ""
	@echo "all targets built! artifacts in $(BUILD_DIR)/$(VERSION)/:"
	@find $(BUILD_DIR)/$(VERSION) -type f | sort | sed 's|^|  |'

# macOS arm64 CLI binary (signs + notarizes if APPLE_* env vars set)
.PHONY: build-mac-arm
build-mac-arm:
	@echo "building rathole CLI (cli crate) for macOS arm64 (no webauthn)..."
	cargo build --package cli --release --target $(MAC_ARM_TARGET) --no-default-features
	@mkdir -p $(BUILD_DIR)/$(VERSION)
	cp target/$(MAC_ARM_TARGET)/release/rathole $(BUILD_DIR)/$(VERSION)/rathole_$(VERSION)_darwin-aarch64
	@echo "built: $(BUILD_DIR)/$(VERSION)/rathole_$(VERSION)_darwin-aarch64"
	@if [ -n "$(APPLE_SIGNING_IDENTITY)" ]; then \
		echo "signing..."; \
		codesign --force --options runtime --sign "$(APPLE_SIGNING_IDENTITY)" $(BUILD_DIR)/$(VERSION)/rathole_$(VERSION)_darwin-aarch64; \
		codesign --verify --verbose $(BUILD_DIR)/$(VERSION)/rathole_$(VERSION)_darwin-aarch64; \
		echo "signed: $(BUILD_DIR)/$(VERSION)/rathole_$(VERSION)_darwin-aarch64"; \
		if [ -n "$(APPLE_ID)" ] && [ -n "$(APPLE_PASSWORD)" ] && [ -n "$(APPLE_TEAM_ID)" ]; then \
			echo "notarizing (this may take a few minutes)..."; \
			zip -j $(BUILD_DIR)/$(VERSION)/rathole_$(VERSION)_darwin-aarch64.zip $(BUILD_DIR)/$(VERSION)/rathole_$(VERSION)_darwin-aarch64; \
			xcrun notarytool submit $(BUILD_DIR)/$(VERSION)/rathole_$(VERSION)_darwin-aarch64.zip \
				--apple-id "$(APPLE_ID)" --password "$(APPLE_PASSWORD)" --team-id "$(APPLE_TEAM_ID)" --wait; \
			echo "notarized: $(BUILD_DIR)/$(VERSION)/rathole_$(VERSION)_darwin-aarch64"; \
		else \
			echo "skipping notarization (APPLE_ID/PASSWORD/TEAM_ID not all set)"; \
		fi; \
	else \
		echo "skipping signing (APPLE_SIGNING_IDENTITY not set)"; \
	fi

# macOS x86_64 CLI binary (signs + notarizes if APPLE_* env vars set)
.PHONY: build-mac-intel
build-mac-intel:
	@echo "building rathole CLI (cli crate) for macOS x86_64 (no webauthn)..."
	MACOSX_DEPLOYMENT_TARGET=14.0 cargo build --package cli --release --target $(MAC_INTEL_TARGET) --no-default-features
	@mkdir -p $(BUILD_DIR)/$(VERSION)
	cp target/$(MAC_INTEL_TARGET)/release/rathole $(BUILD_DIR)/$(VERSION)/rathole_$(VERSION)_darwin-x86_64
	@echo "built: $(BUILD_DIR)/$(VERSION)/rathole_$(VERSION)_darwin-x86_64"
	@if [ -n "$(APPLE_SIGNING_IDENTITY)" ]; then \
		echo "signing..."; \
		codesign --force --options runtime --sign "$(APPLE_SIGNING_IDENTITY)" $(BUILD_DIR)/$(VERSION)/rathole_$(VERSION)_darwin-x86_64; \
		codesign --verify --verbose $(BUILD_DIR)/$(VERSION)/rathole_$(VERSION)_darwin-x86_64; \
		echo "signed: $(BUILD_DIR)/$(VERSION)/rathole_$(VERSION)_darwin-x86_64"; \
		if [ -n "$(APPLE_ID)" ] && [ -n "$(APPLE_PASSWORD)" ] && [ -n "$(APPLE_TEAM_ID)" ]; then \
			echo "notarizing (this may take a few minutes)..."; \
			zip -j $(BUILD_DIR)/$(VERSION)/rathole_$(VERSION)_darwin-x86_64.zip $(BUILD_DIR)/$(VERSION)/rathole_$(VERSION)_darwin-x86_64; \
			xcrun notarytool submit $(BUILD_DIR)/$(VERSION)/rathole_$(VERSION)_darwin-x86_64.zip \
				--apple-id "$(APPLE_ID)" --password "$(APPLE_PASSWORD)" --team-id "$(APPLE_TEAM_ID)" --wait; \
			echo "notarized: $(BUILD_DIR)/$(VERSION)/rathole_$(VERSION)_darwin-x86_64"; \
		else \
			echo "skipping notarization (APPLE_ID/PASSWORD/TEAM_ID not all set)"; \
		fi; \
	else \
		echo "skipping signing (APPLE_SIGNING_IDENTITY not set)"; \
	fi

# Linux x86_64 CLI binary (via Docker)
.PHONY: build-linux
build-linux:
	@echo "building rathole CLI (cli crate) for Linux x86_64 using Docker..."
	$(MAKE) db-prepare
	docker build -f Dockerfile.build -t freqhole-linux-builder . \
		--platform linux/amd64 \
		--build-arg TARGET_ARCH=$(LINUX_TARGET) \
		--build-arg FREQHOLE_GIT_SHA=$(GIT_SHA)
	@mkdir -p $(BUILD_DIR)/$(VERSION)
	docker run --rm -v $(PWD)/$(BUILD_DIR)/$(VERSION):/output freqhole-linux-builder \
		sh -c "cp /app/target/$(LINUX_TARGET)/release/rathole /output/rathole_$(VERSION)_linux-x86_64"
	@echo "built: $(BUILD_DIR)/$(VERSION)/rathole_$(VERSION)_linux-x86_64"
	$(MAKE) docker-cleanup IMAGE=freqhole-linux-builder

# Raspberry Pi aarch64 CLI binary (via Docker)
.PHONY: build-pi
build-pi:
	@echo "building rathole CLI (cli crate) for Raspberry Pi (aarch64) using Docker..."
	$(MAKE) db-prepare
	docker build -f Dockerfile.build -t freqhole-pi-builder . \
		--build-arg FREQHOLE_GIT_SHA=$(GIT_SHA)
	@mkdir -p $(BUILD_DIR)/$(VERSION)
	docker run --rm -v $(PWD)/$(BUILD_DIR)/$(VERSION):/output freqhole-pi-builder \
		sh -c "cp /app/target/$(PI_TARGET)/release/rathole /output/rathole_$(VERSION)_linux-aarch64"
	@echo "built: $(BUILD_DIR)/$(VERSION)/rathole_$(VERSION)_linux-aarch64"
	$(MAKE) docker-cleanup IMAGE=freqhole-pi-builder

# Raspberry Pi 32-bit CLI binary (via Docker, webauthn disabled)
.PHONY: build-pi32
build-pi32:
	@echo "building rathole CLI (cli crate) for Raspberry Pi 32-bit using Docker (webauthn disabled)..."
	$(MAKE) db-prepare
	docker build -f Dockerfile.build -t freqhole-pi32-builder . \
		--build-arg BASE_IMAGE=debian:bullseye \
		--build-arg TARGET_ARCH=$(PI32_TARGET) \
		--build-arg CARGO_EXTRA_FLAGS="--no-default-features" \
		--build-arg FREQHOLE_GIT_SHA=$(GIT_SHA)
	@mkdir -p $(BUILD_DIR)/$(VERSION)
	docker run --rm -v $(PWD)/$(BUILD_DIR)/$(VERSION):/output freqhole-pi32-builder \
		sh -c "cp /app/target/$(PI32_TARGET)/release/rathole /output/rathole_$(VERSION)_linux-armv7"
	@echo "built: $(BUILD_DIR)/$(VERSION)/rathole_$(VERSION)_linux-armv7"
	$(MAKE) docker-cleanup IMAGE=freqhole-pi32-builder

# remove a single named docker image + prune dangling images and unused build cache
# usage: $(MAKE) docker-cleanup IMAGE=<image-name>
# non-aggressive: leaves other tagged images, named volumes, and running containers alone.
# safe to run even if the image is missing.
.PHONY: docker-cleanup docker-cleanup-all
docker-cleanup:
	@if [ -z "$(IMAGE)" ]; then \
		echo "docker-cleanup: IMAGE not set, skipping image rm"; \
	else \
		echo "docker-cleanup: removing image $(IMAGE) (if present)..."; \
		docker image rm -f $(IMAGE) >/dev/null 2>&1 || true; \
	fi
	@echo "docker-cleanup: pruning dangling images..."
	@docker image prune -f >/dev/null 2>&1 || true
	@echo "docker-cleanup: pruning unused build cache..."
	@docker builder prune -f >/dev/null 2>&1 || true

# scrub every freqhole builder image + all unused build cache. still preserves
# unrelated images, named volumes, and running containers. handy at the end of
# `build-all` or whenever you want to reclaim disk without `prune -a --volumes`.
docker-cleanup-all:
	@echo "docker-cleanup-all: removing freqhole builder images..."
	@for img in freqhole-linux-builder freqhole-pi-builder freqhole-pi32-builder \
		freqhole-tauri-builder-amd64 freqhole-tauri-builder-arm64 \
		freqhole-flatpak-builder freqhole-flatpak-builder-arm64; do \
		docker image rm -f $$img >/dev/null 2>&1 || true; \
	done
	@echo "docker-cleanup-all: pruning dangling images + unused build cache..."
	@docker image prune -f >/dev/null 2>&1 || true
	@docker builder prune -f >/dev/null 2>&1 || true
	@docker container prune -f >/dev/null 2>&1 || true
	@echo "docker-cleanup-all: done."

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
	@echo "  make build-tauri-android       - Android universal .apk, no 32-bit arm (signed)"
	@echo "  make build-tauri-android-arm64 - Android arm64-only .apk (signed, ~1/3 size of universal)"
	@echo "  make build-tauri-ios           - iOS release .ipa (dev-signed by default; IOS_EXPORT_METHOD=app-store-connect + IOS_CERTIFICATE/IOS_CERTIFICATE_PASSWORD/IOS_MOBILE_PROVISION for a distribution build)"
	@echo ""
	@echo "Flatpak (via Docker, needs .deb first):"
	@echo "  make build-flatpak-intel - Linux x86_64 .flatpak"
	@echo "  make build-flatpak-arm64 - Linux aarch64 .flatpak"
	@echo ""
	@echo "Code signing env vars (set in .env):"
	@echo "  APPLE_SIGNING_IDENTITY - signing identity (e.g. \"Developer ID Application: ...\")"
	@echo "  APPLE_ID               - Apple ID email (for notarization)"
	@echo "  APPLE_PASSWORD - app-specific password (for notarization)"
	@echo "  APPLE_TEAM_ID  - team ID (for notarization + ios automatic signing)"
	@echo ""
	@echo "Android build env vars (set in .env):"
	@echo "  ANDROID_SDK_ROOT             - android sdk path (default: ~/Library/Android/sdk)"
	@echo "  ANDROID_BUILD_TOOLS_VERSION  - build-tools version (default: 37.0.0)"
	@echo "  ANDROID_KEYSTORE             - path to .keystore file"
	@echo "  ANDROID_KEY_ALIAS            - key alias (default: my-key-alias)"
	@echo "  ANDROID_KEYSTORE_PASSWORD    - keystore password (optional, prompts if unset)"
	@echo "  ANDROID_KEY_PASSWORD         - key password (optional, prompts if unset)"
	@echo ""
	@echo "Build all:"
	@echo "  make build-all  - build everything"
	@echo "  make clean      - remove build artifacts"
	@echo ""
	@echo "Docker disk cleanup (non-aggressive):"
	@echo "  make docker-cleanup IMAGE=<name> - rm one image + prune dangling + build cache"
	@echo "  make docker-cleanup-all          - rm all freqhole builder images + prune cache"
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
	@echo "  make changes               - add a changeset for your PR (interactive)"
	@echo "  make bump-version NEW_VERSION=x.y.z"
	@echo ""

.PHONY: help
help: info

# Tauri app build commands
.PHONY: build-tauri-mac-arm build-tauri-mac-intel build-tauri-linux-intel build-tauri-linux-arm64 build-tauri-android build-tauri-android-arm64 build-tauri-ios
TAURI_DIR := client/charnel

# tauri's `ios build` reads the env var APPLE_DEVELOPMENT_TEAM (a tauri-
# specific name, not ours) to pick the team for xcodebuild's automatic
# signing - it's the same apple developer team id as APPLE_TEAM_ID above
# (one team id, just two different tools' names for it), so just forward
# it under the name tauri expects instead of asking for it twice.
APPLE_DEVELOPMENT_TEAM := $(APPLE_TEAM_ID)
export APPLE_DEVELOPMENT_TEAM

# Android tauri build env (override via env or .env)
# defaults assume the standard macOS android studio install layout
ANDROID_SDK_ROOT ?= $(HOME)/Library/Android/sdk
ANDROID_BUILD_TOOLS_VERSION ?= 37.0.0
ANDROID_KEYSTORE ?= $(HOME)/Documents/freqhole-cert/android/freqhole-release-key.keystore
ANDROID_KEY_ALIAS ?= my-key-alias
ANDROID_APKSIGNER := $(ANDROID_SDK_ROOT)/build-tools/$(ANDROID_BUILD_TOOLS_VERSION)/apksigner
# JAVA_HOME for apksigner — defaults to Android Studio's bundled JBR on macOS
JAVA_HOME ?= /Applications/Android Studio.app/Contents/jbr/Contents/Home
export JAVA_HOME

.PHONY: android-key-info
android-key-info:
	keytool -list -v -keystore "$(HOME)/Documents/freqhole-cert/android/freqhole-release-key.keystore"
	keytool -list -v -keystore "$(HOME)/Documents/freqhole-cert/android/freqhole-release-key.keystore" 2>/dev/null | grep -i 'keystore type'

# build lib/haruspex/ts and lib/reliquary/ts (@freqhole/haruspex,
# @freqhole/reliquary). neither ships its dist/ in git, so spume (which
# depends on both via `file:` links) can't resolve their subpath exports
# until this has run at least once in a fresh checkout/ci runner.
# (cenotaph used to build here too - moved into client/spume/src/cenotaph/
# directly, no longer a separate package.)
.PHONY: build-libs
build-libs:
	@echo "building haruspex + reliquary ts libs..."
	@if [ ! -d lib/haruspex/ts/node_modules ]; then (cd lib/haruspex/ts && npm ci); fi
	cd lib/haruspex/ts && npm run build
	@if [ ! -d lib/reliquary/ts/node_modules ]; then (cd lib/reliquary/ts && npm ci); fi
	cd lib/reliquary/ts && npm run build

# build the spume web client into client/spume/dist. grimoire embeds that dir
# via include_dir! at compile time, so it MUST exist before any cargo build of
# the cli/server/grimoire crates (otherwise the macro panics). installs node
# deps if missing so this works standalone in ci and locally.
.PHONY: build-spume
build-spume: build-libs
	@echo "building spume client..."
	@if [ ! -d client-codegen/freqhole-api-client/node_modules ]; then (cd client-codegen/freqhole-api-client && npm ci); fi
	@if [ ! -d client/spume/node_modules ]; then (cd client/spume && npm ci); fi
	cd client/spume && FREQHOLE_GIT_SHA=$(GIT_SHA) npm run build

# macOS arm64 Tauri app (signed + notarized if env vars set)
build-tauri-mac-arm:
	@echo "building spume client..."
	FREQHOLE_GIT_SHA=$(GIT_SHA) cd client/spume && npm run build
	./scripts/fetch-mpv-runtime.sh arm64
	@echo "building Tauri app for macOS arm64..."
	@if [ -n "$(APPLE_SIGNING_IDENTITY)" ]; then \
		echo "  signing enabled (APPLE_SIGNING_IDENTITY set)"; \
		cd $(TAURI_DIR) && APPLE_SIGNING_IDENTITY="$(APPLE_SIGNING_IDENTITY)" npm run tauri build -- --target aarch64-apple-darwin; \
	else \
		echo "  no signing identity - ad-hoc signing (runs locally; not distributable or notarizable)"; \
		cd $(TAURI_DIR) && APPLE_SIGNING_IDENTITY=- npm run tauri build -- --target aarch64-apple-darwin; \
	fi
	@mkdir -p $(BUILD_DIR)/$(VERSION)
	cp target/aarch64-apple-darwin/release/bundle/dmg/freqhole_$(VERSION)_aarch64.dmg $(BUILD_DIR)/$(VERSION)/freqhole_charnel_$(VERSION)_aarch64.dmg
	@echo "built: $(BUILD_DIR)/$(VERSION)/freqhole_charnel_$(VERSION)_aarch64.dmg"
	@if [ -n "$(APPLE_SIGNING_IDENTITY)" ] && [ -n "$(APPLE_ID)" ] && [ -n "$(APPLE_PASSWORD)" ] && [ -n "$(APPLE_TEAM_ID)" ]; then \
		echo "notarizing dmg (this may take a few minutes)..."; \
		xcrun notarytool submit $(BUILD_DIR)/$(VERSION)/freqhole_charnel_$(VERSION)_aarch64.dmg \
			--apple-id "$(APPLE_ID)" --password "$(APPLE_PASSWORD)" --team-id "$(APPLE_TEAM_ID)" --wait; \
		xcrun stapler staple $(BUILD_DIR)/$(VERSION)/freqhole_charnel_$(VERSION)_aarch64.dmg; \
		echo "notarized + stapled: $(BUILD_DIR)/$(VERSION)/freqhole_charnel_$(VERSION)_aarch64.dmg"; \
	fi

# macOS x86_64 Tauri app (signed + notarized if env vars set)
build-tauri-mac-intel:
	@echo "building spume client..."
	FREQHOLE_GIT_SHA=$(GIT_SHA) cd client/spume && npm run build
	./scripts/fetch-mpv-runtime.sh x86_64
	@echo "building Tauri app for macOS x86_64..."
	@if [ -n "$(APPLE_SIGNING_IDENTITY)" ]; then \
		echo "  signing enabled (APPLE_SIGNING_IDENTITY set)"; \
		cd $(TAURI_DIR) && APPLE_SIGNING_IDENTITY="$(APPLE_SIGNING_IDENTITY)" MACOSX_DEPLOYMENT_TARGET=14.0 npm run tauri build -- --target x86_64-apple-darwin; \
	else \
		echo "  no signing identity - ad-hoc signing (runs locally; not distributable or notarizable)"; \
		cd $(TAURI_DIR) && APPLE_SIGNING_IDENTITY=- MACOSX_DEPLOYMENT_TARGET=14.0 npm run tauri build -- --target x86_64-apple-darwin; \
	fi
	@mkdir -p $(BUILD_DIR)/$(VERSION)
	cp target/x86_64-apple-darwin/release/bundle/dmg/freqhole_$(VERSION)_x64.dmg $(BUILD_DIR)/$(VERSION)/freqhole_charnel_$(VERSION)_x86_64.dmg
	@echo "built: $(BUILD_DIR)/$(VERSION)/freqhole_charnel_$(VERSION)_x86_64.dmg"
	@if [ -n "$(APPLE_SIGNING_IDENTITY)" ] && [ -n "$(APPLE_ID)" ] && [ -n "$(APPLE_PASSWORD)" ] && [ -n "$(APPLE_TEAM_ID)" ]; then \
		echo "notarizing dmg (this may take a few minutes)..."; \
		xcrun notarytool submit $(BUILD_DIR)/$(VERSION)/freqhole_charnel_$(VERSION)_x86_64.dmg \
			--apple-id "$(APPLE_ID)" --password "$(APPLE_PASSWORD)" --team-id "$(APPLE_TEAM_ID)" --wait; \
		xcrun stapler staple $(BUILD_DIR)/$(VERSION)/freqhole_charnel_$(VERSION)_x86_64.dmg; \
		echo "notarized + stapled: $(BUILD_DIR)/$(VERSION)/freqhole_charnel_$(VERSION)_x86_64.dmg"; \
	fi

build-tauri-linux-intel:
	@echo "building Tauri app for Linux x86_64 using Docker..."
	$(MAKE) db-prepare
	docker build -f Dockerfile.tauri -t freqhole-tauri-builder-amd64 --platform linux/amd64 \
		--build-arg TARGET_ARCH=x86_64-unknown-linux-gnu \
		--build-arg FREQHOLE_GIT_SHA=$(GIT_SHA) .
	@mkdir -p $(BUILD_DIR)/$(VERSION)
	docker run --rm -v $(PWD)/$(BUILD_DIR)/$(VERSION):/output freqhole-tauri-builder-amd64 \
		sh -c "cp /app/target/x86_64-unknown-linux-gnu/release/bundle/deb/*.deb /output/freqhole_charnel_$(VERSION)_x86_64.deb && \
		       cp /app/target/x86_64-unknown-linux-gnu/release/bundle/rpm/*.rpm /output/freqhole_charnel_$(VERSION)_x86_64.rpm"
	@echo "built: $(BUILD_DIR)/$(VERSION)/freqhole_charnel_$(VERSION)_x86_64.deb"
	@echo "built: $(BUILD_DIR)/$(VERSION)/freqhole_charnel_$(VERSION)_x86_64.rpm"
	$(MAKE) docker-cleanup IMAGE=freqhole-tauri-builder-amd64

build-tauri-linux-arm64:
	@echo "building Tauri app for Linux aarch64 using Docker..."
	$(MAKE) db-prepare
	docker build -f Dockerfile.tauri -t freqhole-tauri-builder-arm64 --platform linux/arm64 \
		--build-arg TARGET_ARCH=aarch64-unknown-linux-gnu \
		--build-arg FREQHOLE_GIT_SHA=$(GIT_SHA) .
	@mkdir -p $(BUILD_DIR)/$(VERSION)
	docker run --rm -v $(PWD)/$(BUILD_DIR)/$(VERSION):/output freqhole-tauri-builder-arm64 \
		sh -c "cp /app/target/aarch64-unknown-linux-gnu/release/bundle/deb/*.deb /output/freqhole_charnel_$(VERSION)_aarch64.deb && \
		       cp /app/target/aarch64-unknown-linux-gnu/release/bundle/rpm/*.rpm /output/freqhole_charnel_$(VERSION)_aarch64.rpm"
	@echo "built: $(BUILD_DIR)/$(VERSION)/freqhole_charnel_$(VERSION)_aarch64.deb"
	@echo "built: $(BUILD_DIR)/$(VERSION)/freqhole_charnel_$(VERSION)_aarch64.rpm"
	$(MAKE) docker-cleanup IMAGE=freqhole-tauri-builder-arm64

# Android Tauri app (release apk, signed with apksigner)
# requires: ANDROID_SDK_ROOT, ANDROID_KEYSTORE (optionally ANDROID_BUILD_TOOLS_VERSION,
# ANDROID_KEY_ALIAS, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_PASSWORD)
#
# arch selection: tauri targets `aarch64`, `armv7`, `i686`, `x86_64`. omitting
# any `--target` flag builds all four (universal). we deliberately drop
# `armv7` (32-bit arm — effectively dead since play store dropped support in
# 2019) to roughly halve the apk. emulator targets (`i686`, `x86_64`) stay so
# the universal apk runs in android studio's avd.
build-tauri-android:
	@echo "building Tauri app for Android (universal apk, no 32-bit arm)..."
	@if [ ! -d "$(ANDROID_SDK_ROOT)" ]; then \
		echo "error: ANDROID_SDK_ROOT not found at $(ANDROID_SDK_ROOT)"; \
		echo "set ANDROID_SDK_ROOT in .env or your environment"; exit 1; \
	fi
	@if [ ! -x "$(ANDROID_APKSIGNER)" ]; then \
		echo "error: apksigner not found at $(ANDROID_APKSIGNER)"; \
		echo "install android build-tools $(ANDROID_BUILD_TOOLS_VERSION) or set ANDROID_BUILD_TOOLS_VERSION"; exit 1; \
	fi
	@if [ ! -f "$(ANDROID_KEYSTORE)" ]; then \
		echo "error: keystore not found at $(ANDROID_KEYSTORE)"; \
		echo "set ANDROID_KEYSTORE in .env or your environment"; exit 1; \
	fi
	cd $(TAURI_DIR) && npm run tauri android build -- --apk --target aarch64 --target x86_64 --target i686
	@echo "signing apk with apksigner..."
	$(ANDROID_APKSIGNER) sign \
		--ks "$(ANDROID_KEYSTORE)" \
		--ks-key-alias "$(ANDROID_KEY_ALIAS)" \
		$(if $(ANDROID_KEYSTORE_PASSWORD),--ks-pass pass:$(ANDROID_KEYSTORE_PASSWORD)) \
		$(if $(ANDROID_KEY_PASSWORD),--key-pass pass:$(ANDROID_KEY_PASSWORD)) \
		$(TAURI_DIR)/src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk
	@mkdir -p $(BUILD_DIR)/$(VERSION)
	cp $(TAURI_DIR)/src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk \
		$(BUILD_DIR)/$(VERSION)/freqhole_charnel_$(VERSION)_android-universal.apk
	@echo "built: $(BUILD_DIR)/$(VERSION)/freqhole_charnel_$(VERSION)_android-universal.apk"

# Android arm64-only apk — for distribution to real devices. roughly 1/3 the
# size of the universal apk since it skips the emulator (i686, x86_64) and
# 32-bit arm (armv7) slices.
build-tauri-android-arm64:
	@echo "building Tauri app for Android (arm64-only apk)..."
	@if [ ! -d "$(ANDROID_SDK_ROOT)" ]; then \
		echo "error: ANDROID_SDK_ROOT not found at $(ANDROID_SDK_ROOT)"; \
		echo "set ANDROID_SDK_ROOT in .env or your environment"; exit 1; \
	fi
	@if [ ! -x "$(ANDROID_APKSIGNER)" ]; then \
		echo "error: apksigner not found at $(ANDROID_APKSIGNER)"; \
		echo "install android build-tools $(ANDROID_BUILD_TOOLS_VERSION) or set ANDROID_BUILD_TOOLS_VERSION"; exit 1; \
	fi
	@if [ ! -f "$(ANDROID_KEYSTORE)" ]; then \
		echo "error: keystore not found at $(ANDROID_KEYSTORE)"; \
		echo "set ANDROID_KEYSTORE in .env or your environment"; exit 1; \
	fi
	cd $(TAURI_DIR) && npm run tauri android build -- --apk --target aarch64
	@echo "signing apk with apksigner..."
	$(ANDROID_APKSIGNER) sign \
		--ks "$(ANDROID_KEYSTORE)" \
		--ks-key-alias "$(ANDROID_KEY_ALIAS)" \
		$(if $(ANDROID_KEYSTORE_PASSWORD),--ks-pass pass:$(ANDROID_KEYSTORE_PASSWORD)) \
		$(if $(ANDROID_KEY_PASSWORD),--key-pass pass:$(ANDROID_KEY_PASSWORD)) \
		$(TAURI_DIR)/src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk
	@mkdir -p $(BUILD_DIR)/$(VERSION)
	cp $(TAURI_DIR)/src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk \
		$(BUILD_DIR)/$(VERSION)/freqhole_charnel_$(VERSION)_android-arm64.apk
	@echo "built: $(BUILD_DIR)/$(VERSION)/freqhole_charnel_$(VERSION)_android-arm64.apk"

# iOS Tauri app (release build, signed via Xcode's automatic signing by
# default - see docs/ios.md phase 4). produces a real .ipa using spume's
# bundled production assets (no vite dev server), unlike `tauri ios dev`.
#
# IOS_EXPORT_METHOD (default: debugging) selects what kind of .ipa comes
# out: "debugging" matches the existing automatic Xcode development-team
# signing used locally (ad-hoc install onto registered devices, no Apple
# Distribution cert/profile needed) - "app-store-connect" produces a real
# App Store/TestFlight-ready archive instead, but needs IOS_CERTIFICATE/
# IOS_CERTIFICATE_PASSWORD/IOS_MOBILE_PROVISION env vars set to an actual
# Apple Distribution cert + App Store provisioning profile (tauri-cli
# itself handles the keychain import/profile install/pbxproj signing
# patch from just those three env vars - see
# `.github/workflows/ios.yml`'s build job for where ci sets them).
#
# IOS_BUILD_NUMBER (optional) sets CFBundleVersion - TestFlight rejects a
# re-upload of the same marketing version (CFBundleShortVersionString)
# with a build number it's already seen, so ci passes something always-
# increasing here (e.g. the workflow run number) to allow repeat uploads
# while ironing out the pipeline. left unset for local dev builds, where
# `make bump-version`'s own CFBundleVersion bump is enough.
#
# the generated xcode project has no DEVELOPMENT_TEAM build setting baked
# in (deliberately - keeps the repo forkable without anyone's personal
# apple developer identity committed), so a plain non-interactive
# `xcodebuild` (unlike Xcode's own GUI, which can prompt you to pick a
# team) fails with "Signing ... requires a development team" unless told
# which team to use - APPLE_TEAM_ID (forwarded above as
# APPLE_DEVELOPMENT_TEAM, tauri's own name for it) covers this. find
# yours at https://developer.apple.com/account (membership details) or
# in Xcode's Signing & Capabilities tab for any other project.
IOS_EXPORT_METHOD ?= debugging
build-tauri-ios:
	@if [ -z "$(APPLE_TEAM_ID)" ]; then \
		echo "error: APPLE_TEAM_ID is not set - set it in .env"; \
		echo "  find your team id at https://developer.apple.com/account (membership details)"; \
		exit 1; \
	fi
	@echo "building Tauri app for iOS (release .ipa, team $(APPLE_TEAM_ID), export method $(IOS_EXPORT_METHOD))..."
	cd $(TAURI_DIR) && npm run tauri ios build -- --export-method $(IOS_EXPORT_METHOD) $(if $(IOS_BUILD_NUMBER),--build-number $(IOS_BUILD_NUMBER))
	@mkdir -p $(BUILD_DIR)/$(VERSION)
	@ipa=$$(find $(TAURI_DIR)/src-tauri/gen/apple -iname "*.ipa" -newer $(TAURI_DIR)/src-tauri/Cargo.toml 2>/dev/null | head -1); \
	if [ -z "$$ipa" ]; then \
		echo "warning: couldn't auto-locate the built .ipa - check the build output above for its path"; \
	else \
		cp "$$ipa" $(BUILD_DIR)/$(VERSION)/freqhole_charnel_$(VERSION)_ios.ipa; \
		echo "built: $(BUILD_DIR)/$(VERSION)/freqhole_charnel_$(VERSION)_ios.ipa"; \
	fi
# Flatpak builds (via Docker - no special privileges needed)
.PHONY: build-flatpak-intel build-flatpak-arm64 build-flatpak-builder

# build the flatpak builder image (includes GNOME runtime, ~1GB download first time)
build-flatpak-builder:
	@echo "building flatpak builder image (includes GNOME Platform runtime)..."
	docker build -f Dockerfile.flatpak -t freqhole-flatpak-builder --platform linux/amd64 .

build-flatpak-intel: $(BUILD_DIR)/$(VERSION)/freqhole_charnel_$(VERSION)_x86_64.deb build-flatpak-builder
	@echo "building Flatpak for x86_64..."
	# --security-opt seccomp=unconfined: flatpak-builder's bwrap needs to
	# install its own nested seccomp filter for every module build -
	# --privileged should already imply this, but some docker setups don't
	# fully honor that, so it's spelled out explicitly too (see
	# docs/libmpv-experimental-player-plan.md's flatpak session notes).
	docker run --rm --privileged --security-opt seccomp=unconfined \
		-v $(PWD)/$(BUILD_DIR)/$(VERSION):/debs:ro \
		-v $(PWD)/$(BUILD_DIR)/$(VERSION):/output \
		freqhole-flatpak-builder \
		/debs/freqhole_charnel_$(VERSION)_x86_64.deb /output/freqhole_charnel_$(VERSION)_x86_64.flatpak x86_64
	@echo "built: $(BUILD_DIR)/$(VERSION)/freqhole_charnel_$(VERSION)_x86_64.flatpak"
	$(MAKE) docker-cleanup IMAGE=freqhole-flatpak-builder

build-flatpak-arm64: $(BUILD_DIR)/$(VERSION)/freqhole_charnel_$(VERSION)_aarch64.deb
	@echo "building Flatpak for aarch64..."
	docker build -f Dockerfile.flatpak -t freqhole-flatpak-builder-arm64 --platform linux/arm64 .
	docker run --rm --privileged --security-opt seccomp=unconfined \
		-v $(PWD)/$(BUILD_DIR)/$(VERSION):/debs:ro \
		-v $(PWD)/$(BUILD_DIR)/$(VERSION):/output \
		freqhole-flatpak-builder-arm64 \
		/debs/freqhole_charnel_$(VERSION)_aarch64.deb /output/freqhole_charnel_$(VERSION)_aarch64.flatpak aarch64
	@echo "built: $(BUILD_DIR)/$(VERSION)/freqhole_charnel_$(VERSION)_aarch64.flatpak"
	$(MAKE) docker-cleanup IMAGE=freqhole-flatpak-builder-arm64
# version management
# add a changeset describing your change (interactive). run this in a PR before
# merging to main; the changeset drives the version bump + changelog later.
.PHONY: changes
changes:
	@if [ ! -d node_modules ]; then npm install; fi
	@npm run changeset

# portable across macos (BSD sed) and linux (GNU sed) via `sed -i.bak` + rm,
# so the same target runs locally and in ci (changesets opens the version PR on
# a linux runner). pass NEW_VERSION=x.y.z or run interactively.
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
		sed -i.bak 's/^version = "[^"]*"/version = "$(NEW_VERSION)"/' Cargo.toml && rm -f Cargo.toml.bak; \
		echo "  updating Cargo.lock (workspace member versions)..."; \
		awk -v ver="$(NEW_VERSION)" '/^name = "(grimoire|cli|server|charnel|rathole|client-codegen|haruspex|reliquary)"$$/ { print; getline; sub(/version = "[^"]*"/, "version = \"" ver "\""); print; next } { print }' Cargo.lock > Cargo.lock.tmp && mv Cargo.lock.tmp Cargo.lock; \
		echo "  updating lib/midden/Cargo.toml (excluded from the workspace, own version field)..."; \
		sed -i.bak 's/^version = "[^"]*"/version = "$(NEW_VERSION)"/' lib/midden/Cargo.toml && rm -f lib/midden/Cargo.toml.bak; \
		echo "  updating tauri.conf.json..."; \
		sed -i.bak 's/"version": "[^"]*"/"version": "$(NEW_VERSION)"/' $(TAURI_DIR)/src-tauri/tauri.conf.json && rm -f $(TAURI_DIR)/src-tauri/tauri.conf.json.bak; \
		echo "  updating package.json files..."; \
		node -e "const fs=require('fs'); const j=JSON.parse(fs.readFileSync('package.json','utf8')); j.version='$(NEW_VERSION)'; fs.writeFileSync('package.json', JSON.stringify(j,null,4)+'\n');"; \
		(cd $(TAURI_DIR) && npm version $(NEW_VERSION) --no-git-tag-version --allow-same-version >/dev/null); \
		(cd client/spume && npm version $(NEW_VERSION) --no-git-tag-version --allow-same-version >/dev/null); \
		(cd client-codegen/freqhole-api-client && npm version $(NEW_VERSION) --no-git-tag-version --allow-same-version >/dev/null); \
		(cd lib/haruspex/ts && npm version $(NEW_VERSION) --no-git-tag-version --allow-same-version >/dev/null); \
		(cd lib/reliquary/ts && npm version $(NEW_VERSION) --no-git-tag-version --allow-same-version >/dev/null); \
		echo "  updating version.ts files..."; \
		sed -i.bak 's/VERSION = "[^"]*"/VERSION = "$(NEW_VERSION)"/' client/spume/src/version.ts && rm -f client/spume/src/version.ts.bak; \
		sed -i.bak 's/VERSION = "[^"]*"/VERSION = "$(NEW_VERSION)"/' $(TAURI_DIR)/src/version.ts && rm -f $(TAURI_DIR)/src/version.ts.bak; \
		sed -i.bak 's/VERSION = "[^"]*"/VERSION = "$(NEW_VERSION)"/' freqhole.net/src/version.ts && rm -f freqhole.net/src/version.ts.bak; \
		echo "  updating freqhole-config.toml..."; \
		sed -i.bak 's/^version = "[^"]*"/version = "$(NEW_VERSION)"/' assets/config/freqhole-config.toml && rm -f assets/config/freqhole-config.toml.bak; \
		echo "  updating about.html..."; \
		sed -i.bak 's/>v[0-9]*\.[0-9]*\.[0-9]*</>v$(NEW_VERSION)</' $(TAURI_DIR)/public/about.html && rm -f $(TAURI_DIR)/public/about.html.bak; \
		echo "  updating ios project version (CFBundleShortVersionString/CFBundleVersion)..."; \
		sed -i.bak 's/CFBundleShortVersionString: [0-9][^ ]*/CFBundleShortVersionString: $(NEW_VERSION)/' $(TAURI_DIR)/src-tauri/gen/apple/project.yml && rm -f $(TAURI_DIR)/src-tauri/gen/apple/project.yml.bak; \
		sed -i.bak 's/CFBundleVersion: "[^"]*"/CFBundleVersion: "$(NEW_VERSION)"/' $(TAURI_DIR)/src-tauri/gen/apple/project.yml && rm -f $(TAURI_DIR)/src-tauri/gen/apple/project.yml.bak; \
		sed -i.bak '/<key>CFBundleShortVersionString<\/key>/{n;s/<string>[^<]*<\/string>/<string>$(NEW_VERSION)<\/string>/;}' $(TAURI_DIR)/src-tauri/gen/apple/charnel_iOS/Info.plist && rm -f $(TAURI_DIR)/src-tauri/gen/apple/charnel_iOS/Info.plist.bak; \
		sed -i.bak '/<key>CFBundleVersion<\/key>/{n;s/<string>[^<]*<\/string>/<string>$(NEW_VERSION)<\/string>/;}' $(TAURI_DIR)/src-tauri/gen/apple/charnel_iOS/Info.plist && rm -f $(TAURI_DIR)/src-tauri/gen/apple/charnel_iOS/Info.plist.bak; \
		echo ""; \
		echo "version bumped to $(NEW_VERSION)"; \
		echo ""; \
		echo "verify changes with: git diff"; \
	fi

# database commands (from grimoire)
.PHONY: db-reset db-migrate db-prepare
# resets grimoire's own db AND haruspex's/reliquary's sibling dbs
# together, not just grimoire's. they're separate sqlite files under
# the same data dir, but haruspex's identity rows are keyed off a
# deterministic hash of grimoire's user ids (see
# grimoire/src/users/haruspex_bridge.rs) - resetting only grimoire.db
# leaves orphaned haruspex identityz rows behind (old user id -> old
# derived identity id, which no longer matches anything), and since
# identityz's username unique index isn't scoped to non-deleted rows,
# an orphan can permanently block that username from ever getting a
# fresh identity again ("UNIQUE constraint failed: identityz.username").
db-reset:
	@echo "resetting database..."
	@DB_PATH=$(shell echo $(DATABASE_URL) | sed 's|sqlite:||'); \
		BLOB_DB=$$(echo $$DB_PATH | sed 's|\.db$$|-blobdata.db|'); \
		DATA_DIR=$$(dirname "$$DB_PATH"); \
		rm -f "$$DB_PATH" "$$DB_PATH"-shm "$$DB_PATH"-wal "$$BLOB_DB"; \
		rm -f "$$DATA_DIR/haruspex.db" "$$DATA_DIR/haruspex.db"-shm "$$DATA_DIR/haruspex.db"-wal; \
		rm -f "$$DATA_DIR/reliquary.db" "$$DATA_DIR/reliquary.db"-shm "$$DATA_DIR/reliquary.db"-wal
	$(MAKE) db-migrate

db-migrate:
	@echo "running migrations..."
	mkdir -p data
	touch $(shell echo $(DATABASE_URL) | sed 's|sqlite:||')
	# run from repo root so the relative DATABASE_URL (sqlite:data/grimoire.db)
	# resolves against the same data/ dir created above. the views + blob-db
	# steps below also run from root.
	DATABASE_URL=$(DATABASE_URL) sqlx migrate run --source migrations
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
	# cargo sqlx prepare writes grimoire/.sqlx, so it must run from grimoire/.
	# a relative DATABASE_URL (sqlite:data/grimoire.db, as in ci) would resolve
	# against grimoire/ after the cd and fail to open the db. resolve it to an
	# absolute path here; an already-absolute url (sqlite:///... from .env) is
	# left as-is.
	@DB_PATH=$$(echo $(DATABASE_URL) | sed 's|^sqlite://||; s|^sqlite:||'); \
		case "$$DB_PATH" in /*) ;; *) DB_PATH=$(CURDIR)/$$DB_PATH ;; esac; \
		cd grimoire && DATABASE_URL=sqlite://$$DB_PATH cargo sqlx prepare

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
		--bin rathole \
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

.PHONY: db-reset db-migrate db-prepare
rathole-dev:
	cargo run -p cli --bin rathole

.PHONY: ios-dev
ios-dev:
	cd $(TAURI_DIR) && npm run tauri ios dev "iPhone 15"
