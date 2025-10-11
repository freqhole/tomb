# Feature-Focused Development Plan

## Goal

Build new features that naturally reveal good abstractions, focusing on server connection and API interface design.

## New Features to Build

### 1. Top-Level Navigation & Routing

- New root-level compositions
- Initial loading logic and UI
- Server discovery and connection flow

### 2. IndexedDB Foundation

- Server connection state management
- API interface abstraction
- Data persistence patterns

### 3. Server/Client API Interface

- Clear boundaries between server and client
- Future-proof for different implementations (HTTP, WebSocket, etc.)
- Server-agnostic data layer

## Development Approach

### Start with Concrete Features

- Build the server connection flow first
- Let the IndexedDB design emerge from actual needs
- Extract library code when patterns become clear

### Focus Areas

**Server Connection Management**

- [ ] Server discovery UI
- [ ] Connection state persistence
- [ ] Auth flow per server
- [ ] Error handling and reconnection

**API Interface Design**

- [ ] Define clear contracts between client/server
- [ ] Version-agnostic data structures
- [ ] Transport-agnostic implementations

**Foundation Patterns**

- [ ] IndexedDB utilities that actually get used
- [ ] Solid.js patterns that solve real problems
- [ ] Component compositions that work well together

## Benefits of This Approach

- **Immediate value** from new features
- **Natural abstractions** emerge from solving real problems
- **Less over-engineering** and theoretical design
- **Clear API boundaries** discovered through actual usage

---

**Next Action:** Start building the server connection feature and let the architecture emerge.
