# Media Blob System Enhancements

This document outlines the planned enhancements to the media blob system, including thumbnail generation, job queuing, WebSocket notifications, and cursor-based pagination.

## Implementation Task List

### Status Legend

- 🔄 **In Progress** - Currently being worked on
- ✅ **Done** - Completed and tested
- 🚫 **Blocked** - Waiting on other tasks or decisions

### Phase 0: Project Setup & Planning

- ✅ **0.1** Set up comprehensive task tracking system in documentation
- 🔄 **0.2** review and refine phases 1 onward before starting.
- **0.3** Create client/rust/ package for centralized domain logic

Set up a new Rust package at `client/rust/` that will house centralized application domain logic and abstractions. This package will be consumed by HTTP route handlers, WebSocket handlers, the CLI package, and potentially future Rust consumers like a Tauri desktop app.

- **0.4** Establish architectural pattern for minimal existing code changes

Document and establish patterns for adding new functionality through new modules and files rather than modifying existing code. This includes strategies for extending existing handlers, adding new routes, and creating wrapper services that enhance existing functionality without breaking changes.

- **0.5** Explore and implement embedded PostgreSQL option

Evaluate `pg_embed` crate for embedding a full PostgreSQL server in the Rust binary. Add as third database option alongside existing in-memory and standalone PostgreSQL support. This provides zero-config PostgreSQL for development, testing, and single-user deployments.

- **0.5.1** Set up sqlx offline migrations infrastructure

Configure sqlx offline mode with migrations directory, set up .sqlx folder for prepared queries, and establish migration workflow. This enables compile-time query checking and must be done before any sqlx::query! macros are used.

- **0.6** Create filesystem walker service in client/rust package

Develop a filesystem walker service that can recursively scan directories for media files, calculate SHA256 hashes, and create media_blob records. This service will be reusable across CLI tools and future applications.

```
client/rust/
├── src/
│   ├── models/          # MediaFile, Song, Photo, Video domain models
│   ├── repositories/    # Repository traits and implementations
│   ├── services/        # ThumbnailService, SyncService, MediaImportService
│   ├── fs/              # Filesystem walker, file analysis utilities
│   └── lib.rs
└── Cargo.toml
```

### Phase 1: Media Files Table & Basic Thumbnail Storage

**Phase Overview:** Core database architecture for thumbnail system using hybrid file storage.

**Scope:** Database schema, table relationships, API endpoints, client integration. Keep partitioning simple for now.

**Goals:**

- Enhance media_blobs table with thumbnail relationships
- Domain-specific tables referencing media_blobs directly
- Update existing upload workflows
- API access to enhanced media_blobs with thumbnails
- Centralize domain logic in client/rust package
- Soft delete infrastructure
- Filesystem import capabilities
- Secure media blob serving with proper access control
- Remove filesystem path exposure from client APIs

- **1.1** Create migration to enhance `media_blobs` table with thumbnail relationships

Create database migration file to enhance the existing media_blobs table with thumbnail relationship fields (parent_blob_id, blob_type). This eliminates the need for a separate media_files table while maintaining clean thumbnail relationships. Keep partitioning simple for now - can be added later when scaling is needed. See the Database Schema section below for the complete SQL.

- **1.1.1** Run migrations and prepare sqlx offline queries

Execute the migrations to create tables and run `sqlx prepare` to generate .sqlx files for compile-time query checking. This step ensures all subsequent tasks using sqlx::query! macros will compile successfully.

- **1.1.2** Design schema for future partitioning (optional)

Plan how partitioning could be added later when needed (10M+ rows). Consider yearly partitions or capacity-based triggers. Keep current implementation simple with regular indexes. Document partitioning strategy for future reference but don't implement yet.

- **1.2** Create migration for version column and update triggers with partition support

Create database migration to add version tracking infrastructure. Implement PostgreSQL triggers to automatically maintain both `updated_at` timestamps and `version` numbers when media_blobs records are modified. The version column uses `txid_current()` for reliable cursor-based pagination that will be implemented in Phase 4. Ensure triggers work correctly across partitioned tables.

- **1.2.1** Create migration for soft delete columns

Create database migration to add `deleted_at TIMESTAMPTZ` and `deleted_by UUID` columns to media_blobs table. Create database views that filter out deleted records by default, allowing existing queries to work unchanged while providing access to deleted records when needed.

- **1.3** Create migrations for domain tables (songs, photos, videos) that reference media_blobs

Create database migrations for domain-specific tables that will house records for particular media types. Each domain table references media_blobs directly, creating clean separation between file storage and domain logic.

- **1.3.1** Plan domain table structure for books and documents

Design database schemas for future books domain (PDF, EPUB, etc.) and documents domain (HTML, Markdown stored as blobs). Ensure the enhanced media_blobs architecture can accommodate different storage patterns (books may have disk storage, documents typically in-database storage).

- **1.3.2** Run domain table migrations and update sqlx offline preparation

Execute domain table migrations and run `sqlx prepare` to update .sqlx files with new table schemas. This ensures all repository code using sqlx::query! will have access to the enhanced media_blobs table and new domain tables.

- **1.4** Update existing media_blob upload logic to set blob_type and relationships

Modify the current upload handlers to set appropriate blob_type ('original') when new media_blobs are uploaded. This bridges the existing system with the enhanced thumbnail architecture using the same table.

- **1.5** Add API endpoints for querying media_blobs with thumbnail relationships

Create REST endpoints that can efficiently query media_blobs along with their thumbnail relationships, using parent_blob_id to find related thumbnails and original files.

- **1.6** Update client-side MediaBlobManager to handle enhanced media_blobs structure

Enhance the existing MediaBlobManager to work with the enhanced media_blobs structure and understand the parent_blob_id thumbnail relationships.

- **1.12** Enhance MediaBlobManager client library

Enhance the existing MediaBlobManager class in client/js to handle thumbnail relationships via parent_blob_id and blob_type fields. This separates business logic from presentation logic in demos.

- **1.13** Create domain model classes for client-side

Build TypeScript classes (MediaBlob, Song, Photo, Video, Book, Document) that mirror the server-side domain models, providing type safety and encapsulation for client-side business logic.

- **1.14** Update websocket demo to use enhanced MediaBlobManager

Refactor the existing websocket demo to use the enhanced MediaBlobManager abstractions with thumbnail support rather than direct API calls, focusing the demo on presentation logic and UI state management.

- **1.15** Remove client-side URL construction for media blobs

Remove all client-side URL construction logic from MediaBlobManager and other client libraries. Replace with server-provided href/uri properties that handle URL generation based on server configuration.

- **1.7** Create domain models and repositories in client/rust package

