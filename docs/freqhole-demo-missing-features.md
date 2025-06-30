# FreqholeDemo Missing Features Migration List

This document tracks all the advanced features from the original `infinite-data-grid.tsx` that need to be migrated to the new modular FreqholeDemo architecture.

## ✅ Completed Features

- [x] Panel resize with close-to-threshold behavior
- [x] Sticky header bars with close buttons
- [x] Edge toggle buttons for closed panels
- [x] Basic filter panel with form controls
- [x] Basic browse panel with name search
- [x] CSS conflicts resolved (flex-basis → width)
- [x] Form element overflow prevention
- [x] **Multi-select system (FULLY COMPLETE)**
- [x] **Selection toolbar component (MODULAR)**
- [x] **Clean selection hook architecture**
- [x] **🎉 THUMBNAIL SYSTEM FIXED** - Binary data → blob URLs working correctly
- [x] **Domain logic extraction** - Created `lib/media-utils.ts` and `lib/format-utils.ts`
- [x] **WebSocket data integration** - Real data from `useWebSocketFeed`, no more mock data

## 🎯 Immediate UX Improvements (Next Priority)

### **🚨 HIGH PRIORITY - Recently Discovered Missing Features**

_These features exist in the web-components infinite-data-grid and should be ported to FreqholeDemo_

- [x] **🎬 Popup/Preview System** - Double-click opens fullscreen preview modal ✅ COMPLETED
  - [x] **Image preview** - Full-screen image display with zoom capabilities ✅ COMPLETED
  - [x] **Video preview** - Native video player with controls ✅ COMPLETED
  - [x] **Audio preview** - Native audio player with controls ✅ COMPLETED
  - [x] **Metadata display** - Show ID, SHA256, size, created date, parent, local path ✅ COMPLETED
  - [x] **Smart close controls** - ESC key, click outside backdrop, X button ✅ COMPLETED
  - [x] **Error handling** - Graceful fallback for broken/unsupported media ✅ COMPLETED
  - [x] **Responsive sizing** - max-width: 80vw, max-height: 70vh ✅ COMPLETED

- [x] **⌨️ Enhanced Keyboard Shortcuts** - Professional-grade keyboard navigation ✅ COMPLETED
  - [x] **Fix Ctrl/Cmd+A text input interference** - Only trigger when NOT focused in text inputs ✅ COMPLETED
  - [x] **ESC key multi-purpose** - Close menus, clear selection, close popups ✅ COMPLETED
  - [x] **Delete/Backspace** - Delete selected items with confirmation ✅ COMPLETED
  - [x] **Arrow keys** - Navigate through items with focus management ✅ COMPLETED
  - [x] **Enter** - Open preview for focused/selected item ✅ COMPLETED
  - [x] **Space** - Toggle selection of focused item ✅ COMPLETED
  - [x] **Page Up/Down** - Jump 10 items up/down ✅ COMPLETED
  - [x] **Home/End** - Jump to first/last item ✅ COMPLETED
  - [x] **Tab navigation** - Proper accessibility support ✅ COMPLETED
  - [x] **Vim-style navigation** - j/k for up/down, g/G for first/last ✅ COMPLETED
  - [x] **Visual focus indicators** - Clear outline for keyboard-focused items ✅ COMPLETED

- [x] **🎛️ Advanced Action Menu System** - Professional context menus ✅ COMPLETED
  - [x] **Smart menu positioning** - Auto-adjust to stay within viewport bounds ✅ COMPLETED
  - [x] **Download functionality** - Individual and bulk download support ✅ COMPLETED
  - [x] **Context-sensitive options** - Different actions based on file type ✅ COMPLETED
  - [x] **Right-click context menu** - Same menu triggered by right-click ✅ COMPLETED
  - [x] **Click outside to close** - Proper menu dismissal behavior ✅ COMPLETED
  - [x] **ESC key to close** - Keyboard dismissal support ✅ COMPLETED
  - [ ] **Keyboard accessibility** - Tab navigation, Enter to activate

