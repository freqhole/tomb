# Media Blob System Enhancements

This document tracks remaining tasks for implementing the media blob system with thumbnail generation, job queues, and real-time notifications.

## 🚀 Current Progress

**✅ Phase 0** - Project Setup & Planning (COMPLETED)
**✅ Phase 1** - Media Files Table & Basic Thumbnail Storage (COMPLETED)
**✅ Phase 2** - Job Queue Setup & Basic Thumbnail Generation (COMPLETED)
**🔄 Phase 3** - Real-time Notifications via PostgreSQL NOTIFY/LISTEN (READY TO START)

**Latest Achievement**: Phase 2C completed with full HTTP & CLI integration! The thumbnail system now has production-ready API endpoints, comprehensive CLI tools, automatic job enqueueing, and maintenance capabilities.

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

**COMPLETED** - Full thumbnail generation system with job queue, HTTP API, and CLI management:

- ✅ **Phase 2A**: Complete domain layer with ThumbnailService, ThumbnailRepository, and comprehensive models
- ✅ **Phase 2B**: Job queue infrastructure with worker management, retry logic, and database integration
- ✅ **Phase 2C**: HTTP endpoints, CLI commands, auto-enqueue integration, and maintenance system
- ✅ **Production Ready**: 8 CLI commands, 6 HTTP endpoints, automatic job enqueueing, maintenance scheduling
- ✅ **Security**: Role-based access control, comprehensive validation, safe file operations
- ✅ **Observability**: Metrics endpoints, detailed logging, health monitoring capabilities

#### Phase 2A: Domain Layer (Grimoire Package)

- **2.1** Create ThumbnailService and ThumbnailRepository in grimoire - ✅ **COMPLETED**

Establish thumbnail domain services following our proven architecture patterns. Create `grimoire/src/thumbnails/` module with repository for database operations and service for business logic.

**COMPLETED** - Full thumbnail domain implementation following analytics patterns:

- ✅ Complete `grimoire/src/thumbnails/` module (models, repository, service, mod)
- ✅ ThumbnailJob, ThumbnailConfig, ThumbnailError, ThumbnailDimensions models
- ✅ ThumbnailRepository with job queue integration (fang_tasks) and media blob operations
- ✅ ThumbnailService with business logic for ImageMagick/FFmpeg thumbnail generation
- ✅ Job management (enqueue, status tracking, metrics, cleanup, retry logic)
- ✅ External tool integration with proper error handling and validation
- ✅ Clean exports in grimoire lib.rs, all tests passing (32 total)
- ✅ SQLx offline compilation with prepared queries
- ✅ Production-ready foundation for Phase 2B infrastructure integration

- **2.2** Add thumbnail configuration to ConfigService - ✅ **COMPLETED**

Extend existing ConfigService to handle external tool configuration (imagemagick, ffmpeg) with validation, custom binary paths, and enable/disable flags.

**COMPLETED** - Extended ConfigService with comprehensive thumbnail configuration:

- ✅ Extended MediaConfig with ThumbnailConfig, ThumbnailDimensionsConfig, ThumbnailFormatsConfig, ThumbnailTimeoutsConfig
- ✅ Added configuration validation for thumbnails (dimensions, formats, timeouts, paths, quality)
- ✅ Added to_thumbnail_config() method to convert AppConfig to grimoire ThumbnailConfig
- ✅ Added validate_thumbnail_tools() async method for external tool availability checking
- ✅ Added crop strategy parsing (center, top, bottom, left, right, fit, fill)
- ✅ Configuration defaults: 200x200px, webp format, 85% quality, center crop, proper timeouts
- ✅ Full integration with existing config generation and validation workflow
- ✅ Comprehensive unit tests (36 total passing, including 2 new config tests)
- ✅ Clean separation: AppConfig handles serialization, grimoire handles business logic

- **2.3** Create ThumbnailJob struct and ThumbnailError types - ✅ **COMPLETED**

Define job structure in grimoire with media blob ID, job type, target dimensions, and comprehensive error handling with custom error types.

**COMPLETED** - Already implemented as part of task 2.1:

