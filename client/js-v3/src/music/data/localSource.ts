// local data source implementation - queries indexeddb directly
import { getSongById, querySongsWithDetails } from "../services/storage/db";
import type { Song } from "../services/storage/types";
import type {
  AlbumSummary,
  ArtistSummary,
  MusicDataSource,
  PaginatedResponse,
  QueryParams,
} from "./types";

// local data source implementation
export class LocalMusicDataSource implements MusicDataSource {
  // songs
  async getSongs(params?: QueryParams): Promise<PaginatedResponse<Song>> {
    const limit = params?.limit ?? 50;
    const offset = params?.offset ?? 0;

    // query with details (joined)
    const results = await querySongsWithDetails({
      limit,
      offset,
      artistId: params?.artist_id,
      albumId: params?.album_id,
    });

    // results already have denormalized artist_name and album_title
    const songs = results.map((r) => r.song);

    // TODO: get total count properly from database
    // for now, assume has_more if we got a full page
    const hasMore = songs.length === limit;

    return {
      items: songs,
      total: songs.length,
      offset,
      limit,
      has_more: hasMore,
    };
  }

  async getSongById(id: string): Promise<Song | null> {
    return getSongById(id) || null;
  }

  // albums (optional - aggregate from songs)
  async getAlbums(
    params?: QueryParams,
  ): Promise<PaginatedResponse<AlbumSummary>> {
    // TODO: implement album aggregation
    return { items: [], total: 0, offset: 0, limit: 50, has_more: false };
  }

  async getAlbumSongs(
    albumId: string,
    params?: QueryParams,
  ): Promise<PaginatedResponse<Song>> {
    const limit = params?.limit ?? 50;
    const offset = params?.offset ?? 0;

    const results = await querySongsWithDetails({
      limit,
      offset,
      albumId,
    });

    const songs = results.map((r) => r.song);

    return {
      items: songs,
      total: songs.length,
      offset,
      limit,
      has_more: songs.length === limit,
    };
  }

  // artists (optional - aggregate from songs)
  async getArtists(
    params?: QueryParams,
  ): Promise<PaginatedResponse<ArtistSummary>> {
    // TODO: implement artist aggregation
    return { items: [], total: 0, offset: 0, limit: 50, has_more: false };
  }

  async getArtistSongs(
    artistId: string,
    params?: QueryParams,
  ): Promise<PaginatedResponse<Song>> {
    const limit = params?.limit ?? 50;
    const offset = params?.offset ?? 0;

    const results = await querySongsWithDetails({
      limit,
      offset,
      artistId,
    });

    const songs = results.map((r) => r.song);

    return {
      items: songs,
      total: songs.length,
      offset,
      limit,
      has_more: songs.length === limit,
    };
  }

  // source metadata
  async getSourceInfo(): Promise<{
    type: "local" | "remote";
    name: string;
    song_count: number;
  }> {
    const results = await querySongsWithDetails({ limit: 100000 });

    return {
      type: "local",
      name: "local library",
      song_count: results.length,
    };
  }
}

// singleton instance
export const localDataSource = new LocalMusicDataSource();