Define core domain models (MediaBlob, Song, Photo, Video, Book, Document) and repository traits in the client/rust package. These will provide type-safe abstractions over the database layer and can be used by all consumers.

- **1.8** Create new upload handlers using domain layer (preserve existing)

Create new upload handlers that use the domain models and repositories from client/rust, while preserving existing handlers. This establishes the pattern for centralized business logic without breaking existing functionality. The new handlers can be gradually adopted by changing route registration.

- **1.8.1** Store full filesystem paths in local_path column

Update media_blob storage to use absolute filesystem paths starting from `/` in the local_path column. This provides complete path information while keeping paths local to the server.

- **1.8.2** Create dedicated media blob serving API routes

Add new API routes like `/api/blobs/{media_blob_id}` for serving media blob data from disk, replacing reliance on static file routes. This enables proper access control and security validation.

- **1.8.3** Remove filesystem path exposure from client-facing APIs

Ensure local_path column never appears in client responses. Add computed href/uri properties server-side that provide appropriate URLs based on server configuration and context.

- **1.9** Create soft delete service in domain layer

Implement a SoftDeleteService in client/rust that handles marking records as deleted, managing delete permissions, and scheduling hard delete jobs. This service will be used by new API endpoints and CLI commands.

- **1.10** Create media import service in domain layer

Build a MediaImportService in client/rust that handles importing files from the filesystem, including duplicate detection via SHA256, MIME type detection, blob_type setting, and creation of appropriate domain records (songs, photos, videos).

- **1.11** Add CLI command for filesystem media import

Create a CLI subcommand that accepts a base path and recursively imports all media files, with configurable file type filters and duplicate handling strategies.

### Phase 2: Job Queue Setup & Basic Thumbnail Generation

**Phase Overview:** Asynchronous job processing system using PostgreSQL-based queues and thumbnail generation.

**Scope:** Job queue infrastructure, thumbnail generation algorithms, error handling, database integration.

**Goals:**

- Robust asynchronous job processing using fang
- Thumbnail generation for images, videos, audio
- Error handling and retry mechanisms
- Job completion database updates
- Automatic thumbnail generation for uploads
- Centralize job logic in domain layer

- **2.1** Add `fang` dependency to Cargo.toml

Add the fang crate with PostgreSQL async features to enable job queue functionality.

- **2.2** Set up fang database tables and configuration

Initialize the fang job queue tables in PostgreSQL and configure connection pooling and worker settings.

- **2.3** Create `ThumbnailJob` struct and implement `AsyncRunnable`

Design the core job structure that will handle different types of thumbnail generation (image resize, video frame extraction, audio waveform generation).

- **2.4** Implement image thumbnail generation using imagemagick

Use the configurable `convert` command to resize images to 100x100px thumbnails and convert to WebP format for efficiency. Include configuration validation and graceful fallbacks when imagemagick is not available.

- **2.5** Implement video frame extraction using ffmpeg

Use configurable ffmpeg to extract frames from video files at specific timestamps (e.g., 1 second in) and resize them to 100x100px thumbnail dimensions. Include configuration validation and graceful fallbacks when ffmpeg is not available.

- **2.6** Implement audio waveform generation using ffmpeg

Use configurable ffmpeg's `showwavespic` filter to generate 100x100px visual waveform representations of audio files as thumbnail images. Include configuration validation and graceful fallbacks when ffmpeg is not available.

- **2.7** Add job worker startup logic to main server process

Integrate fang worker pool startup into the main server process, allowing jobs to be processed in-process initially (can be separated later for scaling). Include external tool validation during startup with clear error messages and configuration guidance.

- **2.8** Create job enqueueing logic for new media blob uploads

Automatically enqueue thumbnail generation jobs when new media blobs are uploaded, determining the appropriate job types based on MIME type.

- **2.9** Add error handling and retry logic for failed jobs

Implement robust error handling with exponential backoff and maximum retry limits for thumbnail generation failures.

- **2.10** Update media_blobs records when thumbnails are generated

Create new media_blob records for generated thumbnails with appropriate parent_blob_id and blob_type when jobs complete successfully.

- **2.11** Create thumbnail service in client/rust package

Develop a ThumbnailService in the domain layer that encapsulates thumbnail generation logic, job enqueueing, and media_files updates. This service can be used by web handlers, CLI commands, or future applications.

- **2.14** Create ThumbnailManager client library

Build a client-side ThumbnailManager that handles thumbnail loading, caching, and status tracking. This provides clean APIs for demos to display thumbnails without managing the underlying complexity.

- **2.15** Add thumbnail status tracking to client models

Extend the client-side MediaFile models to track thumbnail generation status (pending, processing, completed, failed) and provide reactive updates when status changes.

- **2.16** Update demo UI to use ThumbnailManager

Enhance the demo interface to use the new ThumbnailManager for displaying thumbnails with loading states, error handling, and automatic refreshing when generation completes.

- **2.12** Add batch import jobs for filesystem scanning

Create job types for processing large filesystem imports in batches, allowing the import process to be resumable and providing progress feedback. This enables importing large media libraries without blocking other operations.

- **2.17** Add external tool configuration and validation

Create a configuration system for external tools (imagemagick, ffmpeg) with options to disable thumbnail generation, specify custom binary paths, and validate tool availability at startup. Include clear error messages and setup guidance when tools are missing.

- **2.13** Add hard delete cleanup jobs

Create job types for performing hard deletes of soft-deleted records after a configurable retention period. Start with simple "delete everything marked for deletion" jobs that can be triggered via CLI, with future automation capabilities.

### Phase 3: Real-time Notifications via PostgreSQL NOTIFY/LISTEN

**Phase Overview:** Real-time notifications using PostgreSQL NOTIFY/LISTEN for thumbnail completion.

**Scope:** PostgreSQL notification triggers, WebSocket broadcasting, client-side event handling, UI updates.

**Goals:**

- Real-time notifications for thumbnail generation
- Responsive UI without manual refresh
- Reliable WebSocket event delivery
- Connection failure handling
- Immediate user feedback

- **3.1** Create WebSocket notification handler for PostgreSQL LISTEN

Set up a PostgreSQL listener that can receive NOTIFY events and translate them into WebSocket messages for connected clients.

- **3.2** Add NOTIFY triggers to send events when jobs complete

Create database triggers that send PostgreSQL NOTIFY events when thumbnail generation jobs complete, including relevant metadata.

- **3.3** Implement WebSocket event broadcasting to connected clients

Build the logic to broadcast thumbnail completion events to relevant WebSocket clients, potentially filtering by user permissions.

- **3.4** Add client-side WebSocket event handling for thumbnail updates

Update the client-side code to listen for thumbnail completion notifications and refresh the UI accordingly.

- **3.5** Update UI to refresh thumbnails when notifications are received

