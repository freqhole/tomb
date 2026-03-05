# ruhroh-wasm build commands

# LLVM paths (required for wasm32 target on macOS with Apple Silicon)
LLVM_CC := /opt/homebrew/opt/llvm/bin/clang
LLVM_AR := /opt/homebrew/opt/llvm/bin/llvm-ar

# Build WASM (dev mode)
.PHONY: build
build:
	CC=$(LLVM_CC) AR=$(LLVM_AR) wasm-pack build --dev --weak-refs --reference-types -t bundler

# Build WASM (release mode, optimized)
.PHONY: build-release
build-release:
	CC=$(LLVM_CC) AR=$(LLVM_AR) wasm-pack build --release --weak-refs --reference-types -t bundler

# Run dev server (after building)
.PHONY: dev
dev:
	cd www && npm run dev

# Build + run dev server
.PHONY: serve
serve: build dev

# Clean build artifacts
.PHONY: clean
clean:
	rm -rf pkg target
