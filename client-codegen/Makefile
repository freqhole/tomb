# makefile for ts client codegen

.PHONY: all clean server test

# default: generate client and typecheck
all: clean
	cargo run -- generate
	cd freqhole-api-client && npm install --silent && npm run typecheck

# clean generated files
# yeet any old generated files
clean:
	rm -rf freqhole-api-client/src/codegen
