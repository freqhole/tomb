# Makefile for codegen spike

.PHONY: all clean server test

# Default: generate client and typecheck
all: clean
	cargo run codegen
	cd freqhole-api-client && npm install --silent && npm run typecheck

# Start the server
server:
	cargo run server

# Run integration tests
test:
	@echo "Starting server..."
	@cargo run server > /dev/null 2>&1 & echo $$! > .server.pid
	@sleep 1
	@echo "Running tests..."
	@cd freqhole-api-client && npm test || (kill `cat ../.server.pid` 2>/dev/null; rm -f ../.server.pid; exit 1)
	@kill `cat .server.pid` 2>/dev/null; rm -f .server.pid
	@echo "✓ Tests passed"

# Clean generated files
clean:
	rm -rf freqhole-api-client/src/codegen
