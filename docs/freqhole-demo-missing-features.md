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

## 🚧 Missing Core Features

### 1. Multi-Select System

- [ ] **Shift+Click range selection** - Select from last clicked to current
- [ ] **Ctrl/Cmd+Click toggle selection** - Add/remove individual items
- [ ] **Drag selection box** - Visual rectangle selection with mouse drag
- [ ] **Select All (Ctrl/Cmd+A)** - Keyboard shortcut to select all visible items
- [ ] **Selection persistence** - Save/restore selected items in localStorage
- [ ] **Selection counter** - Show "X items selected" in UI
- [ ] **Bulk action buttons** - Download, More (...) actions for selected items
- [ ] **Clear selection** - Button and Escape key to clear selection

### 2. Advanced Click Handling

- [ ] **Single click actions** - Immediate selection (use native onClick)
- [ ] **Double-click preview** - Open popup viewer (use native onDblClick)
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

### 6. Advanced Thumbnail System

**Note**: Leverage existing media blob library infrastructure where possible

- [ ] **Integrate with existing thumbnail generation** - Use `getThumbnails()`, `hasThumbnails()`, `getThumbnailUrl()` from MediaBlobFeedItem
- [ ] **Thumbnail placeholders** - Use existing `showThumbnailPlaceholder` state pattern with pulse animation
- [ ] **Auto-request thumbnails** - Use existing `onMount()` auto-request pattern with `onGetThumbnails` callback
- [ ] **Thumbnail error handling** - Use existing `createDataUrl()` and API fallback logic
- [ ] **File type icons** - Use existing `getFileTypeIcon()` function (🖼️🎥🎵📄📝📎)
- [ ] **Thumbnail badges** - Use existing metadata detection: `item.metadata?.has_thumbnails`
- [ ] **Data URL creation** - Use existing `createDataUrl(thumbnail.data, mimeType)` helper
- [ ] **Lazy loading** - Integrate with existing `loading="lazy"` img attributes

### 7. Action Menu System (⋯ Button)

- [ ] **Per-row action button** - Three dots (⋯) button in actions column
- [ ] **Context-sensitive menu** - Different options based on file type
- [ ] **Menu positioning** - Smart positioning to stay in viewport
- [ ] **Menu actions** - Download, Preview, Delete, Copy URL, etc.
- [ ] **Bulk action menu** - Special menu when multiple items selected
- [ ] **Menu persistence** - Close on outside click, Escape key
- [ ] **Copy URL action** - Copy download URL to clipboard
- [ ] **Add to Playlist action** - Add media items to playlists
- [ ] **Bulk action menu** - Special "More" button for multiple selections with smart positioning

### 8. Preview Popup System

- [ ] **Media preview modal** - Full-screen preview for images/videos
- [ ] **Popup positioning** - Center on screen with backdrop
- [ ] **Media type detection** - Different preview modes per file type
- [ ] **Popup close controls** - X button, Escape key, backdrop click
- [ ] **Keyboard navigation** - Arrow keys to navigate between items

### 9. Enhanced Column System

- [ ] **Column visibility toggles** - Show/hide specific columns
- [ ] **Column settings panel** - Expandable settings section
- [ ] **Smart column widths** - Responsive width adjustments
- [ ] **Column value processing** - Custom formatters (bytes, dates, etc.)
- [ ] **Column-specific rendering** - ID truncation, SHA256 display, etc.
- [ ] **Smart blob name handling** - Use existing `getDisplayFilename()` logic:
  - Checks `metadata.originalName`, `metadata.filename`, `metadata.original_filename`
  - Falls back to `item.filename`, `local_path` basename, or SHA256 snippet

### 10. Advanced Filtering

Current filtering is basic. Missing:

- [ ] **MIME category filter** - Group by image/video/audio/text
- [ ] **Blob type filter** - original/thumbnail/waveform/preview
- [ ] **Size range sliders** - Min/max size with UI sliders
- [ ] **Parent/child filtering** - Has parent, has local path toggles
- [ ] **Advanced filter combinations** - AND/OR logic
- [ ] **Filter presets** - Save common filter combinations

### 11. Keyboard Shortcuts

- [ ] **Escape** - Clear selection, close menus, close popup
- [ ] **Ctrl/Cmd+A** - Select all visible items
- [ ] **Arrow keys** - Navigate through items
- [ ] **Enter** - Open preview for selected item
- [ ] **Delete** - Delete selected items (with confirmation)
- [ ] **Space** - Toggle selection of focused item
- [ ] **Delete key** - Delete selected items with confirmation

### 12. Data Integration Features

- [ ] **WebSocket live updates** - Real-time data refresh
- [ ] **Pending updates indicator** - Show when new data available
- [ ] **Auto-refresh toggle** - Automatic update application
- [ ] **Manual refresh button** - Force refresh data
- [ ] **Connection status** - WebSocket connection state display
- [ ] **Debug logging** - Detailed operation logs with timestamps
- [ ] **MIME category detection** - Use existing `getMimeCategory()` helper
- [ ] **Blob type filtering** - Filter by original/thumbnail/waveform/preview types
- [ ] **Connection status styling** - Color-coded WebSocket status (connected=magenta, disconnected=gray)

### 13. State Management

**Note**: Use IndexedDB instead of localStorage for better performance and storage limits

- [ ] **IndexedDB state persistence** - Use existing `SyncStorageManager` infrastructure for UI state
- [ ] **State restoration** - Leverage existing `initialize()` and transaction patterns
- [ ] **Export/import settings** - Use existing object store patterns for configuration
- [ ] **Reset functionality** - Reset all settings to defaults with existing cleanup methods
- [ ] **IndexedDB migration system** - Use existing version management in `SyncStorageManager`
- [ ] **Offline-first state management** - Build on existing sync conflict resolution patterns
- [ ] **Schema versioning** - Follow existing database version increment pattern (currently v4)
- [ ] **State compression** - Optimize storage for large selection sets and filter combinations

### 14. UI Polish & Interactions

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

1. Multi-select system (Shift+Click, Ctrl+Click, drag selection box)
2. Enhanced click handling (single/double-click, context menu)
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

## 📝 Implementation Notes

- **Current Architecture**: The modular FreqholeDemo with BrowsePanel + FilterPanel + InfiniteDataGrid is solid
- **Keep Modularity**: Add features without breaking the clean component separation
- **Generic Components**: Enhance the base InfiniteDataGrid to support all these features generically
- **Simple Dark Theme**: Keep the clean dark theme with black, white, and magenta core colors
- **Leverage Existing Infrastructure**:
  - Thumbnail system: `getThumbnails()`, `createDataUrl()`, auto-request patterns
  - Name resolution: `getDisplayFilename()` with metadata priority fallback
  - File type detection: `getFileTypeIcon()` and MIME category helpers
- **IndexedDB for State**: Use existing `SyncStorageManager` patterns instead of localStorage
- **State Management**: Consider using a more sophisticated state management pattern for complex interactions
- **WebSocket Integration**: Leverage existing `useWebSocketFeed` hook with auto-refresh and connection management
- **Bulk Actions**: Implement toolbar with smart menu positioning for multi-select operations

## 🔄 Migration Strategy

1. **Enhance Generic Grid First** - Add multi-select, sorting to base component
2. **Extend Panel Components** - Add advanced filters to panels
3. **Integrate Features Gradually** - Test each feature independently
4. **Maintain Backward Compatibility** - Don't break existing simple use cases
5. **Add Progressive Enhancement** - Features should gracefully degrade if not supported

---

_This list will be updated as features are implemented. Each completed feature should be moved to the ✅ Completed section with implementation notes._