Enhance the Media Library interface to automatically show new thumbnails when they become available, without requiring page refresh.

- **3.6** Test notification delivery and handle connection failures gracefully

Ensure the notification system works reliably and degrades gracefully when WebSocket connections are lost or PostgreSQL notifications fail.

- **3.7** Add soft delete notifications

Extend the notification system to broadcast soft delete events, allowing connected clients to remove items from their UI immediately while maintaining the ability to restore deleted items.

- **3.8** Create EventManager client library

Develop an EventManager class that provides clean abstractions for handling all WebSocket events (thumbnail completion, soft deletes, sync notifications) with proper error handling and reconnection logic.

- **3.9** Add reactive state management for real-time updates

Create reactive state primitives in the client library that automatically update when WebSocket events are received, providing clean APIs for demos to bind to real-time data.

- **3.10** Update demo to use EventManager for real-time features

Refactor the demo to use EventManager abstractions instead of direct WebSocket handling, focusing on presentation logic while the library handles the event complexity.

### Phase 4: Cursor-Based Pagination for Efficient Sync

**Phase Overview:** Efficient synchronization system using sequence-based cursors for incremental updates.

**Scope:** Database versioning, cursor-based APIs, change tracking, efficient pagination.

**Goals:**

- Minimize data transfer (sync only changes)
- Reliable cursor-based pagination
- Efficient client state management
- Multi-client synchronization
- Foundation for offline-capable applications

- **4.1** Create migration for `version` column on media_blobs table using txid_current()

Create database migration to implement sequence-based versioning using PostgreSQL's transaction ID system to track when media_blobs records are created or modified. Note: media_files already has version tracking from task 1.2.

- **4.2** Create migration for update trigger to maintain version numbers on media_blobs changes

Create database migration to set up triggers that automatically update version numbers when media_blobs records are modified, ensuring reliable change tracking. This follows the same pattern established for media_files in task 1.2.

- **4.3** Add database index for efficient version-based queries on media_blobs

Create optimized indexes on the version column to enable fast cursor-based pagination queries. Note: media_files index was already created in task 1.2. Ensure indexes are created on all partition tables and handle partition pruning efficiently.

- **4.4** Implement API endpoint for cursor-based media_blobs queries with partition awareness

Build REST endpoints that accept cursor parameters and return paginated results with next cursor information. Include hybrid pagination strategy using both timestamps (for recent data) and version numbers (for older data) to optimize performance across partitioned tables.

- **4.5** Create MediaBlobsQuery and MediaBlobsResponse structs

Define the request/response structures for cursor-based pagination with proper serialization and validation.

- **4.6** Add PostgreSQL NOTIFY trigger for media_blob changes

Set up notifications to alert clients when new changes are available for syncing, enabling real-time sync triggers. Design notifications to support future federated scenarios where changes might originate from remote servers.

- **4.8** Add federation markers to cursor pagination

Extend cursor pagination to include server origin markers, enabling clients to track sync state across multiple federated servers. This prepares the sync system for multi-server scenarios while remaining backwards compatible.

- **4.7** Test cursor pagination with large datasets

Validate that cursor-based pagination performs well with large numbers of media blobs and concurrent updates.

### Phase 5: Client-Side Sync Integration

**Phase Overview:** Cohesive client-side synchronization system combining real-time notifications with intelligent data sync.

**Scope:** Client-side state management, sync orchestration, UI integration, offline handling, performance optimization.

**Goals:**

- Seamless user experience with real-time updates
- Intelligent sync strategies balancing performance and responsiveness
- Offline scenarios and connection recovery
- Performance optimization for large libraries
- Foundation for offline-capable media management
- Sync abstractions for web, CLI, desktop applications
- Clean client libraries separating business and presentation logic

- **5.1** Create MediaBlobSync class for managing client-side state

Build a client-side synchronization manager that maintains local state and handles incremental updates efficiently.

- **5.2** Implement initial sync logic to populate client cache

Create the logic for first-time sync that fetches all relevant media blobs and establishes the initial cursor position.

- **5.3** Implement incremental sync using cursor-based pagination

Build the incremental sync logic that fetches only changes since the last sync using cursor-based pagination.

- **5.4** Add WebSocket integration for immediate sync triggers

Connect the WebSocket notification system to trigger immediate syncs when changes are available, rather than waiting for periodic polls.

- **5.5** Update UI components to use synchronized data

Modify existing UI components to work with the new synchronized data model and respond to real-time updates.

- **5.6** Add offline handling and sync recovery mechanisms

Implement logic to handle offline scenarios and recover sync state when connectivity is restored.

- **5.7** Performance testing and optimization

Test the complete sync system under load and optimize for performance with large media libraries.

- **5.8** Create sync service abstractions in client/rust package

Develop SyncService traits and implementations in the domain layer that provide sync capabilities. These abstractions can be consumed by the web client, CLI tools, or future desktop applications, each with their own specific transport implementations.

- **5.9** Integrate soft delete handling in sync system

Update the sync system to properly handle soft-deleted records, ensuring clients can distinguish between new records, updates, soft deletes, and hard deletes in their synchronization logic.

- **5.10** Create SyncManager client library with IndexedDB integration

Develop a comprehensive SyncManager that handles cursor-based pagination, local caching, and offline storage using IndexedDB. This provides the foundation for offline-capable applications.

- **5.11** Add Solid.js hooks for sync state

Create custom Solid.js hooks (createMediaSync, createThumbnailState, etc.) that provide reactive access to synchronized data with automatic loading states and error handling.

- **5.12** Implement client-side soft delete management

Build client library support for soft delete operations with optimistic updates, undo functionality, and proper sync handling for deleted items.

- **5.13** Create offline-capable demo using SyncManager

Build a demonstration of offline capabilities using the SyncManager, showing how data persists locally and syncs when connectivity is restored.

- **5.14** Add client-side search and filtering

Implement efficient client-side search and filtering capabilities that work with the synchronized data, providing responsive UI without server round-trips.

### Phase 6: Client Library Architecture & Demo Integration

**Phase Overview:** Clean, reusable client-side libraries encapsulating business logic with clean APIs.

**Scope:** TypeScript libraries, reactive state management, IndexedDB integration, Solid.js hooks, demo refactoring.

**Goals:**

- Clean separation between business and presentation logic
- Reusable client libraries for different applications
- Patterns for reactive state management and offline capabilities
- Demonstration applications showcasing library capabilities
- Foundation for IndexedDB integration and Solid.js hooks

- **6.1** Design client library architecture

Plan the overall structure of client-side libraries including state management, API abstraction, caching strategies, and reactive primitives that will support the new features.

- **6.2** Create base ApiClient with cursor pagination support