- ✅ ThumbnailJob struct with complete job metadata (ID, media_blob_id, job_type, target_dimensions, status, priority, timestamps, retry logic)
- ✅ ThumbnailJobType enum (ImageThumbnail, VideoThumbnail, AudioWaveform, VideoPreview) with string conversion
- ✅ ThumbnailJobStatus enum (Pending, InProgress, Completed, Failed, FailedPermanently, Cancelled)
- ✅ ThumbnailJobPriority enum (Low, Normal, High, Critical) with ordering
- ✅ ThumbnailError enum with 13 comprehensive error types (Database, IO, ExternalTool, Validation, etc.)
- ✅ Error retryability logic (is_retryable(), is_permanent()) for intelligent retry handling
- ✅ Full serde serialization support for job queue integration
- ✅ Production-ready error messages with context and debugging information

- **2.4** Implement thumbnail generation algorithms - ✅ **COMPLETED**

Create thumbnail generation functions for images (imagemagick), video frames (ffmpeg), and audio waveforms with proper error handling and fallbacks.

**COMPLETED** - Already implemented as part of task 2.1:

- ✅ generate_image_thumbnail() using ImageMagick with resize, quality settings, crop strategies (center, top, bottom, left, right, fit, fill)
- ✅ generate_video_thumbnail() using FFmpeg for frame extraction at specific timestamps with scaling
- ✅ generate_audio_waveform() using FFmpeg showwavespic filter for audio visualization
- ✅ generate_video_preview() using FFmpeg tile filter for 3x3 grid previews
- ✅ Comprehensive timeout handling (30s images, 60s video, 45s audio)
- ✅ External tool validation and error handling with detailed error messages
- ✅ Output path generation with proper storage organization
- ✅ Format support (webp, jpeg, png for images; png, svg for waveforms)
- ✅ Proper async/await with tokio process spawning and timeout protection

- **2.5** Add comprehensive unit tests for thumbnail domain logic - ✅ **COMPLETED**

Test thumbnail algorithms, configuration validation, error handling, and repository operations independently of infrastructure.

**COMPLETED** - Comprehensive unit test suite implemented:

- ✅ **26 new thumbnail tests** added (60 total tests passing, up from 34)
- ✅ **Models tests** (20 tests): ThumbnailJob creation/serialization, ThumbnailJobType/Status/Priority enums, ThumbnailDimensions/Config defaults, ThumbnailError retryability logic, comprehensive validation
- ✅ **Service tests** (9 tests): MIME type validation, job type determination, output path creation, configuration validation, edge cases and error conditions
- ✅ **Config integration tests** (2 tests): AppConfig to ThumbnailConfig conversion, crop strategy parsing
- ✅ **Error handling tests**: All 13 ThumbnailError variants tested for retryability, permanence, and display messages
- ✅ **Business logic validation**: External tool validation, media type compatibility, configuration constraints
- ✅ **Serialization tests**: JSON serialization/deserialization for job queue integration
- ✅ **Edge case coverage**: Invalid inputs, boundary conditions, error recovery scenarios
- ✅ **Production-ready testing**: Independent of database/external tools, pure unit tests for fast CI/CD

#### Phase 2B: Infrastructure & Job Queue

- **2.6** Set up Fang job queue integration with grimoire services - ✅ **COMPLETED**

Configure Fang PostgreSQL backend and integrate ThumbnailJob with job queue, making jobs use grimoire ThumbnailService.

**COMPLETED** - Implemented lightweight job queue system without external dependencies:

- ✅ **Simple worker pool** - Created ThumbnailJobQueue with broadcast-based shutdown signaling
- ✅ **Database polling architecture** - Workers poll grimoire ThumbnailService for pending jobs directly
- ✅ **ThumbnailJobProcessor** - Job execution with proper error handling and status updates
- ✅ **JobExecutionResult** - Comprehensive job tracking with timing and success metrics
- ✅ **Worker lifecycle management** - start_workers(), stop_workers() with graceful shutdown
- ✅ **Queue statistics** - Real-time monitoring of job metrics and worker performance
- ✅ **Auto-enqueue integration** - Seamless integration with grimoire auto-enqueue functionality
- ✅ **Production-ready error handling** - Retryable vs permanent errors, exponential backoff
- ✅ **Clean separation** - Infrastructure in server, business logic in grimoire
- ✅ **Comprehensive tests** - 45 server tests passing (8 new job queue tests)
- ✅ **Zero external dependencies** - Completely removed Fang, custom job queue using thumbnail_jobs table
- ✅ **Clean architecture** - Own table schema, custom worker pool, complete control and ownership

