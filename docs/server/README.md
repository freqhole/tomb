# Server HTTP API

REST API endpoints for the WebAuthn server application.

## Base URL

```
http://localhost:8080/api
```

## Authentication

Most endpoints require authentication via WebAuthn sessions. Authenticated requests include session cookies.

## Response Format

All API responses use JSON format with consistent error handling:

```json
{
  "success": true,
  "data": { ... },
  "error": null
}
```

Error responses:
```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable error message"
  }
}
```

## API Endpoints

### Authentication (`/api/auth`)

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| `POST` | `/register/begin` | Start WebAuthn registration | No |
| `POST` | `/register/finish` | Complete WebAuthn registration | No |
| `POST` | `/login/begin` | Start WebAuthn login | No |
| `POST` | `/login/finish` | Complete WebAuthn login | No |
| `POST` | `/logout` | End user session | Yes |
| `GET` | `/session` | Get current session info | Yes |

### Health Check (`/api/health`)

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| `GET` | `/health` | System health status | No |
| `GET` | `/ready` | Readiness probe | No |

### Analytics (`/api/analytics`)

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| `GET` | `/metrics` | Prometheus metrics | No |
| `GET` | `/stats` | System statistics | Yes |

### Media (`/api/media`)

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| `GET` | `/blobs` | List media blobs | Yes |
| `POST` | `/blobs` | Upload media blob | Yes |
| `GET` | `/blobs/{id}` | Get media blob metadata | Yes |
| `DELETE` | `/blobs/{id}` | Delete media blob | Yes |
| `GET` | `/blobs/{id}/data` | Download media blob data | Yes |

### Music (`/api/media/songs`)

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| `GET` | `/songs` | List songs with filtering | Yes |
| `GET` | `/songs/{id}` | Get song details | Yes |
| `PUT` | `/songs/{id}/favorite` | Toggle song favorite | Yes |
| `PUT` | `/songs/{id}/rating` | Set song rating (1-5) | Yes |
| `GET` | `/playlists` | List playlists | Yes |
| `POST` | `/playlists` | Create new playlist | Yes |
| `GET` | `/playlists/{id}` | Get playlist details | Yes |
| `PUT` | `/playlists/{id}` | Update playlist | Yes |
| `DELETE` | `/playlists/{id}` | Delete playlist | Yes |
| `GET` | `/playlists/{id}/songs` | Get playlist songs | Yes |
| `POST` | `/playlists/{id}/songs` | Add songs to playlist | Yes |
| `DELETE` | `/playlists/{id}/songs` | Remove songs from playlist | Yes |
| `PUT` | `/playlists/{id}/songs/reorder` | Reorder playlist songs | Yes |

### Albums & Artists (`/api/media/songs`)

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| `GET` | `/albums` | List album summaries | Yes |
| `GET` | `/albums/{name}/tracks` | Get album tracks | Yes |
| `GET` | `/artists` | List artists | Yes |
| `GET` | `/artists/{name}/albums` | Get artist albums | Yes |

### File Upload (`/api/upload`)

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| `POST` | `/` | Upload file | Yes |
| `POST` | `/chunked` | Chunked file upload | Yes |
| `GET` | `/sessions/{id}` | Get upload session status | Yes |

### Thumbnails (`/api/thumbnails`)

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| `POST` | `/generate` | Generate thumbnail | Yes |
| `GET` | `/{id}` | Get thumbnail | Yes |
| `DELETE` | `/{id}` | Delete thumbnail | Yes |

### WebSocket (`/ws`)

| Endpoint | Description | Auth Required |
|----------|-------------|---------------|
| `/ws` | WebSocket connection for real-time updates | Optional |

## Request Examples

### Authentication Flow

1. **Start Registration**
```bash
curl -X POST http://localhost:8080/api/auth/register/begin \
  -H "Content-Type: application/json" \
  -d '{"username": "user@example.com"}'
```

2. **Complete Registration**
```bash
curl -X POST http://localhost:8080/api/auth/register/finish \
  -H "Content-Type: application/json" \
  -d '{"credential": {...}, "challenge": "..."}'
```

### Music API

1. **List Songs**
```bash
curl -X GET "http://localhost:8080/api/media/songs?limit=20&favorites=true" \
  -H "Cookie: session=..."
```

2. **Create Playlist**
```bash
curl -X POST http://localhost:8080/api/media/playlists \
  -H "Content-Type: application/json" \
  -H "Cookie: session=..." \
  -d '{
    "title": "My Playlist",
    "description": "Great songs",
    "is_public": false
  }'
```

3. **Add Songs to Playlist**
```bash
curl -X POST http://localhost:8080/api/media/playlists/{id}/songs \
  -H "Content-Type: application/json" \
  -H "Cookie: session=..." \
  -d '{
    "song_ids": ["uuid1", "uuid2", "uuid3"]
  }'
```

### File Upload

1. **Simple Upload**
```bash
curl -X POST http://localhost:8080/api/upload \
  -H "Cookie: session=..." \
  -F "file=@/path/to/file.mp3" \
  -F "description=My favorite song"
```

## Query Parameters

### Songs Endpoint

| Parameter | Type | Description |
|-----------|------|-------------|
| `limit` | integer | Maximum results (default: 20, max: 100) |
| `offset` | integer | Results to skip (default: 0) |
| `favorites` | boolean | Filter by favorite status |
| `artist` | string | Filter by artist name |
| `album` | string | Filter by album name |
| `genre` | string | Filter by genre |
| `rating_min` | integer | Minimum rating (1-5) |
| `rating_max` | integer | Maximum rating (1-5) |
| `sort` | string | Sort field (title, artist, album, created_at) |
| `order` | string | Sort order (asc, desc) |

### Playlists Endpoint

| Parameter | Type | Description |
|-----------|------|-------------|
| `limit` | integer | Maximum results (default: 20) |
| `offset` | integer | Results to skip (default: 0) |
| `public` | boolean | Filter by public status |
| `title` | string | Filter by title (partial match) |

## Status Codes

| Code | Meaning |
|------|---------|
| `200` | Success |
| `201` | Created |
| `204` | No Content |
| `400` | Bad Request |
| `401` | Unauthorized |
| `403` | Forbidden |
| `404` | Not Found |
| `409` | Conflict |
| `422` | Validation Error |
| `500` | Internal Server Error |

## Rate Limiting

- Authentication endpoints: 5 requests per minute per IP
- Upload endpoints: 10 requests per minute per user
- General API: 100 requests per minute per user

## CORS

CORS is configured for development environments. Production deployments should configure appropriate origins.

## Security Headers

All responses include security headers:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`
- `Strict-Transport-Security` (HTTPS only)
