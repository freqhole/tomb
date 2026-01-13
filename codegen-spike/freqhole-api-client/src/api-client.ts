// Auto-generated API client
// DO NOT EDIT

import * as schema from './schema';

// ============================================================================
// Configuration
// ============================================================================

let baseUrl = 'http://localhost:3000';

export function getBaseUrl(): string {
  return baseUrl;
}

export function setBaseUrl(url: string) {
  baseUrl = url;
}

// ============================================================================
// API Functions
// ============================================================================

export async function listPlaylists(params: schema.QueryParams): Promise<schema.PlaylistQueryResult[]> {
  const validated = schema.QueryParamsSchema.parse(params);

  const response = await fetch(`${getBaseUrl()}/api/music/playlists/list`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(validated),
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  const data = await response.json();
  return schema.PlaylistQueryResultSchema.array().parse(data);
}

export async function createPlaylist(params: schema.Playlist): Promise<schema.Playlist> {
  const validated = schema.PlaylistSchema.parse(params);

  const response = await fetch(`${getBaseUrl()}/api/music/playlists`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(validated),
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  const data = await response.json();
  return schema.PlaylistSchema.parse(data);
}

export async function getPlaylist(params: string): Promise<schema.Playlist> {
  const response = await fetch(`${getBaseUrl()}/api/music/playlists/{id}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  const data = await response.json();
  return schema.PlaylistSchema.parse(data);
}

export async function listSongs(params: schema.QueryParams): Promise<schema.Song[]> {
  const validated = schema.QueryParamsSchema.parse(params);

  const response = await fetch(`${getBaseUrl()}/api/music/songs/list`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(validated),
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  const data = await response.json();
  return schema.SongSchema.array().parse(data);
}

export async function getSong(params: string): Promise<schema.Song> {
  const response = await fetch(`${getBaseUrl()}/api/music/songs/{id}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  const data = await response.json();
  return schema.SongSchema.parse(data);
}

export async function getAlbum(params: string): Promise<schema.Album> {
  const response = await fetch(`${getBaseUrl()}/api/music/albums/{id}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  const data = await response.json();
  return schema.AlbumSchema.parse(data);
}

export async function listAlbums(params: schema.QueryParams): Promise<schema.Album[]> {
  const validated = schema.QueryParamsSchema.parse(params);

  const response = await fetch(`${getBaseUrl()}/api/music/albums/list`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(validated),
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  const data = await response.json();
  return schema.AlbumSchema.array().parse(data);
}

export async function login(params: schema.LoginRequest): Promise<schema.LoginResponse> {
  const validated = schema.LoginRequestSchema.parse(params);

  const response = await fetch(`${getBaseUrl()}/api/users/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(validated),
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  const data = await response.json();
  return schema.LoginResponseSchema.parse(data);
}

export async function getUser(params: string): Promise<schema.User> {
  const response = await fetch(`${getBaseUrl()}/api/users/{id}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  const data = await response.json();
  return schema.UserSchema.parse(data);
}

export async function createUser(params: schema.CreateUserRequest): Promise<schema.User> {
  const validated = schema.CreateUserRequestSchema.parse(params);

  const response = await fetch(`${getBaseUrl()}/api/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(validated),
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  const data = await response.json();
  return schema.UserSchema.parse(data);
}

// ============================================================================
// API Namespace
// ============================================================================

export const api = {
  music: {
    playlists: {
      list: listPlaylists,
      create: createPlaylist,
      get: getPlaylist,
    },
    songs: {
      list: listSongs,
      get: getSong,
    },
    albums: {
      get: getAlbum,
      list: listAlbums,
    },
  },
  users: {
    login: login,
    get: getUser,
    create: createUser,
  },
};

export default api;