- [x] **🎯 Enhanced Selection Features** - Professional multi-select capabilities ✅ MOSTLY COMPLETED
  - [x] **Improved drag selection** - Visual feedback during drag operations ✅ COMPLETED
  - [x] **Shift+click range enhancement** - Better visual feedback for ranges ✅ COMPLETED
  - [x] **Ctrl/Cmd+click refinement** - Smoother toggle selection behavior ✅ COMPLETED
  - [x] **Bulk selection toolbar** - Professional toolbar with selection count ✅ COMPLETED
  - [x] **Bulk action menu (⋯ More button)** - Download all, delete all, clear selection ✅ COMPLETED
  - [x] **Better click/double-click handling** - Prevent interference between actions ✅ COMPLETED
  - [x] **Text selection prevention** - Prevent unwanted text selection during operations ✅ COMPLETED
  - [x] **Context-aware right-click** - Shows bulk menu when multiple selected ✅ COMPLETED

## 🎯 Immediate UX Improvements (Next Priority)

### Selection Toolbar Improvements

- [ ] **Move selection toolbar to bottom** - Move from top center to bottom center of page
- [ ] **Multi-select only** - Only show toolbar when 2+ items selected (not for single selection)
- [ ] **Replace "Clear" with "×"** - Use consistent close button instead of "Clear" text button
- [ ] **Improve positioning** - Bottom placement for better workflow

### Text Selection UX Issues

- [ ] **Prevent text selection on Shift+click** - Simple `event.preventDefault()` on shift+click to avoid unwanted text selection
- [ ] **Prevent text selection on click handlers** - Add `user-select: none` to action buttons/clickable areas (optional, low priority)

### Visual/Styling Improvements

- [ ] **Fix selected row hover styles** - Currently hover style overrides selected style, making selected rows look unselected on hover
- [ ] **Improve selection visual hierarchy** - Ensure selected state is always visible even during hover/focus states

### Architecture Cleanup (High Priority)

