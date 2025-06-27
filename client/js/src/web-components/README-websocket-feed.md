# WebSocket Feed Components

A collection of real-time feed components that use WebSocket notifications instead of polling for efficient, instant updates.

## Overview

This module provides a complete WebSocket-based feed system for media blobs with real-time notifications, thumbnail support, and a clean component architecture. It replaces the traditional polling approach with event-driven updates for better performance and user experience.

## Components

### 🔄 `websocket-feed-demo`
The main demo component showcasing the complete feed system.

**Features:**
- Real-time WebSocket connection management
- Live feed updates via notifications
- Connection status monitoring
- Feed statistics and activity logging
- Responsive design with compact/default modes

**Usage:**
```html
<websocket-feed-demo
  ws-url="ws://localhost:8080/ws"
  channels='["MediaBlobs"]'
  debug="true"
  auto-connect="true"
  item-mode="default"
  max-height="500px"
  show-controls="true"
  show-stats="true">
</websocket-feed-demo>
```

### 📡 `websocket-feed-manager`
Hidden manager component that handles WebSocket communication and feed state.

**Features:**
- WebSocket connection lifecycle management
- Notification channel subscriptions
- Feed state management
- Real-time event processing
- Automatic reconnection

**Usage:**
```html
<websocket-feed-manager
  ws-url="ws://localhost:8080/ws"
  channels='["MediaBlobs"]'
  debug="false"
  auto-connect="true"
  page-size="20">
</websocket-feed-manager>
```

### 📋 `media-blob-feed-list`
Displays a list of media blob items with animations and state management.

**Features:**
- Virtual scrolling support
- Loading and error states
- Empty state handling
- Item animations
- Click event handling

**Usage:**
```html
<media-blob-feed-list
  items='[...]'
  loading="false"
  item-mode="default"
  max-height="400px"
  show-thumbnails="true"
  clickable-items="true">
</media-blob-feed-list>
```

### 🖼️ `media-blob-feed-item`
Individual feed item component with thumbnail and metadata display.

**Features:**
- Automatic thumbnail loading
- Fallback placeholders
- File type icons
- Timestamp formatting
- Metadata display

**Usage:**
```html
<media-blob-feed-item
  blob='{...}'
  show-thumbnail="true"
  show-metadata="true"
  compact="false"
  clickable="true"
  thumbnail-size="120">
</media-blob-feed-item>
```

## Architecture

### Real-time Updates
The system uses WebSocket notifications instead of polling:

```
Server Event → WebSocket → Feed Manager → Feed List → UI Update
```

**Benefits:**
- ⚡ Instant updates (no 30s delay)
- 🔋 Lower resource usage
- 📡 Efficient bandwidth usage
- 🎯 Event-driven architecture

### Component Communication
Components communicate via:
- Custom DOM events
- Shared state management
- Event delegation
- Component method exposure

### Notification Channels
Supported notification channels:
- `MediaBlobs` - Media blob events
- `ThumbnailJobs` - Thumbnail processing
- `System` - System notifications
- `UserAuth` - Authentication events
- `Analytics` - Analytics updates

## Events

### Feed Events
- `feed-item-selected` - Item selection
- `media-blob-click` - Item click
- `connection-changed` - Connection status
- `notification` - Real-time notifications

### WebSocket Events
- `welcome` - Connection established
- `mediaBlobs` - Bulk data received
- `notification` - Real-time update
- `error` - Connection errors

## Styling

Components use CSS-in-JS with comprehensive styling:

```css
.websocket-feed-demo {
  /* Main container styles */
}

.media-blob-feed-item {
  /* Individual item styles */
}

.media-blob-feed-list {
  /* List container styles */
}
```

## Development

### Building
```bash
npm run build:web-components
```

### Testing
```bash
# Start development server
npm run dev:web-components

# Open the demo
open dist/websocket-feed-demo-standalone.html
```

### Adding New Features
1. Create component in `src/web-components/`
2. Add to `index.tsx` exports
3. Update `vite.wc.config.ts` build config
4. Add TypeScript definitions

## Migration from Polling

### Before (Polling)
```javascript
// Old approach - inefficient polling
setInterval(() => {
  fetchData(); // Every 30 seconds
}, 30000);
```

### After (WebSocket)
```javascript
// New approach - real-time notifications
webSocketClient.on('notification', (data) => {
  updateFeed(data); // Instant updates
});
```

### Migration Steps
1. Replace `sync-demo` polling with `websocket-feed-demo`
2. Subscribe to relevant notification channels
3. Handle real-time events
4. Remove polling intervals

## Server Requirements

### WebSocket Endpoint
```
ws://localhost:8080/ws
```

### Notification Support
Server must support:
- WebSocket connections
- Notification subscriptions
- Real-time event broadcasting
- Media blob notifications

### Message Format
```typescript
// Subscription
{
  type: "SubscribeToNotifications",
  data: { channel: "MediaBlobs" }
}

// Notification
{
  type: "Notification",
  data: {
    id: "uuid",
    channel: "MediaBlobs",
    event_type: "media_blob.created",
    payload: { media_blob: {...} },
    priority: "normal",
    timestamp: "2024-01-01T00:00:00Z"
  }
}
```

## Best Practices

### Performance
- Use virtual scrolling for large lists
- Implement proper cleanup on unmount
- Debounce frequent updates
- Cache thumbnails appropriately

### Error Handling
- Graceful connection failures
- Retry logic for failed operations
- User-friendly error messages
- Fallback to polling if needed

### Accessibility
- Proper ARIA labels
- Keyboard navigation
- Screen reader support
- Focus management

## Troubleshooting

### Connection Issues
1. Check WebSocket URL
2. Verify server is running
3. Check browser console for errors
4. Test with standalone demo

### No Updates
1. Verify notification subscriptions
2. Check server notification system
3. Test with manual triggers
4. Review event handlers

### Thumbnails Not Loading
1. Check thumbnail API endpoint
2. Verify CORS settings
3. Test thumbnail URLs directly
4. Check placeholder fallbacks

## Related Components

- `sync-demo` - Original sync system (polling removed)
- `websocket-demo` - Basic WebSocket testing
- `websocket-handler` - Low-level WebSocket management
- `smart-file-upload` - File upload with WebSocket

## Future Enhancements

- [ ] Virtual scrolling implementation
- [ ] Advanced filtering/sorting
- [ ] Batch operations
- [ ] Offline support
- [ ] Progressive loading
- [ ] Advanced thumbnail management