Build a foundational ApiClient class that handles cursor-based pagination, error handling, retry logic, and provides the base for all other client services.

- **6.3** Implement client-side data modeling

Create TypeScript interfaces and classes that mirror server-side domain models, providing type safety and encapsulation for all client-side business logic.

- **6.4** Build comprehensive error handling system

Develop a client-side error handling system that can gracefully handle network failures, API errors, and provides meaningful feedback to users.

- **6.5** Create client library test suite

Establish comprehensive testing for all client library components using modern testing frameworks, ensuring reliability and maintainability.

- **6.6** Package and distribute client libraries

Set up proper packaging and distribution for the client libraries, making them easily consumable by demos and future applications.

### Infrastructure & DevOps Tasks

**Phase Overview:** Production deployment and operational requirements for thumbnail generation system.

**Scope:** Container configuration, dependencies, monitoring, backup strategies, documentation.

**Goals:**

- Dependencies available in deployment environments
- Monitoring and observability for job processing
- Reliable backup and recovery procedures
- Document deployment requirements and procedures
- CLI tools for data management and cleanup

- **I.1** Add imagemagick and ffmpeg to Docker containers/deployment

Ensure the necessary image and video processing tools are available in the deployment environment. Provide alternative deployment configurations for environments where these tools cannot be installed.

- **I.2** Configure file system permissions for thumbnail storage

Set up proper file system permissions for the directories where thumbnails will be stored.

- **I.2.1** Configure media blob serving routes and access control

Set up dedicated API routes for serving media blob data with proper authentication, authorization, and rate limiting. Replace static file serving for media content.

- **I.2.2** Add server configuration for media blob URLs

Create configuration options for generating media blob URLs including hostname, port, protocol, and path patterns for different deployment scenarios.

- **I.3** Add monitoring and logging for job queue health

Implement monitoring to track job queue performance, failure rates, and processing times.

- **I.4** Set up backup strategy for generated thumbnails

Plan backup and recovery procedures for generated thumbnails, considering whether to regenerate or restore from backups.

- **I.5** Document deployment requirements and dependencies

Create comprehensive deployment documentation covering all new dependencies and configuration requirements.

- **I.6** Create CLI commands for delete operations

Add CLI subcommands for managing soft deletes and triggering hard delete jobs. Include commands for "delete all soft-deleted items older than X days" and "restore soft-deleted item by ID".

- **I.7** Add configuration for soft delete retention periods

Create configuration options for setting how long soft-deleted items are retained before being eligible for hard deletion, with different policies for different types of media.

- **I.8** Add configuration for filesystem import

Create configuration options for filesystem import including supported file extensions, exclusion patterns, duplicate handling strategies, and batch processing settings.

- **I.9** Add import progress tracking and resumability

Implement progress tracking for filesystem imports with the ability to resume interrupted imports, skip already processed files, and provide detailed progress reporting.

- **I.10** Create external tool configuration documentation

Document all external tool dependencies, installation instructions for different platforms, configuration options for custom binary paths, and deployment strategies for environments with restricted tool installation.

### Testing & Quality Assurance

**Phase Overview:** Comprehensive testing ensuring reliability and performance of thumbnail system.

**Scope:** Unit testing, integration testing, performance testing, error scenarios, end-to-end validation.

**Goals:**

- Validate thumbnail generation algorithm correctness
- Reliable job processing under load and failures
- Test real-time notification delivery and sync reliability
- Performance validation with large datasets
- Graceful error handling and recovery

- **T.1** Write unit tests for thumbnail generation functions

Create comprehensive unit tests for each type of thumbnail generation (image, video, audio).

- **T.2** Add integration tests for job queue processing

Test the complete job processing pipeline from enqueueing to completion and database updates.

- **T.3** Test WebSocket notification delivery under load

Validate that WebSocket notifications work reliably under high load and with many concurrent connections.

- **T.4** Validate cursor pagination with concurrent updates

Test cursor-based pagination with concurrent updates to ensure consistency and no missed records.

- **T.5** End-to-end testing of complete sync workflow

Test the entire sync process from initial load through real-time updates with multiple clients.

- **T.6** Performance testing with large media libraries

Validate system performance with thousands of media files and thumbnails.

- **T.7** Error recovery and failure scenario testing

Test various failure scenarios and ensure graceful recovery and error handling.

### Future Enhancements (Post-MVP)

**Phase Overview:** Advanced features and optimizations extending the core thumbnail system (post-MVP).

**Scope:** Advanced thumbnail techniques, performance optimizations, AI/ML integration, horizontal scaling.

**Goals:**

- Extend thumbnail capabilities with advanced features
- Performance and scalability for high-volume usage
- Intelligent content analysis for better thumbnails
- Horizontal scaling and advanced deployment patterns
- Foundation for future media management features
- Easy development of additional client applications

- **F.1** Add support for multiple thumbnail sizes

Allow configuration of additional thumbnail sizes beyond the initial 100x100px thumbnail (e.g., 300x300, 600x600 for different use cases).

- **F.2** Implement thumbnail caching and CDN integration

Add support for serving thumbnails through CDN for better performance and reduced server load.

- **F.3** Add batch thumbnail regeneration for existing media

Create tools to regenerate thumbnails for existing media files when algorithms or requirements change.

- **F.4** Support for animated GIF/video thumbnails

Generate animated thumbnails for video content or create cinemagraph-style previews.

- **F.5** Smart thumbnail generation (face detection, interesting moments)

Use AI/ML techniques to generate more intelligent thumbnails that focus on faces or interesting content.

- **F.6** Separate worker processes for horizontal scaling

Move job processing to separate worker processes that can be scaled independently of the web server.

- **F.7** Develop Tauri desktop application using client/rust domain layer

Create a desktop application using Tauri that leverages the centralized domain logic from client/rust, demonstrating the reusability of the architecture across different application types.

### Phase 7: Books Domain Implementation (Future)

**Phase Overview:** Comprehensive support for book files (PDF, EPUB, MOBI) with reading features.

**Scope:** Book thumbnail generation (cover extraction), text indexing, reading interface, metadata management.

**Goals:**

- Multiple book formats with unified interface
- Extract and index text content for search
- Automatic book cover thumbnails
- Reading interface with progress tracking
- Annotations and bookmarking

- **7.1** Implement book cover extraction for thumbnails
- **7.2** Add text extraction and indexing for search
- **7.3** Create book reading interface with page/chapter navigation
- **7.4** Add reading progress tracking and bookmarks
- **7.5** Implement annotation system for books

### Phase 8: Documents Domain Implementation (Future)

**Phase Overview:** In-browser document editing system for HTML/Markdown files with Monaco editor integration.

**Scope:** Monaco editor integration, document versioning, real-time editing, collaboration, preview capabilities.