- [x] **Extract domain logic to lib/** - ✅ DONE: Created framework-agnostic utility libraries
- [x] **Create `lib/media-utils.ts`** - ✅ DONE: Pure functions for `getDisplayFilename`, etc.
- [x] **Create `lib/format-utils.ts`** - ✅ DONE: Generic formatting functions (`formatBytes`, etc.)
- [x] **No SolidJS in lib/** - ✅ DONE: All lib/ functions are framework-agnostic
- [x] **Import lib functions** - ✅ DONE: Components now import from lib/ instead of inline functions

## 🔧 Future-Proofing & Code Quality Improvements

### **🛡️ Prevent Future Component Integration Hell**

- [ ] **Create component integration tests** - Automated tests that verify working examples continue to work
- [ ] **Standardize data flow patterns** - Document and enforce consistent patterns between working components
- [ ] **Add prop validation** - TypeScript interfaces to catch data structure mismatches early
- [ ] **Create component debugging utilities** - Reusable debug logging hooks/components for data flow inspection
- [ ] **Establish "golden reference" pattern** - When something works, immediately create minimal reproducible example

### **📋 Documentation & Pattern Library**

- [ ] **Document working patterns** - Create guide for "How thumbnails work" based on successful MediaBlobFeedItem
- [ ] **Component integration checklist** - Step-by-step verification when adapting working patterns to new components
- [ ] **Data flow diagrams** - Visual documentation of WebSocket → Hook → Component → UI data transformations
- [ ] **Common pitfalls guide** - Document specific issues encountered (e.g., HTTP endpoints vs blob URLs)

### **🔧 Technical Debt & Architecture**

- [ ] **Unify thumbnail handling** - Create shared thumbnail component/hook used by both working examples
- [ ] **Consistent error handling** - Standardize how components handle missing data, loading states, errors
- [ ] **Remove debug logging** - Clean up temporary debug code in MediaBlobFeedItem and useWebSocketFeed
- [ ] **Type safety improvements** - Stronger typing around MediaBlob.metadata to prevent data access issues

## 🚧 Missing Core Features

### 1. Multi-Select System

- [x] **Shift+Click range selection** - Select from last clicked to current
- [x] **Ctrl/Cmd+Click toggle selection** - Add/remove individual items
- [x] **Drag selection box** - Visual rectangle selection with mouse drag
- [x] **Select All (Ctrl/Cmd+A)** - Keyboard shortcut to select all visible items
- [x] **Selection persistence** - Save/restore selected items in localStorage
- [x] **Selection counter** - Show "X items selected" in UI
- [x] **Bulk action buttons** - Download, More (...) actions for selected items
- [x] **Clear selection** - Button and Escape key to clear selection

### 2. Advanced Click Handling

- [x] **Single click actions** - Immediate selection (use native onClick)
- [x] **Double-click preview** - Open popup viewer (use native onDblClick) - _placeholder implemented_
- [ ] **Right-click context menu** - Show action menu with coordinates
- [ ] **Context menu auto-selection** - Right-click unselected item selects it first

### 3. Header Sorting Logic

- [ ] **Triple-click sort cycle** - asc → desc → null (unsorted) → asc
- [ ] **Sort direction indicators** - Visual arrows in headers (↑↓)
- [ ] **Sort field persistence** - Save/restore sort state
- [ ] **Default sort reset** - Third click returns to unsorted state

### 4. Enhanced View Modes

Current view modes are basic. Original had much more elaborate differences:

#### Compact Mode

- [ ] **Row height: 35px** (vs current basic)
- [ ] **Hide thumbnail column** completely
- [ ] **Compressed text** - Smaller fonts, tighter spacing
- [ ] **Minimal padding** - Optimize for data density

#### Default Mode

- [ ] **Row height: 50px** with balanced layout
- [ ] **Standard thumbnails: 40px** squares
- [ ] **Normal text sizing** - 14px base font

#### Detailed Mode

- [ ] **Row height: 120px** for expanded content
- [ ] **Large thumbnails: 100px** squares
- [ ] **Multi-line content** - Show more metadata per row
- [ ] **Detailed row layout** - Top/bottom content sections
- [ ] **Enhanced file info** - More visible metadata

### 6. Advanced Column Layout & Data

- [ ] **Move thumbnail to first column** - Thumbnail should be leftmost column for better visual hierarchy
- [ ] **Hide ID column by default** - ID column should be hidden initially (still available in column settings)
- [ ] **Add blob name column** - Dedicated column for file/blob name using `getDisplayFilename()` logic
- [ ] **Smart column ordering** - Logical order: thumbnail, name, type, mime, size, dates, actions
- [ ] **Column visibility presets** - Default vs detailed vs compact column sets

### 7. Advanced Thumbnail System

**Note**: Leverage existing media blob library infrastructure where possible

- [ ] **Integrate with existing thumbnail generation** - Use `getThumbnails()`, `hasThumbnails()`, `getThumbnailUrl()` from MediaBlobFeedItem
- [ ] **Thumbnail placeholders** - Use existing `showThumbnailPlaceholder` state pattern with pulse animation
- [ ] **Auto-request thumbnails** - Use existing `onMount()` auto-request pattern with `onGetThumbnails` callback
- [ ] **Thumbnail error handling** - Use existing `createDataUrl()` and API fallback logic
- [ ] **File type icons** - Use existing `getFileTypeIcon()` function (🖼️🎥🎵📄📝📎)
- [ ] **Thumbnail badges** - Use existing metadata detection: `item.metadata?.has_thumbnails`
- [ ] **Data URL creation** - Use existing `createDataUrl(thumbnail.data, mimeType)` helper
- [ ] **Lazy loading** - Integrate with existing `loading="lazy"` img attributes

### 8. Action Menu System (⋯ Button) - ENHANCED WITH WEB-COMPONENTS FEATURES

- [x] **Per-row action button** - Three dots (⋯) button in actions column ✅ COMPLETED
- [x] **🔧 Smart menu positioning** - Auto-adjust to viewport edges (from web-components) ✅ COMPLETED
- [x] **📦 Download functionality** - Individual file download (from web-components) ✅ COMPLETED
- [x] **🎯 Context-sensitive menu** - Different options based on file type ✅ COMPLETED
- [x] **🖱️ Right-click context menu** - Same menu on right-click ✅ COMPLETED
- [x] **🖱️ Click outside dismissal** - Proper menu close behavior (from web-components) ✅ COMPLETED
- [x] **⌨️ ESC key dismissal** - Close menu with Escape key ✅ COMPLETED
- [x] **📋 Copy URL action** - Copy download URL to clipboard ✅ COMPLETED
- [x] **📦 Bulk download** - Download multiple selected items ✅ COMPLETED
- [x] **✖️ Clear selection action** - Clear selection from bulk menu ✅ COMPLETED
- [ ] **⌨️ Keyboard accessibility** - Tab navigation, Enter activation
- [ ] **🎵 Add to Playlist action** - Add media items to playlists
- [ ] **🗑️ Delete confirmation** - Delete with proper confirmation dialog

### 9. Preview Popup System - ENHANCED WITH WEB-COMPONENTS FEATURES

- [x] **🖼️ Image preview modal** - Full-screen image display (from web-components) ✅ COMPLETED
- [x] **🎥 Video preview modal** - Native video player with controls (from web-components) ✅ COMPLETED
- [x] **🎵 Audio preview modal** - Native audio player interface (from web-components) ✅ COMPLETED
- [x] **📊 Metadata display** - ID, SHA256, size, dates, parent, local path (from web-components) ✅ COMPLETED
- [x] **🎯 Smart close controls** - X button, ESC key, backdrop click (from web-components) ✅ COMPLETED
- [x] **📱 Responsive sizing** - max-width: 80vw, max-height: 70vh (from web-components) ✅ COMPLETED
- [x] **🛡️ Error handling** - Graceful fallback for broken media (from web-components) ✅ COMPLETED
- [ ] **⌨️ Keyboard navigation** - Arrow keys to navigate between items
- [x] **🖱️ Double-click trigger** - Open preview on double-click (from web-components) ✅ COMPLETED
- [x] **📎 Unsupported file fallback** - Download link for non-previewable files (from web-components) ✅ COMPLETED

### 10. Enhanced Column System

- [ ] **Column visibility toggles** - Show/hide specific columns
- [ ] **Column settings panel** - Expandable settings section
- [ ] **Smart column widths** - Responsive width adjustments
- [ ] **Column value processing** - Custom formatters (bytes, dates, etc.)
- [ ] **Column-specific rendering** - ID truncation, SHA256 display, etc.
- [ ] **Smart blob name handling** - Use existing `getDisplayFilename()` logic:
  - Checks `metadata.originalName`, `metadata.filename`, `metadata.original_filename`
  - Falls back to `item.filename`, `local_path` basename, or SHA256 snippet

### 11. Advanced Filtering

Current filtering is basic. Missing:

- [ ] **MIME category filter** - Group by image/video/audio/text
- [ ] **Blob type filter** - original/thumbnail/waveform/preview
- [ ] **Size range sliders** - Min/max size with UI sliders
- [ ] **Parent/child filtering** - Has parent, has local path toggles
- [ ] **Advanced filter combinations** - AND/OR logic
- [ ] **Filter presets** - Save common filter combinations

### 12. Keyboard Shortcuts - ENHANCED WITH WEB-COMPONENTS FEATURES

- [x] **Escape** - Clear selection, close menus, close popup ✅ COMPLETED
- [x] **🚨 CRITICAL: Fix Ctrl/Cmd+A text input interference** - Should NOT trigger when focused in text inputs ✅ COMPLETED
- [x] **Ctrl/Cmd+A** - Select all visible items ✅ COMPLETED
- [x] **Arrow keys** - Navigate through items with focus management ✅ COMPLETED
- [x] **Enter** - Open preview for focused/selected item ✅ COMPLETED
- [x] **Delete/Backspace** - Delete selected items ✅ COMPLETED
- [x] **Space** - Toggle selection of focused item ✅ COMPLETED
- [x] **⌨️ Global keyboard handler** - Proper event delegation ✅ COMPLETED
- [x] **🎯 Focus management** - Visual focus indicators and keyboard navigation ✅ COMPLETED
- [x] **🛡️ Input field protection** - Don't interfere with form field shortcuts ✅ COMPLETED
- [x] **Page Up/Down** - Navigate 10 items at a time ✅ COMPLETED
- [x] **Home/End with Ctrl** - Jump to first/last items ✅ COMPLETED
- [x] **Tab accessibility** - Proper tab navigation support ✅ COMPLETED
- [x] **Vim-style keys** - Optional j/k/g navigation ✅ COMPLETED

### 13. Data Integration Features

- [x] **WebSocket live updates** - Real-time data refresh ✅ COMPLETED
- [x] **Pending updates indicator** - Show when new data available ✅ COMPLETED
- [x] **Auto-refresh toggle** - Automatic update application ✅ COMPLETED
- [x] **Manual refresh button** - Force refresh data ✅ COMPLETED
- [x] **Connection status** - WebSocket connection state display ✅ COMPLETED
- [x] **Debug logging** - Detailed operation logs with timestamps ✅ COMPLETED
- [x] **MIME category detection** - Use existing `getMimeCategory()` helper ✅ COMPLETED
- [x] **Blob type filtering** - Filter by original/thumbnail/waveform/preview types ✅ COMPLETED
- [x] **Connection status styling** - Color-coded WebSocket status (connected=magenta, disconnected=gray) ✅ COMPLETED
- [x] **Mock data removal** - Replaced with real WebSocket feed data ✅ COMPLETED
- [x] **Type safety** - Updated to use WebSocket MediaBlob types ✅ COMPLETED

### 14. State Management

**Note**: Use IndexedDB instead of localStorage for better performance and storage limits

- [ ] **IndexedDB state persistence** - Use existing `SyncStorageManager` infrastructure for UI state
- [ ] **State restoration** - Leverage existing `initialize()` and transaction patterns
- [ ] **Export/import settings** - Use existing object store patterns for configuration
- [ ] **Reset functionality** - Reset all settings to defaults with existing cleanup methods
- [ ] **IndexedDB migration system** - Use existing version management in `SyncStorageManager`
- [ ] **Offline-first state management** - Build on existing sync conflict resolution patterns
- [ ] **Schema versioning** - Follow existing database version increment pattern (currently v4)
- [ ] **State compression** - Optimize storage for large selection sets and filter combinations

### 15. UI Polish & Interactions

- [ ] **Smooth animations** - Panel transitions, hover effects
- [ ] **Loading states** - Spinners, progress indicators
- [ ] **Error handling** - Graceful degradation, error messages
- [ ] **Responsive design** - Mobile/tablet optimizations
- [ ] **Focus management** - Proper tab order, focus indicators
- [ ] **Screen reader support** - ARIA labels, semantic markup
- [ ] **Custom element wrapper** - Maintain existing web component architecture
- [ ] **Global click handling** - Smart click detection for closing menus/modals
- [ ] **Mouse event coordination** - Proper drag selection with mouse move/up listeners

## 🎯 Priority Implementation Order

### Phase 1: Core Interactions (High Priority)

1. ✅ Multi-select system (Shift+Click, Ctrl+Click, drag selection box) - **COMPLETED**
2. 🚧 Enhanced click handling (single/double-click, context menu) - **IN PROGRESS**
3. Header sorting with triple-click cycle
4. Action menu system (⋯ button with smart positioning and context-sensitive actions)

### Phase 2: Visual Features (Medium Priority)

5. Enhanced view modes (proper compact/detailed layouts)
6. Advanced thumbnail system with auto-loading
7. Preview popup system
8. Bulk actions toolbar with "More" dropdown

### Phase 3: Advanced Features (Lower Priority)

9. Keyboard shortcuts and accessibility
10. Advanced filtering (MIME categories, blob types, size ranges)
11. WebSocket integration and live updates
12. IndexedDB state management migration
13. Copy URL and playlist integration features

## 📝 Implementation Notes & Architectural Principles

### **🏗️ Keep It Clean, Lean, and Modular**

- **Single Responsibility**: Each component should have one clear purpose
- **Extract Components**: Create new files/components rather than growing existing ones
- **Composition over Props**: Use hooks and context instead of passing many props
- **Reusable Patterns**: Build generic components that can be used across features

### **🔧 Refactoring Priorities**

- **Central App State**: Create shared state management with hooks
- **Component Extraction**: Break down large components into focused modules
- **Hook-Based Architecture**: Use custom hooks for state and behavior
- **Props Reduction**: Minimize prop drilling with context and state hooks

### **🎯 Current Architecture Guidelines**

- **Modular Foundation**: FreqholeDemo with BrowsePanel + FilterPanel + InfiniteDataGrid is solid
- **Component Extraction**: Create separate components for:
  - Multi-select system (`useSelection` hook + `SelectionToolbar` component)
  - Action menus (`ActionMenu` + `BulkActionsMenu` components)
  - Preview system (`PreviewModal` component)
  - Thumbnail management (`ThumbnailCell` component)
- **State Management**:
  - Central app state with hooks (instead of prop drilling)
  - Shared selection state across components
  - Centralized filter/sort state management

### **🛠️ Technical Standards**

- **Simple Dark Theme**: Keep the clean dark theme with black, white, and magenta core colors
- **Leverage Existing Infrastructure**:
  - Thumbnail system: `getThumbnails()`, `createDataUrl()`, auto-request patterns
  - Name resolution: `getDisplayFilename()` with metadata priority fallback
  - File type detection: `getFileTypeIcon()` and MIME category helpers
- **IndexedDB for State**: Use existing `SyncStorageManager` patterns instead of localStorage
- **WebSocket Integration**: Leverage existing `useWebSocketFeed` hook with auto-refresh and connection management

### **📦 Suggested New Components/Hooks**

- ✅ `hooks/useSelection.ts` - Multi-select behavior (COMPLETE)
- ✅ `components/SelectionToolbar.tsx` - Bulk actions UI (COMPLETE)
- 🚧 `hooks/useFreqholeState.ts` - Central state management (DRAFT READY)
- 🔄 `hooks/useActionMenu.ts` - Context menu management (NEXT)
- 🔄 `components/ActionMenu.tsx` - Context menu component (NEXT)
- 🔄 `components/PreviewModal.tsx` - Media preview popup (NEXT)
- 🔄 `components/ThumbnailCell.tsx` - Thumbnail display with loading states (NEXT)
- 🔄 `components/BulkActionsMenu.tsx` - Multi-select dropdown menu (NEXT)
- 🔄 `lib/media-utils.ts` - Domain-specific MediaBlob utilities (HIGH PRIORITY)
- 🔄 `lib/format-utils.ts` - Generic formatting utilities (HIGH PRIORITY)

## 🎉 THUMBNAIL DEBUGGING VICTORY & LESSONS LEARNED

### **💪 What We Solved:**

- **Fixed thumbnail display in FreqholeDemo** - Now shows actual thumbnail images instead of fallback icons
- **Identified the working pattern** - `thumbnail.data` → `createDataUrl()` → blob URLs (not HTTP endpoints)
- **Discovered server-side behavior** - Some media gets thumbnails with binary data, others get empty responses
- **Unified component approaches** - FreqholeDemo now uses same pattern as working MediaBlobFeedItem

### **🧭 Debug Journey & Key Discoveries:**

1. **HTTP endpoints DON'T exist** - `/api/media-blobs/{id}/download` returns 404 (as expected)
2. **Binary data IS the source** - Working thumbnails have `thumbnail.data` arrays with actual image bytes
3. **Blob URLs work perfectly** - `URL.createObjectURL()` creates `blob:http://localhost:8080/...` URLs
4. **Server responses vary** - Some items get `count: 2` with data, others get `count: 0` (no thumbnails)
5. **Both demos use same hook** - `useWebSocketFeed` provides identical data to both components

### **🎯 Critical Debugging Insights:**

- **Console logging was essential** - Without detailed logging, the data flow was invisible
- **Working examples are gold** - MediaBlobFeedItem showed the correct implementation pattern
- **Don't assume HTTP endpoints** - The system uses WebSocket binary data, not REST endpoints
- **Component parity matters** - Small differences in data handling can break functionality completely

### **⚠️ Why This Was So Painful:**

- **Complex system with multiple data paths** - WebSocket → Hook → Component → URL creation
- **Missing documentation** - No clear guide on how thumbnail data flows through the system
- **Assumption-driven debugging** - Spent time on HTTP endpoints that don't exist
- **Component drift** - FreqholeDemo's Thumbnail component diverged from working MediaBlobFeedItem pattern

## ✅ Refactoring Progress & Next Steps

### **🎉 What We Just Accomplished:**

- **Clean Selection System**: Extracted multi-select into reusable `useSelection` hook
- **Modular Toolbar**: Created `SelectionToolbar` component with clean props interface
- **Reduced Component Size**: FreqholeDemo is now more focused and manageable
- **Hook-Based Architecture**: Demonstrated clean separation with selection logic
- **Type Safety**: Proper TypeScript interfaces throughout
- **Storage Integration**: Selection state auto-saves to localStorage

### **🚀 Immediate Benefits:**

- **Reusable**: `useSelection` and `SelectionToolbar` can be used in other components
- **Testable**: Selection logic is isolated and easy to unit test
- **Maintainable**: Clear separation of concerns
- **Extensible**: Easy to add new selection features

### **🔄 Next Refactoring Steps:**

1. **Fix Selection Toolbar UX** - Bottom positioning, multi-select threshold, × button
2. **Fix Selected Row Hover Styles** - Ensure selected state remains visible on hover
3. **Column Layout Improvements** - Move thumbnail first, hide ID by default, add name column
4. **Extract Domain Logic to lib/** - Move MediaBlob utilities out of components
5. **Simple Text Selection Fix** - Just prevent text selection on Shift+click (minimal approach)
6. **Extract Action Menu System** - Right-click context menus + bulk actions
7. **Create Preview Modal** - Media preview popup component
8. **Migrate to Central State Hook** - Use `useFreqholeState` to reduce props
9. **Extract Filter Logic** - Move complex filtering to dedicated hook

## 🔄 Migration Strategy

### Phase A: Refactor for Modularity (Current Priority)

1. ✅ **Extract Selection System** - `useSelection` hook + `SelectionToolbar` component COMPLETE
2. 🚧 **Create Central State** - Implement `useFreqholeState` hook to reduce prop drilling (STARTED)
3. 🔄 **Component Extraction** - Break down large components into focused modules (ONGOING)
4. 🔄 **Hook-Based Architecture** - Replace prop chains with context and hooks (ONGOING)

### **Phase A.1: UX Polish (Immediate)**

1. 🔄 **Selection Toolbar UX** - Bottom positioning, multi-select threshold, × close button
2. 🔄 **Simple Text Selection Fix** - Just prevent Shift+click text selection (minimal)
3. 🔄 **Domain Logic Extraction** - Move MediaBlob utilities to `lib/` modules

### **Phase A.2: Architecture Cleanup**

4. 🔄 **Lib Organization** - Framework-agnostic utility functions in `lib/`
5. 🔄 **Component Simplification** - Remove inline domain logic from components

### **Phase B: Feature Implementation**

1. **Enhanced Click Handling** - Right-click menus, preview popups
2. **Advanced Grid Features** - Triple-click sorting, column management
3. **Visual Enhancements** - Themes, view modes, thumbnails
4. **Data Integration** - WebSocket feeds, IndexedDB state

### **Phase C: Polish & Performance**

1. **Optimize Rendering** - Virtualization, memoization
2. **Accessibility** - Keyboard navigation, screen readers
3. **Mobile Support** - Touch interactions, responsive design
4. **Testing & Documentation** - Component tests, usage examples

### **🎯 Implementation Guidelines**

- **Test Each Feature Independently** - Isolated component development
- **Maintain Backward Compatibility** - Don't break existing simple use cases
- **Progressive Enhancement** - Features should gracefully degrade if not supported
- **Clean Interfaces** - Well-defined props and hook contracts
- **Domain Separation** - Keep framework-specific code in components, pure logic in lib/
- **UX First** - Address text selection conflicts and toolbar positioning issues

---

_This list will be updated as features are implemented. Each completed feature should be moved to the ✅ Completed section with implementation notes._
