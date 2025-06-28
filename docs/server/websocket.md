# WebSocket Messages

Real-time communication protocol for the WebAuthn server application.

## Connection

WebSocket endpoint: `ws://localhost:8080/ws`

Connections are optional for authentication - anonymous connections receive limited functionality.

## Message Format

All messages use JSON with a discriminated union format:

```json
{
  "type": "MessageType",
  "data": { ... }
}
```

## Client to Server Messages

### Connection Management

#### `Ping`
Test connection and get server response.

```json
{
  "type": "Ping"
}
```

### Media Operations

#### `GetMediaBlobs`
Request list of media blobs with optional pagination.

```json
{
  "type": "GetMediaBlobs",
  "data": {
    "limit": 50,
    "offset": 0
  }
}
```

#### `UploadMediaBlob`
Upload a new media blob.

```json
{
  "type": "UploadMediaBlob",
  "data": {
    "blob": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "data": [/* binary data as byte array */],
      "sha256": "abc123...",
      "size": 1024,
      "mime": "audio/mpeg",
      "source_client_id": "client-123",
      "local_path": "/path/to/file.mp3",
      "metadata": {"duration": 180}
    }
  }
}
```

#### `GetMediaBlob`
Request specific media blob metadata by ID.

```json
{
  "type": "GetMediaBlob",
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000"
  }
}
```

#### `GetMediaBlobData`
Request media blob binary data by ID.

```json
{
  "type": "GetMediaBlobData",
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000"
  }
}
```

### Notification Subscriptions

#### `SubscribeToNotifications`
Subscribe to a notification channel.

```json
{
  "type": "SubscribeToNotifications",
  "data": {
    "channel": "music_updates"
  }
}
```

**Available Channels:**
- `system` - System-wide notifications
- `auth` - Authentication events
- `media` - Media and music updates
- `music_updates` - Music library changes
- `playlist_updates` - Playlist modifications

#### `UnsubscribeFromNotifications`
Unsubscribe from a notification channel.

```json
{
  "type": "UnsubscribeFromNotifications",
  "data": {
    "channel": "music_updates"
  }
}
```

#### `GetNotificationStatus`
Request current notification subscription status.

```json
{
  "type": "GetNotificationStatus"
}
```

### Thumbnail Operations

#### `GetThumbnails`
Request thumbnails for a media blob.

```json
{
  "type": "GetThumbnails",
  "data": {
    "media_blob_id": "550e8400-e29b-41d4-a716-446655440000"
  }
}
```

## Server to Client Messages

### Connection Management

#### `Welcome`
Server greeting sent on successful connection.

```json
{
  "type": "Welcome",
  "data": {
    "message": "Connected to WebSocket server",
    "user_id": "550e8400-e29b-41d4-a716-446655440000",
    "connection_id": "conn-abc123"
  }
}
```

#### `Pong`
Response to client ping.

```json
{
  "type": "Pong"
}
```

#### `ConnectionStatus`
Connection status updates.

```json
{
  "type": "ConnectionStatus",
  "data": {
    "connected": true,
    "user_count": 5
  }
}
```

### Media Responses

#### `MediaBlobs`
List of media blobs with pagination info.

```json
{
  "type": "MediaBlobs",
  "data": {
    "blobs": [
      {
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "sha256": "abc123...",
        "size": 1024,
        "mime": "audio/mpeg",
        "created_at": "2024-01-01T12:00:00Z",
        "metadata": {"title": "Song Name"}
      }
    ],
    "total_count": 150
  }
}
```

#### `MediaBlob`
Single media blob metadata.

```json
{
  "type": "MediaBlob",
  "data": {
    "blob": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "sha256": "abc123...",
      "size": 1024,
      "mime": "audio/mpeg",
      "source_client_id": "client-123",
      "local_path": "/path/to/file.mp3",
      "metadata": {"duration": 180},
      "created_at": "2024-01-01T12:00:00Z",
      "updated_at": "2024-01-01T12:00:00Z"
    }
  }
}
```

#### `MediaBlobData`
Binary data for a media blob.

```json
{
  "type": "MediaBlobData",
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "data": [/* binary data as byte array */],
    "mime": "audio/mpeg"
  }
}
```