**Goals:**

- Rich editing experience with Monaco editor
- Real-time collaborative editing
- Document versioning and history
- Rich preview for markdown and HTML
- Organizational features (folders, tags, search)

- **8.1** Integrate Monaco editor for document editing
- **8.2** Implement real-time collaborative editing
- **8.3** Add document versioning and history tracking
- **8.4** Create markdown/HTML preview capabilities
- **8.5** Build document organization system (folders, tags)
- **8.6** Add full-text search across all documents

- **F.8** Advanced automated deletion policies

Implement intelligent deletion policies that can automatically hard delete items based on usage patterns, storage pressure, user preferences, or content analysis (e.g., duplicate detection).

- **F.9** Comprehensive audit logging for deletions

Add detailed audit trails for all delete operations (soft and hard) with user attribution, timestamps, and the ability to track the lifecycle of deleted items for compliance and recovery purposes.

- **F.10** Cross-domain content linking and references

Implement a system for linking between different domain types (e.g., linking a document to related photos, songs to album artwork, books to related documents) with automatic relationship discovery.

- **F.11** Advanced search across all domains

Create a unified search system that can find content across songs, photos, videos, books, and documents using text content, metadata, and ML-based content analysis.

- **F.12** Content workflow automation

Implement automated workflows that can process new content (e.g., auto-tag music by genre, extract text from PDFs for indexing, generate summaries of documents) using job queue system.

### Phase 9: Federation & Distributed Server Architecture (Future)

**Phase Overview:** Federated media management system where multiple servers can sync and share libraries using PostgreSQL FDW.

**Scope:** PostgreSQL FDW setup, federated queries, cross-server auth, distributed sync, partition-based federation.

**Goals:**

- Multiple independent servers sharing media catalogs
- Federated search across server instances
- Secure cross-server authentication and authorization
- Selective federation (public vs private content)
- Eventual consistency across federated servers
- Offline operation with sync-when-connected patterns

- **9.1** Implement PostgreSQL Foreign Data Wrapper (FDW) for cross-server queries
- **9.2** Create federated server discovery and registration system
- **9.3** Add cross-server authentication and authorization
- **9.4** Implement federated search across multiple servers
- **9.5** Create selective federation policies (public vs private content)
- **9.6** Add partition-based federation routing
- **9.7** Implement federated real-time notifications
- **9.8** Create conflict resolution for federated sync

- **F.13** Advanced federation features

Implement advanced federation capabilities like federated playlists, cross-server collaborative editing, distributed backup strategies, and automatic load balancing across federated servers.

- **F.14** Blockchain-based content verification

Add optional blockchain integration for content authenticity, provenance tracking, and decentralized content distribution across federated servers.

## Overview

The media blob system will be enhanced with the following capabilities:

- Automatic thumbnail generation for images, videos, and audio files
- Asynchronous job processing using a PostgreSQL-based queue
- Real-time notifications via WebSocket using PostgreSQL NOTIFY/LISTEN
- Cursor-based pagination for efficient client synchronization
- Extensible domain architecture supporting music, photos, videos, books, and documents
- Clean separation between file storage and domain-specific business logic
- Schema designed for future partitioning when scaling is needed
- Future federation capabilities using PostgreSQL Foreign Data Wrappers (FDW)

## 1. Enhanced Media Blobs Architecture (Tasks 1.1-1.6, 1.8.1-1.8.3)

### Database Schema

We'll enhance the existing media_blobs table with thumbnail relationships:

```sql
-- Enhanced media_blobs table with thumbnail relationships
ALTER TABLE media_blobs ADD COLUMN parent_blob_id UUID REFERENCES media_blobs(id);
ALTER TABLE media_blobs ADD COLUMN blob_type VARCHAR(20) DEFAULT 'original';
ALTER TABLE media_blobs ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE media_blobs ADD COLUMN version BIGINT NOT NULL DEFAULT txid_current();
ALTER TABLE media_blobs ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE media_blobs ADD COLUMN deleted_by UUID REFERENCES users(id);

-- Updated media_blobs table with secure local_path storage
ALTER TABLE media_blobs ALTER COLUMN local_path TYPE TEXT;
COMMENT ON COLUMN media_blobs.local_path IS 'Full filesystem path (absolute, starting with /). Never exposed to clients.';
COMMENT ON COLUMN media_blobs.parent_blob_id IS 'Points to parent blob for thumbnails. NULL for original files.';
COMMENT ON COLUMN media_blobs.blob_type IS 'Type: original, thumbnail, etc.';

-- View that filters out soft-deleted records (allows existing queries to work unchanged)
CREATE VIEW active_media_blobs AS
SELECT * FROM media_blobs WHERE deleted_at IS NULL;

-- Indexes for efficient querying
CREATE INDEX idx_media_blobs_version ON media_blobs(version);
CREATE INDEX idx_media_blobs_deleted_at ON media_blobs(deleted_at);
CREATE INDEX idx_media_blobs_active ON media_blobs(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_media_blobs_parent ON media_blobs(parent_blob_id);
CREATE INDEX idx_media_blobs_type ON media_blobs(blob_type);

-- Future partitioning strategy (implement when scaling is needed):
-- 1. When table reaches 10M+ rows, consider yearly partitioning
-- 2. ALTER TABLE media_blobs RENAME TO media_blobs_old;
-- 3. CREATE TABLE media_blobs (...) PARTITION BY RANGE (created_at);
-- 4. Create yearly partitions and migrate data
-- 5. Set up automatic partition creation via cron or triggers
```

-- Trigger to update timestamp and version on changes (explicit UTC)
CREATE OR REPLACE FUNCTION update_media_files_metadata() RETURNS TRIGGER AS $$
BEGIN
NEW.updated_at = NOW() AT TIME ZONE 'UTC';
NEW.version = txid_current();
RETURN NEW;
END;

$$
LANGUAGE plpgsql;

CREATE TRIGGER media_files_metadata
    BEFORE UPDATE ON media_files
    FOR EACH ROW
    EXECUTE FUNCTION update_media_files_metadata();
```

### Domain Tables Integration

Domain-specific tables will reference media_blobs directly:

```sql
-- Music domain (Phase 1 focus)
CREATE TABLE songs (
  id UUID PRIMARY KEY,
  media_blob_id UUID REFERENCES media_blobs(id),
  title TEXT,
  artist TEXT,
  album TEXT,
  track_number INTEGER,
  duration INTERVAL,
  genre TEXT,
  year INTEGER
);

-- Photo domain
CREATE TABLE photos (
  id UUID PRIMARY KEY,
  media_blob_id UUID REFERENCES media_blobs(id),
  caption TEXT,
  location TEXT,
  camera_metadata JSONB,
  taken_at TIMESTAMPTZ
);

