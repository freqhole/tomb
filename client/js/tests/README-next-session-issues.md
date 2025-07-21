# 🔍 Next Session Issues - Test Suite Documentation

This directory contains comprehensive tests for the five key issues identified for the next development session. These tests serve as both documentation and implementation guides.

## 📋 Issues Overview

### 🐛 1. Song Row Update Reactivity Bug
**File:** `song-row-reactivity.test.ts`
**Priority:** HIGH
**Status:** BROKEN

Song rows don't immediately reflect changes after editing. The UI shows stale data until manual refresh or component remount.

**Key Tests:**
- Current broken behavior documentation
- Expected reactivity requirements
- Potential solutions (global signals, event bus, resource invalidation)
- Performance impact testing

### 🎵 2. Playlist Auto-Advance Audio Flow
**File:** `audio-autoadvance.test.ts`
**Priority:** HIGH
**Status:** MISSING

Audio player lacks playlist queue management and auto-advance functionality.

**Key Tests:**
- Queue management system
- Auto-advance on song end
- Next/previous controls
- Repeat modes (none/one/all)
- Error handling for missing files

### 🔄 3. Drag & Drop Error Handling
**File:** `dragdrop-error-handling.test.ts`
**Priority:** MEDIUM
**Status:** BROKEN

False "no audio files found" error appears during song reordering operations.

**Key Tests:**
- Improved drag type detection
- Event delegation fixes
- Contextual error messages
- Conflict resolution between handlers

### 🎨 4. Dynamic Background System
**File:** `dynamic-background.test.ts`
**Priority:** LOW
**Status:** MISSING

No dynamic background system exists. Backgrounds should change based on playlist/song context.

**Key Tests:**
- Background hierarchy (song > playlist > default)
- Smooth transitions
- Image preloading and caching
- Performance optimization
- Accessibility considerations

### 📱 5. Collapsible Sidebar Functionality
**File:** `collapsible-sidebar.test.ts`
**Priority:** MEDIUM
**Status:** MISSING

Sidebar is always expanded with no space-saving options.

**Key Tests:**
- Toggle functionality with animations
- State persistence in localStorage
- Responsive behavior
- Content adaptation (tooltips, icon-only mode)
- Accessibility features

## 🚀 Quick Start

### Running Tests

```bash
# Run all next session issue tests
npm test tests/next-session-issues.test.ts

# Run individual issue tests
npm test tests/components/song-row-reactivity.test.ts
npm test tests/components/audio-autoadvance.test.ts
npm test tests/components/dragdrop-error-handling.test.ts
npm test tests/components/dynamic-background.test.ts
npm test tests/components/collapsible-sidebar.test.ts

# Run tests by pattern
npm test -- --grep "Current Broken Behavior"
npm test -- --grep "Expected.*Behavior"
npm test -- --watch
```

### Test-Driven Development Workflow

1. **Discovery Phase**
   ```bash
   npm test -- --grep "Current Broken Behavior"
   ```
   Run these tests to understand exactly what's broken and missing.

2. **Design Phase**
   ```bash
   npm test -- --grep "Expected.*Behavior"
   ```
   Review expected behavior definitions to understand requirements.

3. **Implementation Phase**
   ```bash
   npm test -- --watch
   ```
   Use continuous testing during development.

4. **Validation Phase**
   ```bash
   npm test tests/next-session-issues.test.ts
   ```
   Final verification that all issues are resolved.

## 📊 Implementation Strategy

### Recommended Order

1. **Drag & Drop Error Handling** (1-2 hours)
   - Quick win, low complexity
   - Improves immediate user experience
   - Good confidence builder

2. **Song Row Update Reactivity** (2-3 hours)
   - High impact on overall system
   - Enables other features to work properly
   - Foundation for reactive updates

3. **Collapsible Sidebar** (2-3 hours)
   - Independent feature
   - Good user experience improvement
   - Moderate complexity

4. **Playlist Auto-Advance** (4-5 hours)
   - Core functionality enhancement
   - Requires significant audio service changes
   - High complexity but high value

5. **Dynamic Background System** (3-4 hours)
   - Visual polish
   - Can be implemented last
   - Nice-to-have feature