### Notification Messages

#### `Notification`
Real-time notification event.

```json
{
  "type": "Notification",
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "channel": "music_updates",
    "event_type": "song_added",
    "payload": {
      "song_id": "550e8400-e29b-41d4-a716-446655440000",
      "title": "New Song",
      "artist": "Artist Name"
    },
    "priority": "Normal",
    "timestamp": "2024-01-01T12:00:00Z"
  }
}
```

**Event Types:**
- `song_added` - New song added to library
- `song_updated` - Song metadata updated
- `playlist_created` - New playlist created
- `playlist_updated` - Playlist modified
- `user_login` - User authenticated
- `system_alert` - System notification

**Priority Levels:**
- `Low` - Background notifications
- `Normal` - Standard notifications
- `High` - Important notifications
- `Critical` - Urgent system alerts

#### `NotificationSubscribed`
Confirmation of subscription to notification channel.

```json
{
  "type": "NotificationSubscribed",
  "data": {
    "channel": "music_updates"
  }
}
```

#### `NotificationUnsubscribed`
Confirmation of unsubscription from notification channel.

```json
{
  "type": "NotificationUnsubscribed",
  "data": {
    "channel": "music_updates"
  }
}
```

#### `NotificationStatus`
Current notification subscription status.

```json
{
  "type": "NotificationStatus",
  "data": {
    "subscribed_channels": ["music_updates", "system"],
    "connection_id": "conn-abc123",
    "is_authenticated": true
  }
}
```

### Thumbnail Responses

#### `Thumbnails`
Thumbnails for a media blob.

```json
{
  "type": "Thumbnails",
  "data": {
    "media_blob_id": "550e8400-e29b-41d4-a716-446655440000",
    "thumbnails": [
      {
        "id": "thumb-550e8400-e29b-41d4-a716-446655440000",
        "data": [/* thumbnail binary data */],
        "mime": "image/webp",
        "size": 2048,
        "metadata": {"width": 200, "height": 200}
      }
    ]
  }
}
```

### Error Handling

#### `Error`
Error response for failed operations.

```json
{
  "type": "Error",
  "data": {
    "message": "Song not found",
    "code": "SONG_NOT_FOUND"
  }
}
```

**Common Error Codes:**
- `AUTHENTICATION_REQUIRED` - Operation requires authentication
- `PERMISSION_DENIED` - Insufficient permissions
- `NOT_FOUND` - Resource not found
- `VALIDATION_ERROR` - Invalid request data
- `RATE_LIMITED` - Too many requests
- `INTERNAL_ERROR` - Server error

## Usage Examples

### JavaScript Client

```javascript
const ws = new WebSocket('ws://localhost:8080/ws');

ws.onopen = () => {
  // Subscribe to music updates
  ws.send(JSON.stringify({
    type: 'SubscribeToNotifications',
    data: { channel: 'music_updates' }
  }));
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);

  switch (message.type) {
    case 'Welcome':
      console.log('Connected:', message.data.connection_id);
      break;

    case 'Notification':
      if (message.data.event_type === 'song_added') {
        console.log('New song:', message.data.payload.title);
      }
      break;

    case 'Error':
      console.error('WebSocket error:', message.data.message);
      break;
  }
};

// Request media list
ws.send(JSON.stringify({
  type: 'GetMediaBlobs',
  data: { limit: 10, offset: 0 }
}));
```

### Authentication

WebSocket connections inherit session authentication from HTTP cookies. Unauthenticated connections have limited access:

- Can receive system notifications
- Cannot access user-specific data
- Cannot perform write operations

## Connection Lifecycle

1. **Connect** - Client opens WebSocket connection
2. **Welcome** - Server sends welcome message
3. **Subscribe** - Client subscribes to notification channels
4. **Exchange** - Bidirectional message exchange
5. **Disconnect** - Connection closed (automatic unsubscribe)

## Performance Notes

- Messages are processed asynchronously
- Large binary data should use chunked transfer
- Connections are automatically cleaned up on disconnect
- Rate limiting applies per connection

## Security

- Authentication via session cookies
- Channel-based access control
- Message validation and sanitization
- Connection timeout for idle connections