-- Video domain
CREATE TABLE videos (
  id UUID PRIMARY KEY,
  media_blob_id UUID REFERENCES media_blobs(id),
  title TEXT,
  description TEXT,
  duration INTERVAL,
  resolution TEXT,
  codec TEXT
);

-- Books domain (Future Phase)
CREATE TABLE books (
  id UUID PRIMARY KEY,
  media_blob_id UUID REFERENCES media_blobs(id),
  title TEXT,
  author TEXT,
  isbn TEXT,
  publisher TEXT,
  published_date DATE,
  page_count INTEGER,
  format TEXT, -- 'pdf', 'epub', 'mobi', etc.
  metadata JSONB -- Table of contents, chapters, bookmarks, etc.
);

-- Documents domain (Future Phase)
CREATE TABLE documents (
  id UUID PRIMARY KEY,
  media_blob_id UUID REFERENCES media_blobs(id),
  title TEXT,
  content_type TEXT, -- 'html', 'markdown', 'text'
  tags TEXT[],
  folder_path TEXT,
  is_published BOOLEAN DEFAULT false,
  published_at TIMESTAMPTZ,
  version INTEGER DEFAULT 1,
  metadata JSONB -- Editor preferences, formatting, etc.
);
```

### Benefits of This Approach

- **Simple relationships**: Thumbnails linked via parent_blob_id, eliminating extra tables
- **Domain alignment**: Domain tables reference media_blobs directly
- **Query simplicity**: Find thumbnails with WHERE parent_blob_id = ? AND blob_type = 'thumbnail_small'
- **Type safety**: blob_type clearly identifies the purpose of each blob
- **Efficient storage**: No redundant tables, everything in media_blobs
- **Security**: Filesystem paths kept server-side, never exposed to clients
- **Access control**: Dedicated API routes enable proper authentication and authorization

### Media Blob Serving Architecture

```rust
// Server-side API route for secure media blob serving
GET /api/blobs/{media_blob_id}
// - Validates user permissions
// - Serves file from absolute path in local_path
// - Sets appropriate headers (Content-Type, caching, etc.)
// - Supports range requests for video/audio

// Client receives computed URLs, never filesystem paths
{
  "id": "uuid",
  "href": "http://localhost:8080/api/blobs/uuid",
  "mime": "image/jpeg",
  "size": 1024000,
  "blob_type": "original",
  "parent_blob_id": null,
  "thumbnail": {"id": "thumb_uuid", "blob_type": "thumbnail", "href": "..."}
  // local_path never included in client responses
}
```

## 2. Job Queue System (Tasks 2.1-2.10)

### Job Queue Implementation with Fang

We'll use the `fang` crate for PostgreSQL-based job processing:

```toml
[dependencies]
fang = { version = "0.10", features = ["asynk-postgres"] }
```

### Job Definition

```rust
use fang::*;

#[derive(Serialize, Deserialize)]
pub struct ThumbnailJob {
    pub media_blob_id: Uuid,
    pub job_type: String, // "image_thumbnail", "video_frame", "audio_waveform"
    pub size: String,     // "small", "medium", "large"
}

#[async_trait]
impl AsyncRunnable for ThumbnailJob {
    async fn run(&self, queue: &mut dyn AsyncQueueable) -> Result<(), Error> {
        match self.job_type.as_str() {
            "image_thumbnail" => self.generate_image_thumbnail().await,
            "video_frame" => self.generate_video_frame().await,
            "audio_waveform" => self.generate_audio_waveform().await,
            _ => Err("Unknown job type".into()),
        }
    }
}
```

### Processing Logic

```rust
impl ThumbnailJob {
    async fn generate_image_thumbnail(&self) -> Result<(), Error> {
        // Check if imagemagick is enabled and available
        let config = &self.config.external_tools;
        if !config.imagemagick.enabled {
            return self.create_default_thumbnail("image").await;
        }

        // Use configurable imagemagick binary to resize image
        let output = Command::new(&config.imagemagick.binary_path)
            .args([
                &input_path,
                "-resize", "100x100",
                "-format", "webp",
                &output_path
            ])
            .output()
            .await
            .map_err(|e| {
                if e.kind() == std::io::ErrorKind::NotFound {
                    Error::ExternalToolNotFound("imagemagick", &config.imagemagick.binary_path)
                } else {
                    Error::ExternalToolFailed("imagemagick", e)
                }
            })?;

        // Store generated thumbnail as new media_blob
        let thumbnail_blob = self.store_thumbnail_blob(output_path).await?;

        // Update media_files table with new thumbnail reference
        self.update_media_file_thumbnail(thumbnail_blob.id).await?;

        // Send WebSocket notification
        self.notify_thumbnail_completion().await?;

        Ok(())
    }

    async fn generate_video_frame(&self) -> Result<(), Error> {
        // Check if ffmpeg is enabled and available
        let config = &self.config.external_tools;
        if !config.ffmpeg.enabled {
            return self.create_default_thumbnail("video").await;
        }

        // Use configurable ffmpeg binary to extract frame
        let output = Command::new(&config.ffmpeg.binary_path)
            .args([
                "-i", &input_path,
                "-ss", "00:00:01",          // Seek to 1 second
                "-vframes", "1",            // Extract 1 frame
                "-vf", "scale=100:100",
                "-f", "webp",
                &output_path
            ])
            .output()
            .await
            .map_err(|e| {
                if e.kind() == std::io::ErrorKind::NotFound {
                    Error::ExternalToolNotFound("ffmpeg", &config.ffmpeg.binary_path)
                } else {
                    Error::ExternalToolFailed("ffmpeg", e)
                }
            })?;

        // Similar storage and notification logic
        Ok(())
    }

    async fn generate_audio_waveform(&self) -> Result<(), Error> {
        // Check if ffmpeg is enabled and available
        let config = &self.config.external_tools;
        if !config.ffmpeg.enabled {
            return self.create_default_thumbnail("audio").await;
        }

        // Use configurable ffmpeg binary to generate waveform image
        let output = Command::new(&config.ffmpeg.binary_path)
            .args([
                "-i", &input_path,
                "-filter_complex", "showwavespic=s=100x100:colors=blue",
                "-frames:v", "1",
                "-f", "webp",
                &output_path
            ])
            .output()
            .await
            .map_err(|e| {
                if e.kind() == std::io::ErrorKind::NotFound {
                    Error::ExternalToolNotFound("ffmpeg", &config.ffmpeg.binary_path)
                } else {
                    Error::ExternalToolFailed("ffmpeg", e)
                }
            })?;

        // Similar storage and notification logic
        Ok(())
    }

