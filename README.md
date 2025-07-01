# a wild ride with claude

this repo is mostly all ai-generated code. mostly a wild adventure staring into the llm abyss 😎

both frightening and thrilling at the same time.

i started with a browser passkey demo from [webauthn-rs](https://github.com/kanidm/webauthn-rs/tree/master/tutorial/server/axum)

💸 but then ...well i just kept lobbing prompts and claude kept pumping out code. i burned all my 10-dollar-a-month credits real quick. i'm also currently ~$28.16~ $39.84 deep in premium credit usage.

😳 if you're curious i tried to log the prompts i used (or at least the ones i could retrieve) over in [docs/prompts.md](docs/prompts.md)

⏲️ lolol, are we cooked??

everything below is what claude ai though should be in the root README:

# Axum WebAuthn Server with Invite Codes

This demonstrates using Axum as the backend for a WebAuthn authentication system with invite code functionality and comprehensive configuration management.

## Features

- **WebAuthn Authentication**: Passwordless authentication using FIDO2/WebAuthn
- **Invite Code System**: Registration requires valid invite codes
- **PostgreSQL Storage**: All data (users, credentials, invite codes, sessions) stored in PostgreSQL
- **CLI Administration**: Command-line tool for managing invite codes and configuration
- **JSONC Configuration**: Feature-rich configuration system with JSON Schema support
- **Request Analytics**: Built-in analytics and metrics collection
- **Flexible Architecture**: Easy deployment and customization

## Documentation

- **[Setup Guide](docs/setup.md)** - Detailed setup instructions
- **[Testing Guide](docs/testing.md)** - Testing procedures and coverage
- **[Role Management](docs/roles.md)** - User roles and permissions system
- **[Development Prompts](docs/prompts.md)** - AI prompts used to build this project

## Prerequisites

- Rust (latest stable)
- PostgreSQL database
- Modern web browser with WebAuthn support
- JSON-aware editor (VS Code, IntelliJ, etc.) for configuration editing

## Quick Start

### Using the Development Script (Recommended)

1. **Set up PostgreSQL database**

   ```bash
   # Create a PostgreSQL database
   createdb webauthn_db
   ```

2. **Initialize configuration**

   ```bash
   # Generate default configuration file
   cargo run --bin cli config init

   # Generate JSON Schema for editor support
   cargo run --bin cli config schema
   ```

3. **Configure your setup**

   ```bash
   # Edit the configuration file (supports comments!)
   # Your editor should provide autocomplete and validation
   edit assets/config/config.jsonc

   # Generate .env file for Docker/SQLx compatibility
   cargo run --bin cli config generate-env

   # Set your database password
   export DATABASE_PASSWORD="your_secure_password"
   ```

4. **Run the development script**

   ```bash
   ./scripts/start_dev.sh
   ```

   This script will:
   - Validate your configuration
   - Check database connectivity
   - Run migrations automatically
   - Generate initial invite codes if none exist
   - Display available invite codes
   - Start the server

### Manual Setup

1. **Database Setup**

   ```bash
   # Create a PostgreSQL database
   createdb webauthn_db
   ```

2. **Configuration Setup**

   ```bash
   # Initialize default configuration
   cargo run --bin cli config init

   # Generate JSON Schema for your editor
   cargo run --bin cli config schema

   # Edit configuration to match your setup
   edit assets/config/config.jsonc

   # Validate your configuration
   cargo run --bin cli config validate

   # Generate .env file for compatibility
   cargo run --bin cli config generate-env
   ```

3. **Set Environment Variables**

   ```bash
   # Set your database password
   export DATABASE_PASSWORD="your_secure_password"
   ```

4. **Generate Invite Codes**

   ```bash
   # Generate invite codes (uses config defaults)
   cargo run --bin cli users generate-invite

   # Override defaults
   cargo run --bin cli users generate-invite --count 5 --length 12
   ```

## Running the Server

### JavaScript Frontend (Default)

```bash
cargo run
```

The server will start on `http://localhost:8080` and serve the JavaScript frontend.

### WASM Frontend

To use the WASM frontend instead:

1. Change the features in `Cargo.toml`:

   ```toml
   [features]
   default = ["wasm"]
   ```

2. Build the WASM files:

   ```bash
   ./scripts/build_wasm.sh
   ```

3. Run the server:

   ```bash
   # Use default configuration
   cargo run --bin server

   # Override host and port
   cargo run --bin server -- --host 127.0.0.1 --port 9999

   # Use specific config files
   cargo run --bin server -- --config my-config.jsonc --secrets my-secrets.jsonc
   ```

## Configuration Management

### Configuration Files

The server uses a JSONC configuration file (`assets/config/config.jsonc`) with full JSON Schema support for editor assistance, plus an optional secrets file for sensitive data:

```bash
# Initialize default configuration
cargo run --bin cli config init

# Initialize configuration WITH secrets file
cargo run --bin cli config init --with-secrets

# Create just the secrets file
cargo run --bin cli config init-secrets

# Generate JSON Schema for editor support
cargo run --bin cli config schema

# Validate configuration (includes secrets validation)
cargo run --bin cli config validate

# View current configuration
cargo run --bin cli config show

# Generate clean .env file for Docker/SQLx
cargo run --bin cli config generate-env
```

### Editor Setup

For the best experience, configure your editor to use the JSON Schema:

**VS Code**: Add to settings.json:

```json
{
  "json.schemas": [
    {
      "fileMatch": ["assets/config/config.jsonc"],
      "url": "./.zed/config.schema.json"
    }
  ]
}
```

**IntelliJ/WebStorm**: Preferences → JSON Schema Mappings

### Key Configuration Sections

**Main Configuration (`assets/config/config.jsonc`):**

- **`app`**: Application metadata and environment
- **`database`**: Database connection and pool settings (password comes from secrets)
- **`webauthn`**: WebAuthn/FIDO2 configuration
- **`server`**: HTTP server settings
- **`sessions`**: Session management
- **`invite_codes`**: Invite code system settings
- **`logging`**: Logging and tracing
- **`analytics`**: Request analytics and metrics
- **`static_files`**: Static file serving
- **`development`**: Development-specific settings
- **`production`**: Production deployment settings
- **`features`**: Feature flags

**Secrets Configuration (`assets/config/config.secrets.jsonc`):**

- **`database`**: Database password and optional URL override
- **`app`**: Session secrets and API keys
- **`external`**: Third-party service credentials

## CLI Administration

The `cli` tool provides comprehensive management:

### Configuration Commands

```bash
# Initialize configuration (basic)
cargo run --bin cli config init

# Initialize configuration with secrets file
cargo run --bin cli config init --with-secrets

# Create/update secrets file only
cargo run --bin cli config init-secrets

# Validate configuration and secrets
cargo run --bin cli config validate

# Show merged configuration
cargo run --bin cli config show

# Generate schema for editor support
cargo run --bin cli config schema

# Generate clean .env file (no comments)
cargo run --bin cli config generate-env

# Generate .env with example values
cargo run --bin cli config generate-env --with-examples
```

### Invite Code Management

```bash
# Generate invite codes (uses config defaults)
cargo run --bin cli users generate-invite

# Override defaults
cargo run --bin cli users generate-invite --count 10 --length 12

# List all invite codes
cargo run --bin cli users list-invites

# List only active codes
cargo run --bin cli users list-invites --active-only

# Show usage statistics
cargo run --bin cli users stats
```

### Analytics Commands

```bash
# Show request analytics
cargo run --bin cli analytics analytics

# Show specific time period
cargo run --bin cli analytics analytics --hours 1

# Show user activity
cargo run --bin cli analytics user-activity --user-id USER_UUID

# Clean up old data
cargo run --bin cli analytics cleanup-analytics --days 30 --execute
```

## Using the System

1. **Generate an invite code** using the CLI tool
2. **Open the web interface** at `http://localhost:8080`
3. **Register a new user**:
   - Enter a username
   - Enter the invite code
   - Click "Register"
   - Follow your browser's WebAuthn prompts
4. **Login**:
   - Enter your username
   - Click "Login"
   - Use your authenticator (fingerprint, security key, etc.)

## Database Schema

The system uses the following tables:

- `invite_codes`: Stores invite codes and their usage status
- `users`: User accounts linked to invite codes
- `webauthn_credentials`: WebAuthn credentials for each user
- `tower_sessions`: Session storage
- `request_analytics`: Request tracking and analytics data
- `media_blobs`: Media file storage with content-derived short hash IDs
- `thumbnail_jobs`: Asynchronous thumbnail generation queue
- `songs`, `playlists`, `photos`, `videos`: Domain-specific media metadata

### Media Blob Architecture

The system uses a unique content-addressable storage approach:

- **Short Hash IDs**: Media blobs use 7-16 character short hash primary keys derived from SHA256
- **Auto-generation**: Database triggers automatically generate collision-resistant short IDs
- **Deduplication**: Full SHA256 hashes ensure content deduplication
- **Flexible Storage**: Binary data can be stored in database or filesystem (via `local_path`)
- **Relationships**: Parent-child relationships support thumbnails, transcodes, and waveforms

Migrations are automatically run when the server starts (configurable via `database.migrations.auto_run`).

## Security Notes

- Invite codes are single-use and automatically deactivated after registration
- All WebAuthn credentials are stored securely in the database
- Sessions are stored server-side (configurable: memory or PostgreSQL)
- The system uses secure session cookies with appropriate flags
- Configuration validation ensures secure defaults for production
- Request analytics help monitor for suspicious activity
- Production mode enforces HTTPS and additional security headers

## Development

### Configuration vs Environment Variables

The server primarily uses `assets/config/config.jsonc` + `assets/config/config.secrets.jsonc` for configuration, and supports command line arguments:

- `--config` / `-c`: Path to configuration file (default: `assets/config/config.jsonc`)
- `--secrets` / `-s`: Path to secrets file (default: `assets/config/config.secrets.jsonc`)
- `--host`: Override server hostname (conflicts with `--config`)
- `--port`: Override server port (conflicts with `--config`)
- `DATABASE_PASSWORD` or `POSTGRES_PASSWORD`: Database password (fallback if no secrets file)
- `RUST_LOG`: Logging level (overrides config)

**Argument Validation**:

- `--host` and `--port` cannot be used together with explicit `--config` files
- They can only be used with the default configuration to override specific settings
- If you specify a custom config file, all server settings must come from that file
- This prevents configuration conflicts and ensures predictable behavior

**Secrets Priority Order:**

1. `assets/config/config.secrets.jsonc` file (preferred)
2. Environment variables (fallback)
3. Generated `.env` file (Docker/tooling compatibility)

## Account Recovery

The system provides a secure account recovery mechanism for users who lose access to their passkeys. This is particularly useful in personal/family hosting scenarios where users might lose or replace devices.

### How Recovery Works

Recovery codes are **admin-generated** temporary codes that allow users to register new passkeys on their existing accounts:

1. **Admin generates recovery code** for a specific user
2. **User receives the recovery code** (shared securely out-of-band)
3. **User visits registration page** with their original username + recovery code
4. **System links new passkey** to existing account instead of creating new user
5. **User regains access** with their new passkey on existing account

### Generating Recovery Codes

```bash
# Generate recovery code for specific user
cargo run --bin cli users generate-recovery --username alice

# Customize expiry and length
cargo run --bin cli users generate-recovery --username alice --expires-hours 12 --length 16

# Example output:
✓ Generated recovery code for user 'alice':
  Code: ABC123XYZ789
  Expires: 24 hours from now

💡 User can now register a new passkey using:
  1. Their existing username: alice
  2. This recovery code: ABC123XYZ789
  3. The new passkey will be linked to their existing account
```

### Security Features

- **Admin-only generation**: Only admins can generate recovery codes
- **User-specific**: Each recovery code is tied to a specific user account
- **Single-use**: Recovery codes can only be used once
- **Time-limited**: Default 24-hour expiry (configurable)
- **Secure length**: Default 12-character codes (configurable)
- **No self-service**: Users cannot generate their own recovery codes

### Recovery Process for Users

1. **Contact admin** and request account recovery
2. **Receive recovery code** through secure channel (email, SMS, in-person)
3. **Visit registration page** on any device
4. **Enter original username** (not a new one)
5. **Enter recovery code** instead of invite code
6. **Register new passkey** - will be linked to existing account
7. **Access restored** with all original data intact

### Use Cases

- **Lost device**: User's phone/laptop with passkey is lost or stolen
- **Device replacement**: User upgrades device and needs to migrate passkey
- **Multiple devices**: User wants to add passkey to additional devices
- **Passkey corruption**: Rare cases where passkey data becomes unusable

### Database Integration

Recovery codes extend the existing invite code system with minimal additional complexity:

- Reuses existing `invite_codes` table with recovery-specific fields
- Same expiry, single-use, and validation logic as regular invites
- Maintains audit trail of recovery code usage
- No separate authentication system required

This approach provides enterprise-grade account recovery while maintaining the security and simplicity of the passkey-only authentication model.

### Build Features

- `javascript` (default): Serves JavaScript frontend
- `wasm`: Serves WASM frontend

Configure via `static_files.frontend_type` in assets/config/config.jsonc.

### Database Migrations

Migrations are automatically run when the server starts (configurable via `database.migrations.auto_run`) or when using the CLI tool.

### Development Workflow

1. **Initial Setup:**

   ```bash
   # Create config and secrets together
   cargo run --bin cli config init --with-secrets

   # Edit your actual secrets (use strong passwords!)
   edit assets/config/config.secrets.jsonc

   # Set proper file permissions
   chmod 600 assets/config/config.secrets.jsonc
   ```

2. **Daily Development:**

   ```bash
   # Edit main configuration (with schema validation)
   edit assets/config/config.jsonc

   # Validate everything
   cargo run --bin cli config validate

   # Start development server (secrets-aware)
   ./scripts/start_dev.sh
   ```

3. **Monitoring:** Monitor logs and analytics via CLI commands

## Troubleshooting

### Configuration Issues

1. **Configuration Validation Errors**

   ```bash
   # Check configuration validity
   cargo run --bin cli config validate

   # Show current configuration
   cargo run --bin cli config show
   ```

2. **Editor Schema Support**
   ```bash
   # Generate/update JSON Schema
   cargo run --bin cli config schema
   ```

### Database Issues

1. **Connection Errors**
   - Verify PostgreSQL is running
   - Check database settings in `assets/config/config.jsonc`
   - Ensure `DATABASE_PASSWORD` environment variable is set
   - Test: `cargo run --bin cli users stats`

2. **Migration Issues**
   - Migrations run automatically by default
   - Disable with `database.migrations.auto_run: false`
   - Manual migration info in database module

### Account Recovery Issues

1. **Recovery Code Generation Fails**

   ```bash
   # Check if user exists
   cargo run --bin cli users list-users

   # Verify admin permissions
   cargo run --bin cli users stats
   ```

2. **Recovery Code Not Working**
   - Verify recovery code hasn't expired (default: 24 hours)
   - Ensure code hasn't been used already (single-use)
   - Check user is entering exact original username
   - Confirm recovery code was generated for correct user

3. **Multiple Passkeys on Same Account**

   ```bash
   # List user's credentials (admin only)
   # Check webauthn_credentials table for user_id

   # Remove old/compromised passkeys if needed
   # (Manual database operation currently)
   ```

### WebAuthn Issues

1. **RP ID/Origin Mismatch**
   - Check `webauthn.rp_id` matches your domain
   - Ensure `webauthn.rp_origin` is correct and accessible
   - Use `localhost` (not `127.0.0.1`) for development

2. **HTTPS Requirements**
   - Production WebAuthn requires HTTPS
   - Configure `server.tls` section for HTTPS
   - Set `production.require_https: true`

### Debug Information

Enable detailed logging:

```bash
# Edit assets/config/config.jsonc
{
  "logging": {
    "level": "debug"
  }
}

# Or override with environment
RUST_LOG=debug cargo run
```

Check analytics for request patterns:

```bash
cargo run --bin cli analytics analytics --hours 1
```

## Development Notes

- Sessions are currently stored in memory for simplicity. In production, consider using PostgreSQL-backed sessions by uncommenting the PostgresStore code in `main.rs`
- The development script (`scripts/start_dev.sh`) provides a convenient way to set up and run the server
- Database migrations run automatically when the server starts
- **Media Blobs Refactoring**: The system has been refactored to use content-derived short hash primary keys instead of UUIDs. This provides human-readable URLs, efficient content addressing, and automatic deduplication while maintaining referential integrity.

## Production Deployment

### Configuration for Production

1. **Create production configurations**:

   ```bash
   # Copy main config and secrets
   cp assets/config/config.jsonc assets/config/config.production.jsonc
   cp assets/config/config.secrets.jsonc assets/config/config.secrets.production.jsonc
   ```

2. **Edit production settings**:

   ```jsonc
   // config.production.jsonc
   {
     "app": {
       "environment": "production",
     },
     "server": {
       "tls": {
         "enabled": true,
         "cert_file": "/path/to/cert.pem",
         "key_file": "/path/to/key.pem",
       },
     },
     "sessions": {
       "secure": true,
       "store_type": "postgres", // Future feature
     },
     "production": {
       "require_https": true,
       "security_headers": true,
       "rate_limiting": {
         "enabled": true,
       },
     },
   }
   ```

3. **Update production secrets**:

   ```bash
   # Edit with production credentials
   edit assets/config/config.secrets.production.jsonc
   chmod 600 assets/config/config.secrets.production.jsonc
   ```

4. **Deploy with production config**:

   ```bash
   # Use command line arguments to specify config files
   cargo run --bin server -- --config assets/config/config.production.jsonc --secrets assets/config/config.secrets.production.jsonc

   # Or for quick testing with different host/port (uses default config)
   cargo run --bin server -- --host 0.0.0.0 --port 8443
   ```

### Production Checklist

- ✅ HTTPS enabled (`server.tls.enabled: true`)
- ✅ Secure cookies (`sessions.secure: true`)
- ✅ Security headers (`production.security_headers: true`)
- ✅ Rate limiting (`production.rate_limiting.enabled: true`)
- ✅ Database connection pooling configured
- ✅ Log retention policy set (`analytics.retention_days`)
- ✅ Monitoring endpoints configured (`analytics.metrics.enabled`)
- ✅ Backup strategy for PostgreSQL
- ✅ Firewall configuration
- ✅ Regular security updates

### Monitoring

Enable metrics collection:

```jsonc
{
  "analytics": {
    "metrics": {
      "enabled": true,
      "prometheus_endpoint": "/metrics",
      "health_endpoint": "/health",
    },
  },
}
```

Monitor via CLI:

```bash
# Regular health checks (automatically finds secrets file)
cargo run --bin cli --config assets/config/config.production.jsonc analytics analytics

# User activity monitoring
cargo run --bin cli --config assets/config/config.production.jsonc analytics user-activity --user-id UUID

# Generate recovery codes for users
cargo run --bin cli --config assets/config/config.production.jsonc users generate-recovery --username alice

# Validate production setup
cargo run --bin cli --config assets/config/config.production.jsonc --secrets assets/config/config.secrets.production.jsonc config validate
```
