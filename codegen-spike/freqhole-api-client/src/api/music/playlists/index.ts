// Auto-generated client for playlists
// DO NOT EDIT

import { z } from 'zod';
import { getBaseUrl } from '../../../config';
import * as types from '../../../types';

export async function createPlaylist(params: Playlist): Promise<Playlist> {
  const validated = PlaylistSchema.parse(params);

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
  return PlaylistSchema.parse(data);
}

export async function listPlaylists(params: QueryParams): Promise<PlaylistQueryResult[]> {
  const validated = QueryParamsSchema.parse(params);

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
  return PlaylistQueryResultSchema.array().parse(data);
}

export async function getPlaylist(params: String): Promise<Playlist> {
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
  return PlaylistSchema.parse(data);
}

