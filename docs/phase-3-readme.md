# Phase 3: Real-time Notifications via PostgreSQL NOTIFY/LISTEN

## Overview

Phase 3 implements a comprehensive real-time notification system for the media blob platform, providing instant updates to connected clients when database changes occur. The system uses PostgreSQL NOTIFY/LISTEN for database-driven events, WebSocket broadcasting for client delivery, and includes comprehensive management tools.

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Database      │    │  PostgreSQL      │    │  Notification   │    │   WebSocket     │
│   Changes       │───▶│  NOTIFY/LISTEN   │───▶│    Service      │───▶│   Publisher     │
│   (Triggers)    │    │   (Listener)     │    │   (Grimoire)    │    │   (Broadcast)   │
└─────────────────┘    └──────────────────┘    └─────────────────┘    └─────────────────┘
                                                         │                        │
                                                         ▼                        ▼
                                              ┌─────────────────┐    ┌─────────────────┐
                                              │   Maintenance   │    │    Connected    │
                                              │     System      │    │    WebSocket    │
                                              │  (Health/Stats) │    │     Clients     │
                                              └─────────────────┘    └─────────────────┘
```

## Features

### 🚀 Core Functionality
- **Real-time Database Events**: Automatic PostgreSQL NOTIFY generation on data changes
- **WebSocket Broadcasting**: Instant delivery to connected clients
- **Multi-channel Support**: Separate channels for different event types
- **Event Filtering**: User-based and permission-based filtering
- **Rate Limiting**: Configurable rate limiting and deduplication

### 🛠️ Management Tools
- **HTTP API**: REST endpoints for monitoring and administration
- **CLI Commands**: Command-line tools for testing and maintenance
- **Health Monitoring**: Automated health checks and performance metrics
- **Maintenance Tasks**: Automated cleanup and optimization

### 📱 Client Integration
- **JavaScript Library**: Ready-to-use WebSocket client with reconnection
- **Message Types**: Structured message format for easy integration
- **Channel Subscriptions**: Selective subscription to notification channels

## Quick Start

### 1. Database Setup

Run the migration to install PostgreSQL triggers:

```bash
./scripts/run_migrations.sh
```

This adds triggers to the `media_blobs` and `thumbnail_jobs` tables that automatically generate NOTIFY events.

### 2. Start the Server

```bash
cargo run --bin server
```

The server automatically starts the notification infrastructure including:
- PostgreSQL NOTIFY listener
- WebSocket publisher
- Maintenance system

### 3. Test with CLI

```bash
# Check system health
cargo run --bin cli notifications health

# Send test notification
cargo run --bin cli notifications test --channel media-blobs --event-type "test.event"

# Monitor in real-time
cargo run --bin cli notifications monitor
```

### 4. Connect WebSocket Client

```javascript
// Include the client library
// <script src="/static/js/notification-client.js"></script>

const client = createNotificationClient({ debug: true });

client.on('connect', () => {
    console.log('Connected to notification server');
    client.subscribeToChannel('MediaBlobs');
});

client.on('notification', (notification) => {
    console.log('Received notification:', notification);
});

client.connect();
```

## Notification Channels

### MediaBlobs
Events related to file operations:
- `media_blob.created` - New file uploaded
- `media_blob.updated` - File metadata changed
- `media_blob.deleted` - File removed

### ThumbnailJobs
Thumbnail generation status:
- `thumbnail_job.created` - New thumbnail job queued
- `thumbnail_job.started` - Processing began
- `thumbnail_job.completed` - Successfully generated
- `thumbnail_job.failed` - Generation failed

### System
System-wide notifications:
- `system.maintenance` - Maintenance announcements
- `admin.broadcast` - Admin messages
- `system.alert` - System alerts

## API Reference

### HTTP Endpoints

#### System Status
```http
GET /notifications/status
```
Returns basic system status and connection count.

#### Detailed Statistics
```http
GET /notifications/stats
```
Requires authentication. Returns comprehensive performance metrics.

#### Send Test Notification
```http
POST /notifications/test
Content-Type: application/json

