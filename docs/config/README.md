# Configuration

The application uses JSONC (JSON with comments) configuration files for all settings.

## Configuration Files

- `config.jsonc` - Main application configuration

## Loading Priority

1. Command line arguments (highest priority)
2. Environment variables
3. Configuration files
4. Default values (lowest priority)

## Main Configuration Structure

```jsonc
{
  "app": {
    "name": "WebAuthn Server",
    "version": "0.1.0",
    "environment": "development",
  },
  "database": {
    "host": "localhost",
    "port": 5432,
    "name": "webauthn_db",
    "username": "postgres",
    "password": "postgres",
    "pool": {
      "max_connections": 10,
      "min_connections": 1,
      "connect_timeout_seconds": 30,
      "idle_timeout_seconds": 600,
    },
    "migrations": {
      "auto_run": true,
    },
  },
  "webauthn": {
    "rp_id": "localhost",
    "rp_name": "WebAuthn Demo",
    "rp_origin": "http://localhost:8080",
  },
  "server": {
    "host": "0.0.0.0",
    "port": 8080,
  },
  "sessions": {
    "max_age_seconds": 86400,
    "secure": false,
    "same_site": "strict",
    "http_only": true,
  },
  "logging": {
    "level": "info",
    "access_log": {
      "enabled": true,
      "file_path": "logs/access.log",
      "format": "combined",
      "also_log_to_tracing": false,
    },
  },
  "analytics": {
    "metrics": {
      "enabled": true,
      "prometheus_endpoint": "/metrics",
      "health_endpoint": "/health",
    },
  },
  "static_files": {
    "assets_directory": "assets",
    "serve_404_fallback": true,
  },
  "storage": {
    "sessions": "memory",
  },
  "media": {
    "max_blob_file_size": 10485760,
    "max_fs_file_size": 104857600,
    "supported_audio_formats": ["mp3", "flac", "ogg", "m4a"],
    "playback": {
      "player_path": null,
      "player_command": "ffplay",
      "player_args": ["-nodisp", "-autoexit"],
    },
    "thumbnails": {
      "enabled": true,
      "imagemagick_path": null,
      "ffmpeg_path": null,
      "max_concurrent_jobs": 4,
      "dimensions": {
        "width": 200,
        "height": 200,
        "maintain_aspect_ratio": true,
        "crop_strategy": "center",
      },
      "formats": {
        "image_format": "webp",
        "waveform_format": "png",
        "video_format": "webp",
      },
      "timeouts": {
        "image_processing_seconds": 30,
        "video_processing_seconds": 60,
        "audio_processing_seconds": 45,
      },
    },
  },
  "notifications": {
    "enabled": true,
    "channels": ["system", "auth", "media"],
    "websocket": {
      "enabled": true,
      "heartbeat_interval": 30,
    },
  },
}
```

### Audio Playback Configuration

The `media.playback` section configures terminal audio playback for CLI commands:

- `player_path` - Custom path to audio player binary (null = use system PATH)
- `player_command` - Audio player command (default: "ffplay")
- `player_args` - Arguments passed to the player (default: ["-nodisp", "-autoexit"])

**Common configurations:**

```jsonc
// FFplay (default - quiet mode)
"playback": {
  "player_command": "ffplay",
  "player_args": ["-nodisp", "-autoexit", "-hide_banner", "-loglevel", "quiet"]
}

// MPV (recommended - better controls)
"playback": {
  "player_command": "mpv",
  "player_args": ["--no-video", "--really-quiet"]
}

// MPV with progress bar
"playback": {
  "player_command": "mpv",
  "player_args": ["--no-video", "--term-status-msg=♪ ${filename} [${time-pos}/${duration}]"]
}

// Custom path
"playback": {
  "player_path": "/usr/local/bin/ffplay",
  "player_args": ["-nodisp", "-autoexit"]
}
```

## CLI Commands

- `cli config init` - Generate default configuration
- `cli config validate` - Validate configuration syntax
- `cli config schema` - Show configuration schema

## Environment Variables

- `DATABASE_URL` - Override database connection string
- `RUST_LOG` - Override logging level (mostly dev tool, but you might want it off)

## Security Notes

- Avoid putting `config.secrets.jsonc` in to version control
- Use environment variables in production for sensitive values
- Set `sessions.secure=true` and `sessions.same_site="strict"` in production