    async fn create_default_thumbnail(&self, media_type: &str) -> Result<(), Error> {
        // Create a default thumbnail when external tools are disabled
        // This could be a generic icon or placeholder image
        let default_thumbnail = self.generate_default_icon(media_type).await?;
        self.update_media_file_thumbnail(default_thumbnail.id).await?;
        self.notify_thumbnail_completion().await?;
        Ok(())
    }
}

// Configuration structures
#[derive(Serialize, Deserialize)]
pub struct ExternalToolsConfig {
    pub imagemagick: ToolConfig,
    pub ffmpeg: ToolConfig,
}

#[derive(Serialize, Deserialize)]
pub struct ToolConfig {
    pub enabled: bool,
    pub binary_path: String,
    pub timeout_seconds: u64,
}

impl Default for ExternalToolsConfig {
    fn default() -> Self {
        Self {
            imagemagick: ToolConfig {
                enabled: true,
                binary_path: "convert".to_string(),
                timeout_seconds: 30,
            },
            ffmpeg: ToolConfig {
                enabled: true,
                binary_path: "ffmpeg".to_string(),
                timeout_seconds: 60,
            },
        }
    }
}

// Startup validation
pub async fn validate_external_tools(config: &ExternalToolsConfig) -> Result<(), StartupError> {
    if config.imagemagick.enabled {
        validate_tool_availability("imagemagick", &config.imagemagick.binary_path).await?;
    }
    if config.ffmpeg.enabled {
        validate_tool_availability("ffmpeg", &config.ffmpeg.binary_path).await?;
    }
    Ok(())
}

async fn validate_tool_availability(tool_name: &str, binary_path: &str) -> Result<(), StartupError> {
    let output = Command::new(binary_path)
        .arg("--version")
        .output()
        .await;

    match output {
        Ok(_) => {
            tracing::info!("✓ {} found at: {}", tool_name, binary_path);
            Ok(())
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            Err(StartupError::ExternalToolNotFound {
                tool: tool_name.to_string(),
                path: binary_path.to_string(),
                suggestion: format!(
                    "Install {} or disable it in config with '{}.enabled = false'",
                    tool_name, tool_name
                ),
            })
        }
        Err(e) => Err(StartupError::ExternalToolError {
            tool: tool_name.to_string(),
            error: e.to_string(),
        }),
    }
}
```

### Worker Setup

```rust
// In main.rs
async fn main() {
    // Start web server
    let server = tokio::spawn(start_web_server());

    // Start job workers in same process (can be separated later)
    let worker = tokio::spawn(start_job_workers());

    tokio::select! {
        _ = server => {},
        _ = worker => {},
    }
}

async fn start_job_workers() {
    let mut worker_pool = WorkerPool::builder()
        .number_of_workers(2)
        .queue(queue)
        .build();

    worker_pool.start().await;
}

// Enqueue jobs when media blobs are uploaded
pub async fn enqueue_thumbnail_jobs(media_blob_id: Uuid) -> Result<()> {
    let sizes = ["small", "medium", "large"];

    for size in sizes {
        queue.insert_task(&ThumbnailJob {
            media_blob_id,
            job_type: determine_job_type(&media_blob).await?,
            size: size.to_string(),
        }).await?;
    }

    Ok(())
}
```

## 3. WebSocket Notifications (Tasks 3.1-3.6)

### PostgreSQL NOTIFY/LISTEN Implementation

```rust
// Worker sends notification after thumbnail completion
impl ThumbnailJob {
    async fn notify_thumbnail_completion(&self) -> Result<()> {
        let payload = serde_json::json!({
            "event_type": "thumbnail_completed",
            "media_blob_id": self.media_blob_id,
            "thumbnail_size": self.size,
            "media_file_id": self.media_file_id
        });

        sqlx::query!(
            "SELECT pg_notify('websocket_events', $1)",
            payload.to_string()
        ).execute(&db).await?;

        Ok(())
    }
}

// WebSocket server listens for notifications
async fn listen_for_events(websocket_manager: &WebSocketManager) {
    let mut listener = sqlx::postgres::PgListener::connect(&database_url).await?;
    listener.listen("websocket_events").await?;

    while let Ok(notification) = listener.recv().await {
        let event: WebSocketEvent = serde_json::from_str(&notification.payload())?;

        match event.event_type.as_str() {
            "thumbnail_completed" => {
                websocket_manager.broadcast_thumbnail_update(event).await;
            }
            _ => {}
        }
    }
}
```

### Client-Side Handling

```typescript
// Client receives thumbnail completion notifications
websocket.addEventListener("message", (event) => {
  const data = JSON.parse(event.data);

  if (data.event_type === "thumbnail_completed") {
    // Refresh thumbnail display for this media blob
    mediaBlobManager.refreshThumbnail(data.media_blob_id, data.thumbnail_size);
  }
});
```

## 4. Cursor-Based Pagination (Tasks 4.1-4.7)

### Database Schema Enhancement

```sql
-- Add sequence-based versioning to media_blobs
ALTER TABLE media_blobs ADD COLUMN version BIGINT NOT NULL DEFAULT txid_current();

-- Update version on changes
CREATE OR REPLACE FUNCTION update_version() RETURNS TRIGGER AS
$$

BEGIN
NEW.version = txid_current();
RETURN NEW;
END;

$$
LANGUAGE plpgsql;

CREATE TRIGGER media_blobs_version
    BEFORE INSERT OR UPDATE ON media_blobs
    FOR EACH ROW
    EXECUTE FUNCTION update_version();

-- Index for efficient cursor queries
CREATE INDEX idx_media_blobs_version ON media_blobs(version);
```

### API Implementation

```rust
#[derive(Deserialize)]
pub struct MediaBlobsQuery {
    pub limit: Option<i64>,
    pub cursor: Option<String>, // Version number as string
}

#[derive(Serialize)]
pub struct MediaBlobsResponse {
    pub blobs: Vec<MediaBlob>,
    pub next_cursor: Option<String>,
    pub has_more: bool,
}

pub async fn get_media_blobs_since(
    Query(params): Query<MediaBlobsQuery>,
    Extension(db): Extension<DatabaseConnection>,
) -> Result<Json<MediaBlobsResponse>, AppError> {
    let limit = params.limit.unwrap_or(20).min(100);
    let cursor_version = params.cursor
        .and_then(|c| c.parse::<i64>().ok())
        .unwrap_or(0);

    let blobs = sqlx::query_as!(
        MediaBlob,
        "SELECT * FROM media_blobs
         WHERE version > $1
         ORDER BY version ASC
         LIMIT $2",
        cursor_version,
        limit + 1  // Fetch one extra to check for more
    ).fetch_all(&db).await?;

    let has_more = blobs.len() > limit as usize;
    let mut response_blobs = blobs;
    if has_more {
        response_blobs.pop();
    }

    let next_cursor = response_blobs.last()
        .map(|blob| blob.version.to_string());

    Ok(Json(MediaBlobsResponse {
        blobs: response_blobs,
        next_cursor,
        has_more,
    }))
}
```

### Client-Side Sync Implementation

```typescript
class MediaBlobSync {
  private cursor: string | null = null;
  private blobs: Map<string, MediaBlob> = new Map();