{
  "channel": "MediaBlobs",
  "event_type": "test.event",
  "payload": {"test": true},
  "priority": "High"
}
```

#### Health Check
```http
GET /notifications/health
```
Returns health status for monitoring systems.

### WebSocket Messages

#### Client to Server

**Subscribe to Channel**
```json
{
  "type": "SubscribeToNotifications",
  "data": {"channel": "MediaBlobs"}
}
```

**Unsubscribe from Channel**
```json
{
  "type": "UnsubscribeFromNotifications",
  "data": {"channel": "MediaBlobs"}
}
```

**Get Status**
```json
{
  "type": "GetNotificationStatus"
}
```

#### Server to Client

**Notification Event**
```json
{
  "type": "Notification",
  "data": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "channel": "MediaBlobs",
    "event_type": "media_blob.created",
    "payload": {
      "blob_id": "456e7890-1234-5678-9012-345678901234",
      "filename": "photo.jpg",
      "size_bytes": 2048000
    },
    "priority": "Normal",
    "timestamp": "2024-01-15T10:30:00Z"
  }
}
```

**Subscription Confirmed**
```json
{
  "type": "NotificationSubscribed",
  "data": {"channel": "MediaBlobs"}
}
```

## CLI Commands

### Health Check
```bash
cargo run --bin cli notifications health
```
Verifies database connectivity, triggers, and service health.

### Statistics
```bash
cargo run --bin cli notifications stats
```
Displays detailed performance metrics and statistics.

### Test Notifications
```bash
# Basic test
cargo run --bin cli notifications test --channel media-blobs

# Custom test
cargo run --bin cli notifications test \
  --channel thumbnail-jobs \
  --event-type "custom.test" \
  --payload '{"custom": "data"}' \
  --priority high
```

### PostgreSQL NOTIFY Test
```bash
cargo run --bin cli notifications test-postgres \
  --channel media_blobs \
  --payload '{"event_type": "test.direct", "test": true}'
```

### Real-time Monitoring
```bash
# Monitor for 10 updates every 5 seconds
cargo run --bin cli notifications monitor --interval 5 --count 10
```

### System Maintenance
```bash
# Clean up old data (dry run)
cargo run --bin cli notifications cleanup --hours 24 --dry-run

# Initialize system
cargo run --bin cli notifications init
```

### Performance Testing
```bash
cargo run --bin cli notifications benchmark \
  --count 1000 \
  --workers 10 \
  --channel media-blobs
```

## Configuration

### Notification Config
```json
{
  "notifications": {
    "channels": {
      "MediaBlobs": {
        "enabled": true,
        "min_priority": "Low",
        "rate_limit": {
          "events_per_minute": 100,
          "drop_on_limit": false
        }
      }
    },
    "rate_limiting": {
      "enabled": true,
      "default_events_per_minute": 60
    }
  }
}
```

### Maintenance Config
```rust
MaintenanceConfig {
    interval_seconds: 300,              // Run every 5 minutes
    max_log_age_hours: 168,            // Keep logs for 7 days
    max_failed_delivery_age_hours: 24, // Clean failed deliveries after 1 day
    auto_cleanup_enabled: true,
    metrics_enabled: true,
    health_check_enabled: true,
}
```

## Database Schema

### Notification Triggers

The system automatically installs triggers on key tables:

```sql
-- Media blobs trigger
CREATE TRIGGER trigger_notify_media_blob_insert
    AFTER INSERT ON media_blobs
    FOR EACH ROW
    EXECUTE FUNCTION notify_media_blob_change();

-- Thumbnail jobs trigger
CREATE TRIGGER trigger_notify_thumbnail_job_update
    AFTER UPDATE ON thumbnail_jobs
    FOR EACH ROW
    EXECUTE FUNCTION notify_thumbnail_job_change();
```

### Manual Testing

You can manually trigger notifications:

```sql
-- Test media blob notification
SELECT test_notification('media_blobs',
  '{"event_type": "test.manual", "test": true}'::jsonb);

-- Insert test data (triggers automatic notification)
INSERT INTO media_blobs (sha256, size, mime, metadata)
VALUES ('test123', 1024, 'image/png', '{"test": true}');
```

## JavaScript Client Library

### Basic Usage

```javascript
// Create client with options
const client = createNotificationClient({
    url: 'ws://localhost:3000/ws',
    debug: true,
    reconnectInterval: 5000,
    maxReconnectAttempts: 10
});

// Global event handlers
client.on('connect', () => console.log('Connected'));
client.on('disconnect', () => console.log('Disconnected'));
client.on('error', (error) => console.error('Error:', error));

// Subscribe to channels
client.on('connect', () => {
    client.subscribeToChannel('MediaBlobs');
    client.subscribeToChannel('ThumbnailJobs');
});

// Handle all notifications
client.on('notification', (notification) => {
    console.log('Notification:', notification);
});

// Handle channel-specific notifications
client.onChannel('MediaBlobs', (notification) => {
    if (notification.event_type === 'media_blob.created') {
        console.log('New file:', notification.payload.filename);
    }
});