### Total Effort: 12-17 hours
**Recommended Session Length:** 6-8 hours (tackle 2-3 issues)

## 🔧 Technical Approaches

### Song Row Reactivity
- **Recommended:** Global signal approach
- **Implementation:** Create a song update signal that triggers resource refetch
- **Files to modify:** `SongRow.tsx`, `indexedDBService.ts`

### Audio Auto-Advance
- **Recommended:** Queue-based audio service enhancement
- **Implementation:** Add queue management and event-driven auto-advance
- **Files to modify:** `audioService.ts`, `AudioPlayer.tsx`

### Drag & Drop Errors
- **Recommended:** Enhanced drag detection
- **Implementation:** Improve DataTransfer analysis and event handling
- **Files to modify:** Main Playlistz component, SongRow drag handlers

### Dynamic Background
- **Recommended:** Service-based approach with CSS transitions
- **Implementation:** Background service with image hierarchy
- **Files to create:** `backgroundService.ts`, CSS modifications

### Collapsible Sidebar
- **Recommended:** Toggle with responsive behavior
- **Implementation:** State management with localStorage persistence
- **Files to modify:** `PlaylistSidebar.tsx`, CSS for animations

## 📈 Success Criteria

Each issue has specific success criteria defined in the test files:

- **Song Row Reactivity:** Immediate UI updates after edits
- **Audio Auto-Advance:** Seamless playlist playback flow
- **Drag & Drop:** No false errors, clear feedback
- **Dynamic Background:** Context-aware background changes
- **Collapsible Sidebar:** Smooth toggle with persistence

## 🧪 Test Structure

Each test file follows this structure:

1. **Current Broken Behavior**
   - Documents exactly what's wrong
   - Reproduces the bug/missing feature
   - Provides clear evidence of the issue

2. **Expected Correct Behavior**
   - Defines requirements and specifications
   - Outlines the desired user experience
   - Sets clear goals for implementation

3. **Solution Testing**
   - Tests different approaches
   - Validates technical solutions
   - Provides implementation guidance

4. **Integration Testing**
   - Tests complete workflows
   - Verifies cross-component interactions
   - Ensures no regressions

5. **Performance & Accessibility**
   - Validates performance requirements
   - Tests accessibility features
   - Ensures responsive behavior

## 📝 Development Guidelines

### Before Starting
- [ ] Review all test files to understand requirements
- [ ] Set up development environment with hot reload
- [ ] Create feature branches for each issue
- [ ] Backup current working state

### During Implementation
- [ ] Run tests continuously during development
- [ ] Follow test-driven development practices
- [ ] Test on different screen sizes and devices
- [ ] Verify accessibility with screen readers

### Before Finishing
- [ ] Run complete test suite
- [ ] Test manually for regressions
- [ ] Update documentation
- [ ] Commit with descriptive messages
- [ ] Create comprehensive pull request

## 🔍 Debugging Tips

### Common Issues
- **Tests failing:** Check that all dependencies are mocked properly
- **Component not updating:** Verify reactive signals are connected
- **Animations not working:** Check CSS classes and transition timing
- **State not persisting:** Verify localStorage mocks and real storage

### Useful Commands
```bash
# Run tests with verbose output
npm test -- --verbose

# Run specific test by name
npm test -- --grep "specific test name"

# Run tests in watch mode with coverage
npm test -- --watch --coverage

# Debug failing tests
npm test -- --no-coverage --verbose tests/components/song-row-reactivity.test.ts
```

## 🎯 Next Steps

1. Start by running the master test suite to get an overview
2. Choose your first issue (recommended: drag & drop errors)
3. Read the corresponding test file thoroughly
4. Implement using test-driven development
5. Move to the next issue when tests pass
6. Update this documentation with any discoveries

## 📚 Additional Resources

- **SolidJS Reactivity:** Understanding signals and createResource
- **Audio Web API:** For playlist queue management
- **CSS Transitions:** For smooth animations
- **localStorage API:** For state persistence
- **Accessibility Guidelines:** WCAG compliance for new features

---

**Happy Coding! 🚀**

Use these tests as your guide and you'll have a clear path to implementing all five issues successfully.
