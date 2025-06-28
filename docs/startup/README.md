# Server Startup

Quick reference for starting the server with various configuration options.

## Basic Usage

```bash
# Start with default configuration
cargo run --bin server

# Start with custom config file
cargo run --bin server --config my-config.jsonc

# Start with custom config and secrets
cargo run --bin server --config my-config.jsonc --secrets my-secrets.jsonc
```

## Command Line Arguments

| Argument | Short | Default | Description |
|----------|-------|---------|-------------|
| `--config` | `-c` | `assets/config/config.jsonc` | Path to configuration file |
| `--secrets` | `-s` | `assets/config/config.secrets.jsonc` | Path to secrets file |
| `--host` | | | Override server hostname |
| `--port` | | | Override server port |
| `--help` | `-h` | | Show help message |

## Examples

```bash
# Development server on different port
cargo run --bin server --port 3000

# Production server with custom config
cargo run --bin server --config production.jsonc --secrets prod-secrets.jsonc

# Override host and port (only with default config)
cargo run --bin server --host 192.168.1.100 --port 8080
```

## Configuration Validation

The server validates configuration on startup:
- Missing required fields
- Invalid data types
- Network address validation
- Database connection test

## Startup Sequence

1. Parse command line arguments
2. Load configuration files
3. Apply command line overrides
4. Validate configuration
5. Initialize logging
6. Connect to database
7. Run migrations (if enabled)
8. Initialize session store
9. Start HTTP server

## Environment Setup

```bash
# Required: PostgreSQL database
createdb webauthn_db

# Optional: Environment file
echo "DATABASE_URL=postgresql://user:pass@localhost/webauthn_db" > .env

# Optional: Generate default config
cargo run --bin cli config init
```

## Troubleshooting

**Config file not found**: Run `cargo run --bin cli config init` to generate defaults

**Database connection failed**: Check PostgreSQL is running and credentials are correct

**Port already in use**: Use `--port` to specify different port

**Permission denied**: Use higher port number (>1024) or run with sudo
