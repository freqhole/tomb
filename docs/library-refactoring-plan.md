# Library Refactoring Plan

## Goal

Extract `client/js/` into a single `freqhole-library` npm package while building new compositions with multi-server support.

## Approach: In-Place Development

**Structure:**

```
tomb/
├── client/js/               # existing (keep working)
├── freqhole-library/        # NEW single npm package
│   ├── src/
│   │   ├── api/            # server API abstraction
│   │   ├── components/     # solid-js components
│   │   ├── hooks/          # reactive patterns
│   │   └── utils/          # utilities
│   └── package.json
└── compositions/
    └── freqhole-v2/        # NEW composition using library
        ├── src/
        │   ├── app.tsx     # multi-server, new loading UI
        │   └── layouts/    # new layout framework
        └── package.json
```

## Composition Strategy Decision

**Options:**

- A) Atomic components + composition functions
- B) Compound components with render props
- C) Headless components + styled versions

**Recommendation:** C) Headless + styled (best for multi-server, multi-composition)

## Phase 1: Setup & Core API (1 week)

### Tasks

- [ ] Create `freqhole-library/` directory with package.json
- [ ] Setup TypeScript, Vitest, build tools
- [ ] Extract server API abstraction with multi-server support
- [ ] Create server connection management

### Multi-Server Requirements

- [ ] Server discovery/connection state in IndexedDB
- [ ] API client that accepts server URL
- [ ] Auth state per server
- [ ] Data isolation per server

### Core API Extraction

From `client/js/src/lib/`:

- [ ] `api-client.ts` → `freqhole-library/src/api/client.ts`
- [ ] `api-spec.ts` → `freqhole-library/src/api/types.ts`
- [ ] `websocket-client.ts` → `freqhole-library/src/api/websocket.ts`
- [ ] All schemas → `freqhole-library/src/api/schemas/`

## Phase 2: Component Library (2 weeks)

### Extract to `freqhole-library/src/components/`

- [ ] Data fetching hooks (headless)
- [ ] Styled component versions
- [ ] Layout primitives (headers, containers, rows)
- [ ] Form components
- [ ] Media player components

### Migration Strategy

1. **Extract to library** → test in isolation
2. **Import in freqhole-v2** → validate works
3. **Replace in existing freqhole** → when stable

## Phase 3: New Composition (1 week)

### Create `compositions/freqhole-v2/`

- [ ] Multi-server selection UI
- [ ] Improved loading/startup flow
- [ ] New layout framework using library components
- [ ] Server state management (IndexedDB)

### Features

- [ ] Server connection picker
- [ ] Per-server data isolation
- [ ] Better initial loading UI
- [ ] Responsive layout system

## Phase 4: Progressive Migration (ongoing)

### Strategy

- [ ] Library components replace freqhole parts incrementally
- [ ] Keep existing freqhole working during transition
- [ ] Move features when library version is stable

## Decision Points

### After Phase 1

- [ ] Validate multi-server API design
- [ ] Confirm library package structure

### After Phase 2

- [ ] Approve component composition approach
- [ ] Test library integration patterns

### After Phase 3

- [ ] Evaluate freqhole-v2 vs existing freqhole
- [ ] Plan full migration timeline

## Open Questions

1. **Component Docs:** Try Storybook again vs custom demo pages?
2. **Server Discovery:** Manual URL entry vs auto-discovery?
3. **Data Migration:** How to handle existing IndexedDB data?
4. **Authentication:** Per-server auth state management?

## Success Criteria

- [ ] `freqhole-library` builds and publishes
- [ ] freqhole-v2 demonstrates multi-server support
- [ ] Clear migration path from existing code
- [ ] Library components are reusable across compositions

## Key Benefits

- **Keep existing working** while building new
- **Single package** simplifies distribution
- **Multi-server support** enables broader use
- **Clear library boundaries** improve stability
- **Multiple compositions** enable different UX approaches

---

**Next Action:** Create `freqhole-library/` directory and start Phase 1.
