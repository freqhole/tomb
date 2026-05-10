# rathole Makefile — tty + web build targets

.PHONY: build build-tty build-web build-web-release check check-tty check-web run serve clean deploy-spume

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
	$(WASM_ENV) cargo check -p rathole --target wasm32-unknown-unknown --lib

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
# extra deps. visit http://localhost:5173/
serve: build-web
	@echo "open http://localhost:5173/"
	python3 -m http.server 5173

clean:
	cargo clean -p rathole
	rm -rf pkg/

# ----------------------------------------------------------------------
# deploy: stage the wasm bundle + a rathole.html into spume's dist
# folder, so cloudflare pages serves it at /rathole.html alongside
# the rest of spume. run *after* spume's `npm run build` so we don't
# get clobbered by vite. paths in the staged html are rewritten to
# point at /rathole/pkg/ (absolute) so navigation from any subpath
# resolves correctly.
#
# the committed `pkg/` artifacts are used as-is — cloudflare doesn't
# need a rust toolchain. refresh them locally with `make build-web-release`
# before committing when rathole's wasm changes.
# ----------------------------------------------------------------------
SPUME_DIST ?= ../spume/dist
deploy-spume:
	@if [ ! -d "$(SPUME_DIST)" ]; then \
		echo "error: $(SPUME_DIST) not found. run spume's npm run build first." >&2; \
		exit 1; \
	fi
	@if [ ! -f pkg/rathole.js ] || [ ! -f pkg/rathole_bg.wasm ]; then \
		echo "error: pkg/ artifacts missing. run 'make build-web-release' first." >&2; \
		exit 1; \
	fi
	mkdir -p $(SPUME_DIST)/rathole/pkg
	cp pkg/rathole.js pkg/rathole_bg.wasm $(SPUME_DIST)/rathole/pkg/
	# rewrite ./pkg/ -> /rathole/pkg/ so the html works at /rathole.html
	sed 's|\./pkg/|/rathole/pkg/|g' index.html > $(SPUME_DIST)/rathole.html
	@echo "staged rathole.html + pkg into $(SPUME_DIST)"
