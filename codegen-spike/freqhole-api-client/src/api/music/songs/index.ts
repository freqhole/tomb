// Auto-generated client for songs
// DO NOT EDIT

import { z } from 'zod';
import { getBaseUrl } from '../../../config';
import * as types from '../../../types';

export async function listSongs(params: QueryParams): Promise<Song[]> {
  const validated = QueryParamsSchema.parse(params);

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
  return SongSchema.array().parse(data);
}

export async function getSong(params: String): Promise<Song> {
  const response = await fetch(`${getBaseUrl()}/api/music/songs/:id`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  const data = await response.json();
  return SongSchema.parse(data);
}