// Connect
client.connect();
```

### Advanced Features

```javascript
// Get connection status
const status = client.getStatus();
console.log('Connected:', status.isConnected);
console.log('Subscribed to:', status.subscribedChannels);

// Manual subscription management
client.subscribeToChannel('System');
client.unsubscribeFromChannel('MediaBlobs');

// Connection cleanup
client.disconnect();
```

## Monitoring and Observability

### Metrics

The system tracks comprehensive metrics:

- **Event Processing**: Total published, delivered, failed
- **Performance**: Average processing time, events per minute
- **Connections**: Active WebSocket connections, subscription counts
- **Health**: Database connectivity, service status

### Health Checks

Automated health monitoring includes:

- Database connectivity
- PostgreSQL NOTIFY/LISTEN functionality
- WebSocket publisher status
- Service component health

### Logging

Structured logging at multiple levels:

```bash
# Set log level
RUST_LOG=info cargo run --bin server

# Debug notifications
RUST_LOG=debug,grimoire::notifications=trace cargo run --bin server
```

## Development

### Running Examples

```bash
# Run comprehensive demo
cargo run --example notification_demo

# Test individual components
cargo test --package grimoire notifications
cargo test --package server notifications
```

### Adding New Channels

1. Add channel to `NotificationChannel` enum in `grimoire/src/notifications/models.rs`
2. Add database triggers if needed
3. Update client library channel list
4. Add CLI support for new channel

### Testing

```bash
# Unit tests
cargo test notifications

# Integration tests with database
DATABASE_URL=postgresql://postgres:password@localhost:5432/test \
  cargo test --test integration_notifications

# End-to-end testing
./scripts/test_notifications.sh
```

## Troubleshooting

### Common Issues

**No notifications received**
1. Check database triggers are installed: `cargo run --bin cli notifications health`
2. Verify WebSocket connection: Check browser developer tools
3. Confirm channel subscriptions: Use `GetNotificationStatus` message

**High memory usage**
1. Check cleanup configuration: `cargo run --bin cli notifications stats`
2. Run manual cleanup: `cargo run --bin cli notifications cleanup`
3. Monitor connection count: `GET /notifications/status`

**Database connection errors**
1. Verify DATABASE_URL environment variable
2. Check PostgreSQL is running and accessible
3. Ensure database user has LISTEN/NOTIFY permissions

### Debug Mode

Enable debug logging:

```bash
# Server
RUST_LOG=debug cargo run --bin server

# CLI
RUST_LOG=debug cargo run --bin cli notifications health

# Client (JavaScript)
const client = createNotificationClient({ debug: true });
```

## Performance Considerations

### Scalability

- **Database**: PostgreSQL NOTIFY scales well to thousands of connections
- **WebSocket**: Each connection uses ~1-2MB memory
- **Events**: Can handle hundreds of events per second per channel

### Optimization

- Use appropriate notification priorities
- Configure rate limiting for high-volume channels
- Monitor cleanup intervals for large datasets
- Consider connection pooling for high client counts

## Security

### Authentication

- WebSocket connections require session authentication
- HTTP management endpoints require user authentication
- Admin endpoints require admin role

### Data Privacy

- Notifications respect user permissions
- Payload filtering based on user access
- No sensitive data in notification metadata

### Network Security

- WebSocket connections use same authentication as HTTP
- Rate limiting prevents abuse
- Input validation on all notification payloads

## Future Enhancements

### Planned Features

- [ ] Persistent notification queue for offline clients
- [ ] User-specific notification preferences
- [ ] Push notification integration (mobile)
- [ ] Notification history and replay
- [ ] Advanced filtering and routing rules

### Monitoring Integration

- [ ] Prometheus metrics export
- [ ] Grafana dashboard templates
- [ ] Alert manager integration
- [ ] Performance profiling tools

## Contributing

### Development Setup

1. Install dependencies: `cargo build`
2. Start database: `docker-compose up postgres`
3. Run migrations: `./scripts/run_migrations.sh`
4. Start development server: `cargo run --bin server`

### Testing Changes

1. Run unit tests: `cargo test notifications`
2. Test CLI commands: `cargo run --bin cli notifications health`
3. Test WebSocket integration: Open browser to `/static/demo.html`
4. Run integration tests: `./scripts/test_notifications.sh`

### Code Style

- Follow existing patterns in grimoire domain layer
- Add comprehensive tests for new features
- Update documentation for API changes
- Use structured logging with appropriate levels

---

For more detailed implementation information, see [Phase 3 Implementation Summary](./phase-3-implementation-summary.md).
