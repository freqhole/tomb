# dumb-player local Makefile
# self-contained tauri audio test app — does NOT touch tomb's Makefile.
#
# common targets:
#   make dev                   -- run dev server (vite + tauri dev)
#   make build-tauri-linux-intel
#   make build-tauri-linux-arm64
#   make build-flatpak-intel
#   make build-flatpak-arm64
#   make build-all-linux       -- intel+arm64 deb/rpm + both flatpaks
#   make clean
#
# requires docker for the linux/flatpak targets.

VERSION := 0.0.0
OUT     := build
PWD     := $(shell pwd)

.PHONY: help
help:
	@echo "dumb-player targets:"
	@echo "  make dev"
	@echo "  make build-tauri-linux-intel"
	@echo "  make build-tauri-linux-arm64"
	@echo "  make build-flatpak-intel"
	@echo "  make build-flatpak-arm64"
	@echo "  make build-all-linux"
	@echo "  make clean"

.PHONY: dev
dev:
	npm install
	npm run tauri dev

.PHONY: build-tauri-linux-intel
build-tauri-linux-intel:
	@echo "building dumb-player for Linux x86_64 via Docker..."
	docker build -f Dockerfile.tauri -t dumb-player-tauri-builder-amd64 \
		--platform linux/amd64 \
		--build-arg TARGET_ARCH=x86_64-unknown-linux-gnu .
	@mkdir -p $(OUT)/$(VERSION)
	docker run --rm -v $(PWD)/$(OUT)/$(VERSION):/output dumb-player-tauri-builder-amd64 \
		sh -c "cp /app/src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/deb/*.deb /output/dumb-player_$(VERSION)_x86_64.deb && \
		       cp /app/src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/rpm/*.rpm /output/dumb-player_$(VERSION)_x86_64.rpm"
	@echo "built: $(OUT)/$(VERSION)/dumb-player_$(VERSION)_x86_64.deb"

.PHONY: build-tauri-linux-arm64
build-tauri-linux-arm64:
	@echo "building dumb-player for Linux aarch64 via Docker..."
	docker build -f Dockerfile.tauri -t dumb-player-tauri-builder-arm64 \
		--platform linux/arm64 \
		--build-arg TARGET_ARCH=aarch64-unknown-linux-gnu .
	@mkdir -p $(OUT)/$(VERSION)
	docker run --rm -v $(PWD)/$(OUT)/$(VERSION):/output dumb-player-tauri-builder-arm64 \
		sh -c "cp /app/src-tauri/target/aarch64-unknown-linux-gnu/release/bundle/deb/*.deb /output/dumb-player_$(VERSION)_aarch64.deb && \
		       cp /app/src-tauri/target/aarch64-unknown-linux-gnu/release/bundle/rpm/*.rpm /output/dumb-player_$(VERSION)_aarch64.rpm"
	@echo "built: $(OUT)/$(VERSION)/dumb-player_$(VERSION)_aarch64.deb"

.PHONY: build-flatpak-builder-intel
build-flatpak-builder-intel:
	docker build -f Dockerfile.flatpak -t dumb-player-flatpak-builder-amd64 --platform linux/amd64 .

.PHONY: build-flatpak-builder-arm64
build-flatpak-builder-arm64:
	docker build -f Dockerfile.flatpak -t dumb-player-flatpak-builder-arm64 --platform linux/arm64 .

.PHONY: build-flatpak-intel
build-flatpak-intel: $(OUT)/$(VERSION)/dumb-player_$(VERSION)_x86_64.deb build-flatpak-builder-intel
	docker run --rm --privileged \
		-v $(PWD)/$(OUT)/$(VERSION):/debs:ro \
		-v $(PWD)/$(OUT)/$(VERSION):/output \
		dumb-player-flatpak-builder-amd64 \
		/debs/dumb-player_$(VERSION)_x86_64.deb /output/dumb-player_$(VERSION)_x86_64.flatpak x86_64
	@echo "built: $(OUT)/$(VERSION)/dumb-player_$(VERSION)_x86_64.flatpak"

.PHONY: build-flatpak-arm64
build-flatpak-arm64: $(OUT)/$(VERSION)/dumb-player_$(VERSION)_aarch64.deb build-flatpak-builder-arm64
	docker run --rm --privileged \
		-v $(PWD)/$(OUT)/$(VERSION):/debs:ro \
		-v $(PWD)/$(OUT)/$(VERSION):/output \
		dumb-player-flatpak-builder-arm64 \
		/debs/dumb-player_$(VERSION)_aarch64.deb /output/dumb-player_$(VERSION)_aarch64.flatpak aarch64
	@echo "built: $(OUT)/$(VERSION)/dumb-player_$(VERSION)_aarch64.flatpak"

# convenience: build .deb if missing for flatpak rules
$(OUT)/$(VERSION)/dumb-player_$(VERSION)_x86_64.deb:
	$(MAKE) build-tauri-linux-intel

$(OUT)/$(VERSION)/dumb-player_$(VERSION)_aarch64.deb:
	$(MAKE) build-tauri-linux-arm64

.PHONY: build-all-linux
build-all-linux: build-tauri-linux-intel build-tauri-linux-arm64 build-flatpak-intel build-flatpak-arm64

.PHONY: clean
clean:
	rm -rf $(OUT) src-tauri/target dist node_modules
