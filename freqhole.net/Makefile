# freqhole.net — astro site + embedded scroll-coach demo
#
# the scroll-coach demo is built from client/spume (a sibling workspace)
# and emitted directly into public/demo/ so `astro build` picks it up.
# the npm `prebuild` script wires this into `npm run build` automatically,
# so plain `npm install && npm run build` is all a deploy host needs.

SPUME_DIR := ../client/spume
DEMO_OUT  := public/demo

.PHONY: help build-coach-demo build dev clean

help:
	@echo "freqhole.net make targets:"
	@echo "  build-coach-demo   build the spume coach webcomponent into $(DEMO_OUT)/"
	@echo "  build              full production build (npm run build runs prebuild)"
	@echo "  dev                run astro dev server (does NOT rebuild coach demo)"
	@echo "  clean              remove dist/ and $(DEMO_OUT)/freqhole-coach-demo.js"

build-coach-demo:
	@echo "building scroll-coach demo bundle into $(DEMO_OUT)/..."
	cd $(SPUME_DIR) && npm run build:coach:wc
	@echo "done."

build:
	npm run build

dev:
	npm run dev

clean:
	rm -rf dist
	rm -f $(DEMO_OUT)/freqhole-coach-demo.js
