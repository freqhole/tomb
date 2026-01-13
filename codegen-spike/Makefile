# makefile for ts client codegen

.PHONY: all clean server test

# default: generate client and typecheck
all: clean
	cargo run codegen
	cd freqhole-api-client && npm install --silent && npm run typecheck

# start the test server
server:
	cargo run server

# run integration tests
test:
	@echo "starting server..."
	@cargo run server > /dev/null 2>&1 & echo $$! > .server.pid
	@sleep 1
	@echo "running integration tests..."
	@cd freqhole-api-client && npm test || (kill `cat ../.server.pid` 2>/dev/null; rm -f ../.server.pid; exit 1)
	@kill `cat .server.pid` 2>/dev/null; rm -f .server.pid
	@echo "✓ tests passed"

# yeet any old generated files
clean:
	rm -rf freqhole-api-client/src/codegen
