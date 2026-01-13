# Makefile for codegen spike

.PHONY: all clean server

# Default: generate client and typecheck
all: clean
	cargo run codegen
	cd freqhole-api-client && npm install --silent && npm run typecheck

# Start the server
server:
	cargo run server

# Clean generated files
clean:
	rm -rf freqhole-api-client/src
