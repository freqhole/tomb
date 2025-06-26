# Sync Examples

Example usage patterns for the client-side sync system.

## Files

- **`demo-example.ts`** - Mock sync demo with fake data and event logging
- **`example-usage.ts`** - Real-world usage patterns with API integration

## Running Examples

```bash
# Compile first
npm run build:lib

# Then run with Node.js
node -e "import('./dist/examples/sync/demo-example.js').then(m => m.runSyncDemo())"
node -e "import('./dist/examples/sync/example-usage.js').then(m => m.runAllExamples())"
```

## Key Patterns

- Event-driven sync monitoring
- Conflict resolution strategies
- Offline/online state handling
- Progress tracking and pause/resume
