# Documentation Index

Complete reference documentation for the WebAuthn server application.

## Quick Start

- [**Server Startup**](../startup/README.md) - Get the server running
- [**Configuration**](../config/README.md) - Configure the application

## Command Line Interface

- [**CLI Overview**](../cli/README.md) - Global commands and options
- [**Music Commands**](../cli/music.md) - Music library management CLI

## Core Library (Grimoire)

- [**Grimoire Overview**](../grimoire/README.md) - Core business logic package
- [**Music Module**](../grimoire/music.md) - Music domain models and services

## Server API

- [**HTTP API**](../server/README.md) - REST endpoints and authentication
- [**WebSocket Protocol**](../server/websocket.md) - Real-time messaging

## Documentation Structure

### Getting Started
- **Startup Guide** - Server arguments, configuration loading, troubleshooting
- **Configuration** - JSONC configuration files, environment variables, validation

### Command Line Tools
- **CLI Reference** - All available commands with examples
- **Music CLI** - Detailed music library management commands

### Development
- **Grimoire Package** - Core business logic architecture and modules
- **Music Domain** - Models, repositories, services for music functionality

### API Reference
- **HTTP Endpoints** - REST API with authentication and examples
- **WebSocket Messages** - Real-time communication protocol

## Key Features Covered

### Music Library Management
- Audio file scanning and metadata extraction
- Song, album, and artist organization
- Playlist creation and manipulation
- Batch operations and error handling

### Authentication & Security
- WebAuthn/FIDO2 implementation
- Session management
- API security and rate limiting

### Real-time Features
- WebSocket connections
- Notification channels
- Live updates and streaming

### Configuration & Deployment
- Hierarchical configuration loading
- Environment-specific settings
- Database migrations and setup

### Developer Tools
- CLI for administration and testing
- Analytics and monitoring
- Thumbnail generation
- File upload handling

## Navigation Tips

- Each document includes practical examples and code snippets
- Error codes and troubleshooting sections are provided where relevant
- Cross-references link related concepts across modules
- All endpoints and commands include usage examples

## Quick Reference

| Need to... | See... |
|------------|--------|
| Start the server | [Startup Guide](../startup/README.md) |
| Configure the app | [Configuration](../config/README.md) |
| Use CLI commands | [CLI Overview](../cli/README.md) |
| Manage music library | [Music CLI](../cli/music.md) |
| Understand core logic | [Grimoire Overview](../grimoire/README.md) |
| Work with music data | [Music Module](../grimoire/music.md) |
| Use HTTP API | [HTTP API](../server/README.md) |
| Implement WebSocket | [WebSocket Protocol](../server/websocket.md) |

---

*This documentation covers all major components of the WebAuthn server application. Each section is designed to be self-contained while providing cross-references to related functionality.*
