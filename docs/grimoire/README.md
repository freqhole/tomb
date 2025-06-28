# Grimoire Package

Core business logic and domain models for the WebAuthn server application.

## Overview

The `grimoire` crate contains all domain-specific business logic, data models, and service layers. It's designed to be framework-agnostic and can be used by the CLI, server, or other applications.

## Architecture

```
grimoire/
├── src/
│   ├── analytics/          # Analytics and metrics
│   ├── auth/              # Authentication and authorization
│   ├── config/            # Configuration management
│   ├── music/             # Music library management
│   ├── notifications/     # Real-time notifications
│   ├── storage/           # Storage abstractions
│   ├── thumbnails/        # Media thumbnail generation
│   ├── users/             # User management
│   ├── wordlist/          # Wordlist for invite codes
│   └── lib.rs
```

## Core Modules

### Configuration (`config/`)
- Application configuration structures
- Environment-based config loading
- Validation and defaults
- JSONC file support

### Database (`database/`)
- Database connection management
- Migration utilities
- Connection pooling
- Transaction helpers

### Authentication (`auth/`)
- WebAuthn/FIDO2 implementation
- Session management
- User authentication flows
- Invite code system

### Music (`music/`)
- Audio file scanning and metadata extraction
- Playlist management
- Song organization and search
- Album and artist relationships

### Users (`users/`)
- User account management
- Profile data
- Account linking
- Permission systems

### Analytics (`analytics/`)
- Request tracking
- Performance metrics
- Event logging
- Data aggregation

### Notifications (`notifications/`)
- Real-time event system
- WebSocket message broadcasting
- Channel-based subscriptions
- Priority handling

### Storage (`storage/`)
- File storage abstractions
- Blob management
- Media handling
- Storage backend switching

### Thumbnails (`thumbnails/`)
- Image thumbnail generation
- Video frame extraction
- Audio waveform generation
- Format conversion

## Key Features

### Type Safety
- Strongly typed domain models
- Compile-time validation
- Error handling with custom error types
- UUID-based entity identification

### Database Integration
- SQLx for compile-time SQL validation
- Automatic migrations
- Connection pooling
- PostgreSQL optimizations

### Configuration Management
- Hierarchical configuration loading
- Environment variable overrides
- Validation and schema checking
- Development vs production profiles

### Async/Await Support
- Fully async service layer
- Tokio runtime integration
- Streaming data processing
- Concurrent operations

## Usage Examples

### Music Library
```rust
use grimoire::music::{MusicRepository, MusicService};

let repository = MusicRepository::new(pool);
let service = MusicService::new(repository);

// Scan music directory
let scan_result = service.scan_directory("/path/to/music").await?;

// Create playlist
let playlist = service.create_playlist("My Favorites", None).await?;

// Add songs to playlist
service.add_songs_to_playlist(playlist.id, &song_ids).await?;
```

### User Management
```rust
use grimoire::auth::{AuthService, InviteService};

let auth_service = AuthService::new(repository);
let invite_service = InviteService::new(repository);

// Generate invite codes
let codes = invite_service.generate_codes(5, 12).await?;

// Register user with invite
let user = auth_service.register_with_invite(&code, &credential).await?;
```

### Configuration
```rust
use grimoire::AppConfig;

// Load from files
let (config, secrets) = AppConfig::from_files("config.jsonc", Some("secrets.jsonc"))?;

// Validate configuration
config.validate()?;

// Access typed configuration
let db_url = config.database_url();
let server_addr = (config.server.host, config.server.port);
```

## Error Handling

Each module defines its own error types that implement standard error traits:

```rust
// Example: Music module errors
pub enum MusicRepositoryError {
    Database(sqlx::Error),
    SongNotFound(Uuid),
    PlaylistNotFound(Uuid),
    ValidationError(String),
}

// Service layer errors
pub enum MusicServiceError {
    Repository(MusicRepositoryError),
    InvalidInput(String),
    BusinessLogicViolation(String),
}
```

## Testing

- Unit tests for all service methods
- Integration tests with test database
- Mock implementations for external dependencies
- Property-based testing for validation logic

## Performance Considerations

- Database query optimization
- Connection pooling
- Lazy loading for large datasets
- Streaming for file operations
- Caching for frequently accessed data

## Dependencies

Key external dependencies:
- `sqlx` - Database operations
- `serde` - Serialization/deserialization
- `uuid` - UUID generation and parsing
- `tokio` - Async runtime
- `tracing` - Structured logging
- `webauthn-rs` - WebAuthn implementation
