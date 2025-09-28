# MusicBrainz Frontend Integration

This directory contains the frontend implementation for MusicBrainz integration in the Freqhole music application.

## Overview

The MusicBrainz integration provides a comprehensive frontend interface for metadata lookup and management, building on the completed CLI and server-side implementation.

## Components

### API Methods (`api-methods.ts`)

Client-side API methods for communicating with the MusicBrainz server endpoints:

- `getMusicBrainzConfig()` - Get MusicBrainz configuration
- `searchMusicBrainz(request)` - Search MusicBrainz database
- `getSongMatches(songIds)` - Get existing matches for songs
- `applyMusicBrainzMetadata(songIds, match)` - Apply metadata to songs
- `scanSongsForMatches(songIds, options)` - Scan songs for new matches

All methods include Zod schema validation for type safety.

### Modal Component

**Location**: `client/js/src/views/freqhole/components/modals/MusicBrainzModal.tsx`

A comprehensive modal interface with three tabs:

1. **Available Matches** - Display existing MusicBrainz matches with confidence scores
2. **Search MusicBrainz** - Manual search interface with title/artist/album fields
3. **Edit Metadata** - Reuses existing song edit forms for manual metadata editing

**Features**:
- Single song and bulk mode support
- Admin-only access control
- Dark theme following design rules
- Integration with existing form validation
- "Mark as reviewed" option for processed songs

### Hooks

**`useMusicBrainz.ts`** - Core MusicBrainz functionality hook:
- Error handling with user notifications
- Loading state management
- API integration with proper error boundaries
- Success/failure event emission

**`useMusicBrainzModal.ts`** - Modal state management:
- Global event listening for modal open/close
- Song data management
- Integration with event system

## Integration Points

### Context Menu Integration

MusicBrainz lookup is available in song context menus for both single songs and bulk selections:

- Single song: "musicbrainz lookup"
- Bulk selection: "musicbrainz lookup (N songs)"

Icon: Brain icon added to `ContextMenuManager.tsx`

### Global Events

Uses the existing global event system for cross-component communication:

- `musicbrainz-modal:open` - Open modal with songs
- `musicbrainz-modal:close` - Close modal
- `modal:open` - Generic modal system (backward compatibility)
- `notification:show` - Success/error notifications
- `data:reload` - Trigger song list refresh

### Layout Integration

Modal is registered in `ThreeColumnLayout.tsx` and responds to both specific MusicBrainz events and generic modal events for backward compatibility with existing context menu actions.

## Design Compliance

Follows all critical design rules:

1. ✅ **No emojis** - All text is lowercase with proper nouns capitalized
2. ✅ **File size limit** - All files under 500 lines
3. ✅ **Dark theme** - Black/white/magenta color scheme, no rounded borders
4. ✅ **Modular architecture** - Uses SolidJS hooks and reactive patterns
5. ✅ **Data validation** - Zod schemas for all API data
6. ✅ **Code reuse** - Leverages existing song edit forms and modal systems
7. ✅ **Domain separation** - MusicBrainz code isolated in lib/musicbrainz/
8. ✅ **Generic library focus** - Reusable patterns and utilities
9. ✅ **Legacy code marking** - Clean integration without breaking existing patterns
10. ✅ **Maximum code reuse** - Extends existing bulk operations and form systems

## Usage

### Opening the Modal

From context menu (automatic):
```typescript
// Right-click on song(s) -> "musicbrainz lookup"
```

Programmatically:
```typescript
const events = useGlobalEvents();

// Specific event
events.emit("musicbrainz-modal:open", { songs: [song1, song2] });

// Generic modal event (backward compatibility)
events.emit("modal:open", {
  modal: "musicbrainzModal",
  data: { songs: [song1, song2] }
});
```

### Using the Hook

```typescript
const musicBrainz = useMusicBrainz({
  onError: (error) => console.error(error),
  onSuccess: (message) => console.log(message),
});

// Check if enabled
if (musicBrainz.isEnabled()) {
  // Get matches
  const matches = await musicBrainz.getMatches([song]);

  // Search
  const results = await musicBrainz.search({ title: "Song Title" });

  // Apply match
  await musicBrainz.applyMatch([song], match);
}
```

## Server Requirements

The frontend expects these server endpoints to be implemented:

- `GET /api/admin/musicbrainz/config` - Configuration
- `POST /api/musicbrainz/search` - Search MusicBrainz
- `POST /api/musicbrainz/matches` - Get song matches
- `POST /api/musicbrainz/apply` - Apply metadata
- `POST /api/musicbrainz/scan` - Scan for matches

Based on the completed CLI implementation, these endpoints should already be available.

## Future Enhancements

- Album artwork integration
- Batch confidence threshold adjustment
- Integration with "reviewed" tag system
- Preview mode before applying changes
- Undo functionality for applied metadata
