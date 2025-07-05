# Documentation Index

This directory contains comprehensive documentation for the Axum WebAuthn Tutorial project, organized into logical categories for easy navigation.

## 📁 Directory Structure

### 🔧 Client JS (`client/js/`)

Documentation for the TypeScript client library and web components:

- **[Demo Improvements](client/js/demo-improvements.md)** - Enhanced WebSocket demo features and improvements
- **[Modular Refactor](client/js/modular-refactor.md)** - Refactoring WebSocket functionality into modular components
- **[Project Restructure](client/js/project-restructure.md)** - Merging web-component project into main client library
- **[Thumbnail Fixes](client/js/thumbnail-fixes.md)** - Media preview and thumbnail functionality fixes
- **[WebSocket Modular Components](client/js/websocket-modular-components.md)** - Usage guide for modular WebSocket components

### 🔧 CLI (`cli/`)

Command-line interface documentation:

- **[Music CLI](cli/music.md)** - Music library management, search, and playlist commands

### 🛠️ Development (`development/`)

Development setup, build processes, and tooling:

- **[Setup](development/setup.md)** - Initial project setup and configuration
- **[Testing](development/testing.md)** - Testing strategies and test suite documentation
- **[Config Files Cleaned](development/config-files-cleaned.md)** - Configuration file organization and cleanup
- **[Prompts](development/prompts.md)** - AI prompts and development assistance

### 🖥️ Server (`server/`)

Server-side API documentation and architecture:

- **[Search API](server/search-api.md)** - Music search REST API endpoints and integration guide

### 🚀 Operations (`operations/`)

Deployment, monitoring, and operational concerns:

- **[Access Logging](operations/access-logging.md)** - HTTP access logging implementation
- **[Access Logging Solution](operations/access-logging-solution.md)** - Complete access logging solution details

### ⭐ Features (`features/`)

Application features and functionality documentation:

- **[Account Recovery](features/account-recovery.md)** - User account recovery mechanisms
- **[Roles](features/roles.md)** - User roles and permission system
- **[Search](features/search.md)** - Music search features and capabilities

### 📖 Reference (`reference/`)

Reference materials and specifications:

- **[Wordlist](reference/wordlist.md)** - Word list for passphrases and user-friendly identifiers

## 🎯 Quick Navigation

### For Developers

- Start with [Setup](development/setup.md) for initial project configuration
- Review [Testing](development/testing.md) for testing guidelines
- Check [Client JS docs](client/js/) for frontend development

### For Operations

- See [Access Logging](operations/access-logging.md) for monitoring setup
- Review operational procedures in the `operations/` directory

### For Feature Development

- Check [Features](features/) for existing functionality
- Review [Roles](features/roles.md) for permission system

### For API Integration

- See [WebSocket Modular Components](client/js/websocket-modular-components.md) for WebSocket client usage
- Review [Client JS documentation](client/js/) for API client library

## 📋 Document Categories

### Implementation Guides

Documents that explain how features are implemented and how to use them.

### Architecture Decisions

Documents that explain why certain technical decisions were made.

### Operational Procedures

Step-by-step guides for deployment, monitoring, and maintenance.

### Reference Materials

Specifications, configurations, and lookup information.

## 🔍 Finding Documentation

### By Topic

- **Authentication**: See WebAuthn components in `client/js/`
- **Real-time Communication**: WebSocket documentation in `client/js/`
- **User Management**: Account recovery and roles in `features/`
- **Search**: Music search features in `features/search.md`, CLI commands in `cli/music.md`, API in `server/search-api.md`
- **Music Library**: CLI commands in `cli/music.md` and search features
- **Monitoring**: Access logging in `operations/`
- **Development**: Setup and testing in `development/`

### By Audience

- **Frontend Developers**: Focus on `client/js/` directory and `server/search-api.md` for API integration
- **Backend Developers**: Review `features/`, `operations/`, and `server/` directories
- **CLI Users**: See `cli/music.md` for comprehensive command reference
- **DevOps Engineers**: Start with `operations/` and `development/setup.md`
- **Product Managers**: Review `features/` for functionality overview, especially `features/search.md`

## 📝 Contributing to Documentation

When adding new documentation:

1. **Choose the right directory** based on the content type
2. **Use descriptive filenames** with lowercase and hyphens
3. **Add entries to this INDEX.md** for discoverability
4. **Follow existing formatting patterns** for consistency
5. **Include code examples** where applicable

### Naming Conventions

- Use lowercase with hyphens: `feature-name.md`
- Be descriptive: `websocket-modular-components.md` not `ws.md`
- Group related docs in subdirectories

### Content Guidelines

- Start with a clear problem statement or purpose
- Include practical examples and code snippets
- Provide links to related documentation
- Keep content up-to-date with code changes

## 🔗 External Resources

- [Project Root README](../README.md) - Main project overview
- [Client JS README](../client/js/README.md) - Client library specific documentation
- [Migration README](../migrations/README.md) - Database migration information
- [Scripts README](../scripts/README.md) - Utility scripts documentation

---

_This documentation index is maintained to provide easy navigation to all project documentation. For questions or suggestions about documentation organization, please refer to the development team._
