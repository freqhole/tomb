# CLI Reference

Command-line interface for WebAuthn server administration and management.

## Usage

```bash
# General syntax
cli [OPTIONS] <COMMAND> [ARGS]

# Get help for any command
cli <command> --help
cli <command> <subcommand> --help
```

## Global Options

| Option           | Short | Default                              | Description             |
| ---------------- | ----- | ------------------------------------ | ----------------------- |
| `--config`       | `-c`  | `assets/config/config.jsonc`         | Configuration file path |
| `--secrets`      |       | `assets/config/config.secrets.jsonc` | Secrets file path       |
| `--database-url` |       |                                      | Override database URL   |

## Commands

### Configuration Management

```bash
cli config init                    # Generate default config
cli config validate               # Validate configuration
cli config schema                 # Show config schema
```

### User Management

```bash
cli users list                    # List all users
cli users create                  # Create new user
cli users delete <user-id>        # Delete user
cli users invites generate        # Generate invite codes
cli users invites list            # List invite codes
cli users invites delete <code>   # Delete invite code
```

### Music Library

```bash
cli music scan <path>             # Scan directory for music
cli music songs                   # List songs
cli music playlists              # List playlists
cli music create-playlist <title> # Create playlist
cli music add-to-playlist <id> <songs>           # Add to existing playlist
cli music add-to-playlist-by-title <title> <songs>  # Add to playlist by title (creates if missing)
cli music show-playlist <id>     # Show playlist contents
cli music play                   # Interactive playlist picker and playback
cli music play-song <id>         # Play individual song
cli music play-playlist <title>  # Play playlist by title/ID
```

### Analytics

```bash
cli analytics cleanup            # Clean old analytics data
cli analytics export             # Export analytics data
cli analytics stats              # Show analytics summary
```

### Thumbnails

```bash
cli thumbnails test              # Test thumbnail generation
cli thumbnails generate <path>   # Generate thumbnails
cli thumbnails cleanup           # Clean orphaned thumbnails
```

### Notifications

```bash
cli notifications test           # Test notification system
cli notifications channels      # List notification channels
cli notifications send <channel> <message>  # Send notification
```

### Wordlist Management

```bash
cli wordlist generate           # Generate wordlist file
cli wordlist validate          # Validate wordlist
cli wordlist stats             # Show wordlist statistics
```

## Examples

```bash
# Setup new environment
cli config init
cli users invites generate --count 5

# Music library management
cli music scan ~/Music --batch-size 100
cli music add-to-playlist-by-title "Favorites" "song1,song2,song3"
cli music play --shuffle         # Interactive playlist selection

# Maintenance tasks
cli analytics cleanup --days 30
cli thumbnails cleanup
```

## Configuration

CLI commands respect the same configuration hierarchy as the server:

1. Command line arguments
2. Environment variables
3. Configuration files
4. Default values

Most commands require database connectivity and will automatically run migrations if needed.