  async initialSync() {
    const response = await fetch("/api/media-blobs");
    const data = await response.json();

    // Populate initial state
    data.blobs.forEach((blob) => this.blobs.set(blob.id, blob));
    this.cursor = data.next_cursor;

    return Array.from(this.blobs.values());
  }

  async syncChanges() {
    if (!this.cursor) return [];

    const response = await fetch(
      `/api/media-blobs?cursor=${this.cursor}&limit=50`,
    );
    const data = await response.json();

    // Update local state with changes
    data.blobs.forEach((blob) => this.blobs.set(blob.id, blob));

    if (data.next_cursor) {
      this.cursor = data.next_cursor;
    }

    return data.blobs; // Return only the new/changed blobs
  }

  // Start periodic sync (can be triggered by WebSocket notifications)
  startPeriodicSync() {
    setInterval(() => this.syncChanges(), 30000); // Every 30 seconds
  }

  // Immediate sync when notified via WebSocket
  async handleWebSocketNotification() {
    const changes = await this.syncChanges();
    if (changes.length > 0) {
      this.onBlobsChanged(changes);
    }
  }
}
```

### Integration with WebSocket Notifications

```sql
-- Notify clients when media_blobs change
CREATE OR REPLACE FUNCTION notify_media_blob_sync() RETURNS TRIGGER AS
$$

BEGIN
PERFORM pg_notify('media_blob_sync', 'changes_available');
RETURN NEW;
END;

$$
LANGUAGE plpgsql;

CREATE TRIGGER notify_media_blob_sync
    AFTER INSERT OR UPDATE ON media_blobs
    FOR EACH ROW
    EXECUTE FUNCTION notify_media_blob_sync();
```

```typescript
// Client responds to sync notifications
websocket.addEventListener("message", (event) => {
  const data = JSON.parse(event.data);

  if (data.type === "media_blob_sync") {
    // Immediately sync changes instead of waiting for next poll
    mediaBlobSync.handleWebSocketNotification();
  }
});
```

## Benefits

- **Efficient syncing**: Clients only fetch changes since their last sync
- **Real-time updates**: WebSocket notifications trigger immediate syncs
- **Scalable architecture**: Job processing can be moved to separate workers
- **Minimal dependencies**: Uses PostgreSQL's built-in features
- **Type safety**: Explicit thumbnail relationships with clear semantics
- **Performance**: Sequence-based cursors avoid timestamp edge cases

This architecture provides a solid foundation for a responsive, real-time media management system while keeping complexity manageable and avoiding external dependencies.

## Potential Issues & Implementation Concerns

### Potential Snags & Holes

#### **1. Database Migration Complexity**

The current tasks assume you can just "add columns" but you'll need actual migration scripts:

- Adding `version` and soft delete columns to existing tables
- Migrating existing `media_blobs` to the new `media_files` structure
- **Missing:** Actual migration tasks and rollback strategies

#### **2. Task Dependencies Are Unclear**

Some tasks have hidden dependencies:

- Can't do **2.11** (ThumbnailService) without **1.7** (domain models)
- **5.10** (IndexedDB) requires **4.4** (cursor API) to be fully working
- **Missing:** Clear dependency mapping

#### **3. Authentication/Authorization Gaps**

Most tasks assume authentication is handled, but:

- Who can trigger imports? (**1.11**)
- Soft delete permissions? (**1.9**)
- WebSocket event filtering by user? (**3.3**)
- **Missing:** Auth integration tasks

#### **4. Error Recovery & Consistency**

- What if thumbnail job succeeds but database update fails?
- What if filesystem import creates `media_blob` but domain record fails?
- **Missing:** Transaction boundaries and consistency guarantees

#### **5. Client Library Package Management**

Tasks mention "package and distribute" (**6.6**) but:

- How do demos consume the libraries during development?
- Monorepo setup? Separate npm packages?
- **Ambiguous:** Client library distribution strategy

#### **6. Performance & Scaling Concerns**

- No mention of database connection pooling for job workers
- Cursor pagination might be slow with very large datasets
- WebSocket connection limits not addressed
- **Missing:** Performance validation tasks
- Future partitioning strategy documented but not implemented yet
- Federation strategy needs careful planning for data consistency and conflict resolution
- Cross-server authentication and authorization complexity not fully addressed
- Media blob serving security model needs access control implementation
- Client-side URL construction creates tight coupling and security concerns

#### **7. Configuration Management**

Lots of config mentioned but:

- Where does config live? Files? Environment? Database?
- How do different deployments (dev/staging/prod) handle config?
- **Missing:** Configuration strategy tasks

### Most Ambiguous Tasks

#### **🚨 High Ambiguity:**

- **1.8** "Create new upload handlers using domain layer" - How do you migrate routes?
- **2.11** "ThumbnailService in domain layer" - What's the interface? How does it integrate?
- **5.10** "IndexedDB integration" - What gets cached? Sync strategy?
- **6.1** "Design client library architecture" - Very hand-wavy
- **1.1.1** "Dynamic table name infrastructure" - How does this affect all repository/query code?
- **1.8.2** "Dedicated media blob serving API routes" - Access control strategy, rate limiting, caching headers
- **1.8.3** "Remove filesystem path exposure" - Server-side URL generation strategy, configuration management
- **9.1-9.8** "Federation tasks" - PostgreSQL FDW setup, cross-server auth, conflict resolution strategies need detailed planning

#### **🟡 Medium Ambiguity:**

- **3.9** "Reactive state management" - What framework/pattern?
- **4.4** "API endpoint for cursor-based queries" - What about filters/search?
- **F.11** "Advanced search across domains" - Full-text search engine needed?

### Recommendations

**Start Smaller:** Get thumbnails working for existing uploads first before expanding to filesystem imports and multiple domains.

**Prove Patterns:** Validate the domain layer works with one domain (music) before expanding to photos, videos, books, and documents.

**Defer Complexity:** Features like IndexedDB, collaborative editing, and cross-domain search can be implemented after the core system is proven.

**Recommended First Sprint:**

```
✅ 0.1, 0.3 (setup)
🎯 1.1, 1.2, 1.7 (database + domain foundation)
🎯 2.1-2.7 (basic job queue + thumbnails)
🎯 Simple demo showing thumbnails generating
```
$$