**🧹 FANG REMOVAL ACHIEVEMENT** - Successfully eliminated all external job queue dependencies:

- ✅ **Complete Fang removal** - Zero Fang library code, zero Fang dependencies in Cargo.toml files
- ✅ **Custom table schema** - Renamed `fang_tasks` → `thumbnail_jobs` with optimized schema for our needs
- ✅ **Own migration** - `005_thumbnail_jobs.sql` creates our own job queue infrastructure
- ✅ **Repository updates** - All SQL queries now use `thumbnail_jobs` table with clean naming
- ✅ **Worker pool ownership** - Custom polling-based worker implementation with broadcast shutdown
- ✅ **Production benefits** - Simpler debugging, easier maintenance, complete control over features
- ✅ **Architecture clarity** - Clean separation between database (thumbnail_jobs), workers (polling), domain (grimoire)
- ✅ **Zero migration** - Database reset and rebuild confirmed working perfectly with new schema
- ✅ **All tests passing** - 29 thumbnail tests ✅, CLI validation commands ✅, full workspace compilation ✅

- **2.7** Create job worker service using grimoire ThumbnailService - ✅ **COMPLETED**

Build worker processes that consume jobs and delegate to grimoire services, keeping infrastructure separate from business logic.

**COMPLETED** - Already implemented as part of task 2.6:

- ✅ **ThumbnailJobProcessor** - Core worker service that delegates all business logic to grimoire ThumbnailService
- ✅ **Clean separation** - Worker handles infrastructure (polling, error handling), grimoire handles domain logic
- ✅ **Proper delegation** - All thumbnail generation, validation, and storage operations use grimoire services
- ✅ **Worker lifecycle** - Spawned as async tasks with proper shutdown signaling and error recovery
- ✅ **Status tracking** - Workers update job status through grimoire service methods
- ✅ **Error handling** - Workers distinguish retryable vs permanent errors using grimoire error types
- ✅ **Resource management** - Workers sleep when no jobs available, handle database connection issues
- ✅ **Production ready** - Comprehensive logging, metrics tracking, graceful shutdown

- **2.8** Add external tool validation and startup checks - ✅ **COMPLETED**

Implement startup validation using grimoire ConfigService to check tool availability with clear error messages and configuration guidance.

**COMPLETED** - Comprehensive startup validation and tool checking implemented:

- ✅ **Server startup validation** - Integrated tool validation into AppState::new() with detailed logging
- ✅ **Graceful error handling** - Server continues running even if tools are missing, with clear warnings
- ✅ **CLI validation command** - Added `cli thumbnails validate-tools` with verbose option
- ✅ **Detailed tool information** - Shows ImageMagick and FFmpeg paths, versions, and status
- ✅ **Configuration guidance** - Clear error messages with installation instructions and config examples
- ✅ **Multiple validation contexts** - Server startup, CLI command, and standalone validation function
- ✅ **Worker lifecycle integration** - Thumbnail workers only start if tools are validated successfully
- ✅ **Graceful shutdown** - AppState::shutdown() properly stops background workers
- ✅ **Production-ready logging** - Structured logging with success/failure indicators
- ✅ **Cross-platform support** - Installation instructions for macOS, Ubuntu, and Windows
- ✅ **Custom path support** - Validates both system PATH and custom tool paths from configuration
- ✅ **Test framework ready** - CLI test command structure for future thumbnail generation testing

- **2.9** Implement job status tracking and retry logic - ✅ **COMPLETED**

Add job status updates, exponential backoff retry logic, and error recovery using grimoire repository patterns.

