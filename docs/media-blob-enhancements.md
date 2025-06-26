# Media Blob System Enhancements

This document tracks remaining tasks for implementing the media blob system with thumbnail generation, job queues, and real-time notifications.

## 🚀 Current Progress

**✅ Phase 0** - Project Setup & Planning (COMPLETED)
**✅ Phase 1** - Media Files Table & Basic Thumbnail Storage (COMPLETED)
**✅ Phase 2** - Job Queue Setup & Basic Thumbnail Generation (COMPLETED)
**🔄 Phase 3** - Real-time Notifications via PostgreSQL NOTIFY/LISTEN (READY TO START)

**Latest Achievement**: Phase 2C completed with full HTTP & CLI integration! The thumbnail system now has production-ready API endpoints, comprehensive CLI tools, automatic job enqueueing, and maintenance capabilities. Phase 3 tasks have been improved with domain-driven architecture following proven Phase 2 patterns.

## Implementation Task List

### Status Legend

- 🔄 **In Progress** - Currently being worked on
- ✅ **Done** - Completed and tested
- 🚫 **Blocked** - Waiting on other tasks or decisions

### Completed Work

**Phase 0:** Project Setup & Planning - ✅ **COMPLETED** ([details](./completed-achievements.md#phase-0-project-setup--planning---completed))

- ✅ 0.1-0.5: Task tracking, grimoire package, architecture patterns, database infrastructure

**Phase 1:** Media Files Table & Basic Thumbnail Storage - ✅ **COMPLETED** ([details](./completed-achievements.md#phase-1-media-files-table--basic-thumbnail-storage---completed))

- ✅ 1.1-1.6: Database schema, soft delete infrastructure, domain migrations

**Infrastructure:** Analytics Architecture Refactoring - ✅ **COMPLETED** ([details](./completed-achievements.md#i0-analytics-architecture-refactoring---completed))

- ✅ I.0: Domain logic consolidation, eliminated code duplication, package organization

### Phase 2: Job Queue Setup & Basic Thumbnail Generation ✅ **COMPLETED**

**Scope:** Domain services, job queue infrastructure, thumbnail generation algorithms, HTTP/CLI integration.

**COMPLETED** - Full thumbnail generation system with job queue, HTTP API, and CLI management. See [completed achievements](./completed-achievements.md#phase-2-job-queue-setup--basic-thumbnail-generation---completed) for detailed implementation notes.

#### Phase 2A: Domain Layer (Grimoire Package)

- **2.1** ✅ Create ThumbnailService and ThumbnailRepository in grimoire

Establish thumbnail domain services following our proven architecture patterns. Create `grimoire/src/thumbnails/` module with repository for database operations and service for business logic.

- **2.2** ✅ Add thumbnail configuration to ConfigService

Extend existing ConfigService to handle external tool configuration (imagemagick, ffmpeg) with validation, custom binary paths, and enable/disable flags.

- **2.3** ✅ Create ThumbnailJob struct and ThumbnailError types

Define job structure in grimoire with media blob ID, job type, target dimensions, and comprehensive error handling with custom error types.

- **2.4** ✅ Implement thumbnail generation algorithms

Create thumbnail generation functions for images (imagemagick), video frames (ffmpeg), and audio waveforms with proper error handling and fallbacks.

- **2.5** ✅ Add comprehensive unit tests for thumbnail domain logic

Test thumbnail algorithms, configuration validation, error handling, and repository operations independently of infrastructure.

#### Phase 2B: Infrastructure & Job Queue

- **2.6** ✅ Set up job queue integration with grimoire services

Configure job queue backend and integrate ThumbnailJob with job queue, making jobs use grimoire ThumbnailService.

- **2.7** ✅ Create job worker service using grimoire ThumbnailService

Build worker processes that consume jobs and delegate to grimoire services, keeping infrastructure separate from business logic.

- **2.8** ✅ Add external tool validation and startup checks

Implement startup validation using grimoire ConfigService to check tool availability with clear error messages and configuration guidance.

- **2.9** ✅ Implement job status tracking and retry logic

Add job status updates, exponential backoff retry logic, and error recovery using grimoire repository patterns.

#### Phase 2C: HTTP & CLI Integration ✅ **COMPLETED**

- **2.10** ✅ Add HTTP endpoints for thumbnail management

Create server endpoints for thumbnail status, manual trigger, and progress monitoring using grimoire ThumbnailService.

- **2.11** ✅ Integrate job enqueueing with upload handlers

Modify existing upload endpoints to automatically enqueue thumbnail jobs using grimoire services.

- **2.12** ✅ Create CLI commands for thumbnail operations

Add CLI subcommands for thumbnail status, retry failed jobs, cleanup orphaned thumbnails, and batch operations using grimoire services.

- **2.13** ✅ Add thumbnail cleanup jobs and maintenance

Implement maintenance jobs for cleaning orphaned thumbnails, storage optimization, and scheduled cleanup using job queue system.

### Phase 3: Real-time Notifications via PostgreSQL NOTIFY/LISTEN

**Scope:** Domain services, notification infrastructure, WebSocket integration, client-side event handling, CLI management.

#### Phase 3A: Domain Layer (Grimoire Package)

- **3.1** Create NotificationService and models in grimoire

Establish notification domain services following Phase 2 patterns. Create `grimoire/src/notifications/` module with NotificationEvent, NotificationChannel, NotificationConfig models and comprehensive error handling.

- **3.2** Add notification configuration to ConfigService

Extend existing ConfigService with NotificationConfig for WebSocket settings, PostgreSQL NOTIFY/LISTEN configuration, and channel management rules.

- **3.3** Implement event publishing abstractions

Create Publisher trait with PostgresNotificationPublisher and WebSocketNotificationPublisher implementations, plus mock publishers for testing.

- **3.4** Create notification filtering and routing

Add user permission-based event filtering, channel subscription management, event deduplication and rate limiting using grimoire services.

- **3.5** Add comprehensive unit tests for notification domain

Test event creation, filtering, routing, publisher abstractions, configuration validation, and error handling independently of infrastructure.

#### Phase 3B: Infrastructure & Event Streaming

- **3.6** Set up PostgreSQL NOTIFY triggers and listeners

Configure database triggers for thumbnail job state changes, connection pools for LISTEN operations, and integration with grimoire NotificationService.

- **3.7** Implement WebSocket server infrastructure

Build WebSocket connection management with authentication, lifecycle handling, heartbeat/reconnection, and integration with grimoire event routing.

- **3.8** Create notification worker service

Build background workers that consume PostgreSQL notifications, route events through grimoire NotificationService, and deliver to WebSocket clients with retry logic.

- **3.9** Add connection state management

Implement user session tracking, WebSocket mapping, subscription management per connection, and graceful cleanup with memory leak prevention.

- **3.10** Implement notification queuing for reliability

Add queuing for offline clients, persistent storage for undelivered messages, delivery confirmation and retry logic, plus queue cleanup and maintenance.

#### Phase 3C: HTTP & CLI Integration

- **3.11** Add HTTP endpoints for notification management

Create server endpoints for notification status, connection metrics, test notifications, and admin broadcast messages using grimoire NotificationService.

- **3.12** Create CLI commands for notification operations

Add CLI subcommands for system health, connection monitoring, test notifications, and queue cleanup using grimoire services.

- **3.13** Add client-side WebSocket integration

Develop JavaScript client library for WebSocket connections with automatic reconnection, subscription management, and event handler registration.

- **3.14** Implement notification maintenance system

Add maintenance jobs for notification cleanup, connection monitoring, performance metrics, and integration with existing maintenance scheduler.

**Phase 3 Summary**: Real-time notification system following proven Phase 2 domain-driven architecture. Provides PostgreSQL NOTIFY/LISTEN integration, WebSocket infrastructure, and comprehensive management tools while maintaining clean separation between domain logic (grimoire), infrastructure (server), and integration (CLI/HTTP). See [Phase 3 improvement recommendations](./phase-3-improvement-recommendations.md) for detailed architectural decisions.

### Phase 4: Cursor-Based Pagination for Efficient Sync

**Scope:** Database indexing, pagination API design, sync algorithms, cursor generation, client integration.

- **4.1** ✅ Add cursor-based pagination to media blobs queries

Replace limit/offset pagination with cursor-based pagination for better performance.

**COMPLETED** - Implemented comprehensive cursor-based pagination system with:

- New `MediaBlobCursor` model using timestamp + ID for unique ordering
- `PaginatedResult<T>` wrapper with rich pagination metadata
- Dual pagination support (cursor and offset) in `MediaBlobQuery`
- Base64-encoded cursors for API safety
- Forward/backward pagination direction support
- Grimoire domain layer with `MediaBlobRepository` and `MediaBlobService`
- Updated server repository to use grimoire services
- Backward compatibility with existing offset-based pagination
- Enhanced filtering with timestamp ranges (`created_after`, `created_before`)
- Comprehensive error handling and validation
- Integration tests framework for pagination verification

- **4.2** Implement sync endpoints with timestamp cursors

Create API endpoints that support efficient synchronization using timestamp-based cursors.

- **4.3** Add client-side sync state management

Implement client-side logic to track sync state and handle incremental updates.

- **4.4** Create incremental sync algorithms

Develop algorithms to efficiently sync only changed data since last sync.

- **4.5** Add conflict resolution for concurrent updates

Handle scenarios where multiple clients update the same data simultaneously.

- **4.6** Implement sync progress tracking

Add progress indicators and status reporting for long-running sync operations.

- **4.7** Add sync pause/resume functionality

Allow clients to pause and resume sync operations without data loss.

### Phase 5: Client-Side Sync Integration

**Scope:** JavaScript client library, local storage, offline support, sync UI components.

- **5.1** Create JavaScript client library for media blob sync

Develop reusable JavaScript library for handling media blob synchronization.

- **5.2** Implement local storage caching

Add client-side caching with IndexedDB or similar for offline access.

- **5.3** Add offline queue for pending operations

Queue client operations when offline and sync when connection is restored.

- **5.4** Create sync status UI components

Build UI components to show sync progress, conflicts, and connection status.

- **5.5** Implement selective sync (folders, file types)

Allow clients to choose which content to sync based on folders, file types, or other criteria.

- **5.6** Add background sync for service workers

Implement service worker integration for background synchronization.

### Phase 6: Client Library Architecture & Demo Integration

**Scope:** Package structure, TypeScript definitions, demo applications, documentation, testing.

- **6.1** Structure client library as npm package

Package the JavaScript client library for easy distribution and consumption.

- **6.2** Add TypeScript definitions

Provide TypeScript support with comprehensive type definitions.

- **6.3** Create demo applications

Build example applications demonstrating different integration patterns.

- **6.4** Write integration documentation

Create comprehensive documentation for integrating the client library.

- **6.5** Add automated testing for client library

Implement unit tests and integration tests for the client library.

- **6.6** Package and distribute client libraries

Set up proper packaging and distribution for the client libraries.

### Infrastructure & DevOps Tasks

**Phase Overview:** Production deployment and operational requirements for thumbnail generation system.

- **I.1** Add imagemagick and ffmpeg to Docker containers/deployment

Ensure the necessary image and video processing tools are available in the deployment environment.

- **I.2** Configure file system permissions for thumbnail storage

Set up proper file system permissions and media blob serving routes with access control.

- **I.3** Add monitoring and logging for job queue health

Implement monitoring to track job queue performance, failure rates, and processing times.

- **I.4** Set up backup strategy for generated thumbnails

Plan backup and recovery procedures for generated thumbnails.

- **I.5** Document deployment requirements and dependencies

Create comprehensive deployment documentation covering all dependencies.

- **I.6** Create CLI commands for delete operations

Add CLI subcommands for managing soft deletes and triggering hard delete jobs.

- **I.7** Add configuration for soft delete retention periods

Create configuration options for setting retention periods for soft-deleted items.

### Testing & Quality Assurance

**Phase Overview:** Comprehensive testing strategy for thumbnail generation and sync functionality.

- **T.1** Add integration tests for job queue processing

Test complete job lifecycle from enqueueing to completion.

- **T.2** Create performance tests for thumbnail generation

Benchmark thumbnail generation performance with various file sizes and formats.

- **T.3** Add WebSocket connection testing

Test WebSocket reliability, reconnection, and message delivery.

- **T.4** Implement sync correctness tests

Verify that sync algorithms maintain data consistency across clients.

- **T.5** Add load testing for concurrent operations

Test system behavior under high load with multiple concurrent operations.

- **T.6** Create error recovery testing

Test system resilience and recovery from various failure scenarios.

### Future Enhancements (Post-MVP)

**Phase Overview:** Advanced features and optimizations for production deployment.

- **F.1** Implement smart thumbnail caching

Add intelligent caching strategies for thumbnails with CDN integration.

- **F.2** Add thumbnail size optimization

Dynamically optimize thumbnail sizes based on usage patterns.

- **F.3** Create advanced media processing

Add support for additional media formats and processing options.

- **F.4** Implement distributed job processing

Scale job processing across multiple workers or servers.

- **F.5** Add advanced sync features

Implement features like selective sync, bandwidth optimization, and conflict resolution UI.

### Phase 7: Books Domain Implementation (Future)

**Scope:** Book-specific features, metadata handling, reading progress, bookmarks.

- **7.1** Implement book upload and metadata extraction
- **7.2** Add reading progress tracking
- **7.3** Create bookmark and annotation system
- **7.4** Add book organization (collections, tags)
- **7.5** Implement full-text search for books

### Phase 8: Documents Domain Implementation (Future)

**Scope:** Document processing, OCR, search, versioning, collaboration features.

- **8.1** Add document upload and processing
- **8.2** Implement OCR for scanned documents
- **8.3** Create document search and indexing
- **8.4** Add document versioning
- **8.5** Implement collaboration features

### Phase 9: Federation & Distributed Server Architecture (Future)

**Scope:** Multi-server deployment, data federation, cross-server sync, distributed authentication.

- **9.1** Design federation protocol
- **9.2** Implement cross-server authentication
- **9.3** Add distributed data sync
- **9.4** Create server discovery and routing
- **9.5** Implement conflict resolution across servers
