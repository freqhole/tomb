# rathole Makefile — tty + web build targets

.PHONY: build build-tty build-web build-web-release check check-tty check-web run serve clean

# ----------------------------------------------------------------------
# llvm paths for wasm32-unknown-unknown on apple silicon. mirrors
# skein/midden/Makefile — apple's bundled clang can't target wasm.
#
# also prepends /opt/homebrew/bin to PATH so wasm-pack picks up
# brew's modern `wasm-opt` (binaryen) instead of its stale bundled
# copy. install with `brew install binaryen`.
# ----------------------------------------------------------------------
LLVM_CC := /opt/homebrew/opt/llvm/bin/clang
LLVM_AR := /opt/homebrew/opt/llvm/bin/llvm-ar
WASM_ENV := PATH=/opt/homebrew/bin:$$PATH CC=$(LLVM_CC) AR=$(LLVM_AR)

# ----------------------------------------------------------------------
# tty shell — terminal binary
# ----------------------------------------------------------------------
build-tty:
	cargo build -p rathole --bin rathole

check-tty:
	cargo check -p rathole

run:
	cargo run -p rathole

# ----------------------------------------------------------------------
# web shell — wasm bundle for the browser. requires wasm-pack:
#   cargo install wasm-pack
# output lives in client/rathole/pkg/
#
# `--weak-refs --reference-types` enable the modern wasm features
# rustc emits today; without them wasm-pack's bundled wasm-opt
# rejects the binary. (Cargo.toml also sets wasm-opt = false as
# a belt-and-suspenders.)
# ----------------------------------------------------------------------
check-web:
	cargo check -p rathole --target wasm32-unknown-unknown --lib

build-web:
	$(WASM_ENV) wasm-pack build --dev --weak-refs --reference-types --target web --out-dir pkg --no-typescript
	rm -f pkg/.gitignore

build-web-release:
	$(WASM_ENV) wasm-pack build --release --weak-refs --reference-types --target web --out-dir pkg --no-typescript
	rm -f pkg/.gitignore

# build both shells
build: build-tty build-web
check: check-tty check-web

# serve the demo index.html locally. uses python's stdlib so no
# extra deps. visit http://localhost:8000/
serve: build-web
	@echo "open http://localhost:8000/"
	python3 -m http.server 8000

clean:
	cargo clean -p rathole
	rm -rf pkg/
