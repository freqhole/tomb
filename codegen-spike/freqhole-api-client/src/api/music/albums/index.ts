// Auto-generated client for albums
// DO NOT EDIT

import { z } from 'zod';
import { getBaseUrl } from '../../../config';
import * as types from '../../../types';

export async function getAlbum(params: String): Promise<Album> {
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
  return AlbumSchema.parse(data);
}

export async function listAlbums(params: QueryParams): Promise<Album[]> {
  const validated = QueryParamsSchema.parse(params);

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
  return AlbumSchema.array().parse(data);
}