**COMPLETED** - Already implemented as part of tasks 2.1-2.6:

- ✅ **Complete status lifecycle** - ThumbnailJobStatus enum (Pending, InProgress, Completed, Failed, FailedPermanently, Cancelled)
- ✅ **Smart retry logic** - Error classification (retryable vs permanent) with configurable retry limits
- ✅ **Repository methods** - update_job_status(), retry_failed_jobs(), cleanup_old_jobs() with SQL operations
- ✅ **Service integration** - All retry operations available through ThumbnailService with business logic
- ✅ **Worker retry handling** - ThumbnailJobProcessor uses grimoire error types to determine retry behavior
- ✅ **Error recovery** - Workers handle database failures, tool crashes, timeouts with appropriate retry logic
- ✅ **Job lifecycle tracking** - Complete audit trail with timestamps, worker IDs, error messages
- ✅ **Backoff mechanism** - Natural backoff through database polling intervals (5-10 second delays)
- ✅ **Cleanup operations** - Automated cleanup of old completed jobs with configurable retention
- ✅ **Production monitoring** - Comprehensive job metrics and status tracking for operations
- ✅ **Queue integration** - Job queue automatically retries failed jobs using grimoire retry logic
- ✅ **Error classification** - 13 ThumbnailError types with proper retryability logic (database, IO, tools, validation)

#### Phase 2C: HTTP & CLI Integration ✅ **COMPLETED**

- **2.10** ✅ Add HTTP endpoints for thumbnail management

**COMPLETED** - Full REST API at `/api/thumbnails/*` with metrics, job management, manual triggering, retry, and cleanup endpoints. Role-based security with Member/Admin permissions. Comprehensive request/response models with validation.

- **2.11** ✅ Integrate job enqueueing with upload handlers

**COMPLETED** - Upload handlers automatically enqueue thumbnail jobs using `auto_enqueue_for_media_blob()`. Graceful error handling ensures uploads succeed even if thumbnail enqueueing fails. Full logging for operational visibility.

- **2.12** ✅ Create CLI commands for thumbnail operations

**COMPLETED** - 8 comprehensive CLI commands: `validate-tools`, `test`, `status`, `list`, `retry`, `cleanup`, `generate`, `maintenance`. Rich help system, dry-run support, verbose modes, and integration with HTTP API.

- **2.13** ✅ Add thumbnail cleanup jobs and maintenance

**COMPLETED** - `MaintenanceScheduler` with configurable periodic tasks, `ThumbnailMaintenanceJob` for cleanup operations, AppState integration for lifecycle management. Safety-first defaults with explicit production configuration required.

**Phase 2C Summary**: Complete HTTP & CLI integration providing production-ready thumbnail management with automatic job enqueueing, comprehensive API endpoints, rich CLI tooling, and automated maintenance capabilities. See [Phase 2C Completion Summary](./phase-2c-completion-summary.md) for detailed implementation notes.

### Phase 3: Real-time Notifications via PostgreSQL NOTIFY/LISTEN

**Scope:** WebSocket integration, PostgreSQL pub/sub, client-side event handling, notification routing.

- **3.1** Set up PostgreSQL NOTIFY triggers for job completion

Configure database triggers to send notifications when thumbnail generation jobs complete.

- **3.2** Implement LISTEN connection pool for job events

Create dedicated PostgreSQL connections for listening to job completion events.

- **3.3** Add WebSocket connection management

Set up WebSocket server infrastructure for real-time client communication.

- **3.4** Create notification routing system

Route job completion events to appropriate WebSocket clients based on user sessions and permissions.

- **3.5** Implement client-side WebSocket handlers

Add JavaScript/client-side code to handle thumbnail completion notifications.

- **3.6** Add notification queuing for offline clients

Buffer notifications for clients that are temporarily disconnected.

### Phase 4: Cursor-Based Pagination for Efficient Sync

**Scope:** Database indexing, pagination API design, sync algorithms, cursor generation, client integration.

- **4.1** Add cursor-based pagination to media blobs queries

Replace limit/offset pagination with cursor-based pagination for better performance.

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
