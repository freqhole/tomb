# midden WASM build commands

# LLVM paths (homebrew on macOS; fall back to system toolchain elsewhere)
LLVM_CC := clang
LLVM_AR := llvm-ar

ifneq (,$(wildcard /opt/homebrew/opt/llvm/bin/clang))
LLVM_CC := /opt/homebrew/opt/llvm/bin/clang
endif

ifneq (,$(wildcard /opt/homebrew/opt/llvm/bin/llvm-ar))
LLVM_AR := /opt/homebrew/opt/llvm/bin/llvm-ar
endif

# Build WASM (dev mode)
.PHONY: build
build:
	CC=$(LLVM_CC) AR=$(LLVM_AR) wasm-pack build --dev --weak-refs --reference-types -t bundler
	rm -f pkg/.gitignore

# Build WASM (release mode, optimized)
.PHONY: build-release
build-release:
	CC=$(LLVM_CC) AR=$(LLVM_AR) wasm-pack build --release --weak-refs --reference-types -t bundler
	rm -f pkg/.gitignore

# Build WASM package for npm publish under @freqhole scope
.PHONY: build-release-npm
build-release-npm:
	CC=$(LLVM_CC) AR=$(LLVM_AR) wasm-pack build --release --weak-refs --reference-types -t bundler --scope freqhole
	rm -f pkg/.gitignore

# Clean build artifacts
.PHONY: clean
clean:
	rm -rf pkg target

# Fast check against the wasm32 target (no wasm-pack/wasm-bindgen involved,
# just `cargo check`) - useful in CI to catch wasm-only compile errors without
# paying for a full wasm-pack build. needs the homebrew LLVM clang/llvm-ar on
# macOS for crates with a C build script (e.g. ring, via iroh's tls stack).
.PHONY: check-wasm
check-wasm:
	CC=$(LLVM_CC) AR=$(LLVM_AR) cargo check --target wasm32-unknown-unknown
