# Makefile for building freqhole server and CLI binaries
# Supports cross-compilation for Raspberry Pi targets
#
# Setup (run once):
#
# Add Rust targets:
#   rustup target add armv7-unknown-linux-gnueabihf  # 32-bit Pi
#   rustup target add aarch64-unknown-linux-gnu      # 64-bit Pi
#
# Install system dependencies:
#
# macOS (via Homebrew):
#   brew install messense/macos-cross-toolchains/armv7-unknown-linux-gnueabihf
#   brew install messense/macos-cross-toolchains/aarch64-unknown-linux-gnu
#
# Linux (via apt-get):
#   sudo apt-get install gcc-arm-linux-gnueabihf gcc-aarch64-linux-gnu
#
# For Docker-based cross-compilation (recommended):
#   cargo install cross --git https://github.com/cross-rs/cross
#   Then use: make build-cross

# Configuration
VERSION := $(shell grep '^version = ' server/Cargo.toml | head -1 | cut -d '"' -f 2)
BUILD_DIR := target/freqhole/$(VERSION)
CURRENT_TARGET := $(shell rustc -vV | sed -n 's|host: ||p')

# Targets
PI_32_TARGET := armv7-unknown-linux-gnueabihf
PI_64_TARGET := aarch64-unknown-linux-gnu
X86_64_TARGET := x86_64-unknown-linux-gnu

# Build modes
RELEASE_MODE := --release
DEBUG_MODE :=

# Default target
.PHONY: all
all: build

# Build for current platform
.PHONY: build
build:
	@echo "Building for current platform: $(CURRENT_TARGET)"
	@mkdir -p $(BUILD_DIR)/$(CURRENT_TARGET)
	cargo build --package server --target $(CURRENT_TARGET) $(RELEASE_MODE)
	cargo build --package cli --target $(CURRENT_TARGET) $(RELEASE_MODE)
	cp target/$(CURRENT_TARGET)/release/server $(BUILD_DIR)/$(CURRENT_TARGET)/freqhole-server
	cp target/$(CURRENT_TARGET)/release/cli $(BUILD_DIR)/$(CURRENT_TARGET)/freqhole-cli
	@echo "✓ Binaries: $(BUILD_DIR)/$(CURRENT_TARGET)/"

# Debug build
.PHONY: build-debug
build-debug: RELEASE_MODE :=
build-debug:
	@echo "Building debug for current platform: $(CURRENT_TARGET)"
	@mkdir -p $(BUILD_DIR)/$(CURRENT_TARGET)
	cargo build --package server --target $(CURRENT_TARGET)
	cargo build --package cli --target $(CURRENT_TARGET)
	cp target/$(CURRENT_TARGET)/debug/server $(BUILD_DIR)/$(CURRENT_TARGET)/freqhole-server
	cp target/$(CURRENT_TARGET)/debug/cli $(BUILD_DIR)/$(CURRENT_TARGET)/freqhole-cli
	@echo "✓ Debug binaries: $(BUILD_DIR)/$(CURRENT_TARGET)/"

# Docker-based Pi build
.PHONY: build-pi
build-pi:
	@echo "Building for Raspberry Pi using Docker"
	@mkdir -p $(BUILD_DIR)/$(PI_64_TARGET)
	docker build -f Dockerfile.build -t freqhole-pi-builder .
	docker run --rm -v $(PWD)/$(BUILD_DIR)/$(PI_64_TARGET):/output freqhole-pi-builder \
		cp /app/target/aarch64-unknown-linux-gnu/release/server /output/freqhole-server
	docker run --rm -v $(PWD)/$(BUILD_DIR)/$(PI_64_TARGET):/output freqhole-pi-builder \
		cp /app/target/aarch64-unknown-linux-gnu/release/cli /output/freqhole-cli
	@echo "Pi binaries built: $(BUILD_DIR)/$(PI_64_TARGET)/"

# Docker-based x86_64 Linux build
.PHONY: build-linux
build-linux:
	@echo "Building for x86_64 Linux using Docker"
	@mkdir -p $(BUILD_DIR)/$(X86_64_TARGET)
	docker build -f Dockerfile.build.x86_64 -t freqhole-linux-builder . --platform linux/amd64
	docker run --rm -v $(PWD)/$(BUILD_DIR)/$(X86_64_TARGET):/output freqhole-linux-builder \
		cp /app/target/x86_64-unknown-linux-gnu/release/server /output/freqhole-server
	docker run --rm -v $(PWD)/$(BUILD_DIR)/$(X86_64_TARGET):/output freqhole-linux-builder \
		cp /app/target/x86_64-unknown-linux-gnu/release/cli /output/freqhole-cli
	@echo "Linux x86_64 binaries built: $(BUILD_DIR)/$(X86_64_TARGET)/"

# Build for all targets including current platform if different
.PHONY: build-all
build-all:
	@if [ "$(CURRENT_TARGET)" != "$(PI_64_TARGET)" ] && [ "$(CURRENT_TARGET)" != "$(X86_64_TARGET)" ]; then \
		echo "Building for current platform: $(CURRENT_TARGET)"; \
		$(MAKE) build; \
	fi
	$(MAKE) build-pi
	$(MAKE) build-linux
	@echo "All targets built:"
	@if [ "$(CURRENT_TARGET)" != "$(PI_64_TARGET)" ] && [ "$(CURRENT_TARGET)" != "$(X86_64_TARGET)" ]; then \
		echo "  - Current platform: $(BUILD_DIR)/$(CURRENT_TARGET)/"; \
	fi
	@echo "  - Raspberry Pi: $(BUILD_DIR)/$(PI_64_TARGET)/"
	@echo "  - Linux x86_64: $(BUILD_DIR)/$(X86_64_TARGET)/"

# Clean build artifacts
.PHONY: clean
clean:
	cargo clean
	rm -rf target/freqhole

# Show build information
.PHONY: info
info:
	@echo "Freqhole Build Information"
	@echo "========================="
	@echo "Version: $(VERSION)"
	@echo "Build directory: $(BUILD_DIR)"
	@echo "Current target: $(CURRENT_TARGET)"
	@echo "Pi targets: $(PI_32_TARGET), $(PI_64_TARGET)"
	@echo "Linux targets: $(X86_64_TARGET)"
	@echo ""
	@echo "Available targets:"
	@echo "  make build         - Build for current platform (release)"
	@echo "  make build-debug   - Build for current platform (debug)"
	@echo "  make build-pi      - Build for Raspberry Pi using Docker"
	@echo "  make build-linux   - Build for x86_64 Linux using Docker"
	@echo "  make build-all     - Build for all targets (current + cross-compilation)"
	@echo "  make clean         - Clean build artifacts"
	@echo "  make info          - Show this information"
	@echo ""
	@echo "For cross-platform builds:"
	@echo "  1. Run: make build-pi (requires Docker) - for Raspberry Pi"
	@echo "  2. Run: make build-linux (requires Docker) - for x86_64 Linux"
	@echo "  3. Run: make build-all (requires Docker) - for all platforms"

# Help target
.PHONY: help
help: info
