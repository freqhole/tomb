// local data source implementation - queries indexeddb directly
import {
  getSongById,
  initMusicDB,
  queryAlbums,
  queryArtists,
  queryGenres,
  querySongsWithDetails,
} from "../services/storage/db";
import {
  STORE_ALBUMS,
  STORE_SONGS,
  type Song,
} from "../services/storage/types";
import { sortSongsByArtist, sortSongsCanonical } from "../utils/songSort";
import type {
  AlbumSummary,
  ArtistSummary,
  GenreSummary,
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
    // sorted by added_at desc from IDB query (no additional sorting needed)
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
    const limit = params?.limit ?? 50;
    const offset = params?.offset ?? 0;

    // query albums with aggregated stats
    const results = await queryAlbums({ limit, offset });

    // map to AlbumSummary format
    const albums: AlbumSummary[] = results.map((result) => ({
      album_id: result.album.album_id,
      title: result.album.title,
      artist_id: result.album.artist_id || "",
      artist_name: result.artist_name,
      year: result.album.year ?? undefined,
      song_count: result.song_count,
      total_duration: result.total_duration,
    }));

    // TODO: get total count properly from database
    // for now, assume has_more if we got a full page
    const hasMore = albums.length === limit;

    return {
      items: albums,
      total: albums.length,
      offset,
      limit,
      has_more: hasMore,
    };
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

    // apply canonical sorting: by disc+track
    const sortedSongs = sortSongsCanonical(songs);

    return {
      items: sortedSongs,
      total: sortedSongs.length,
      offset,
      limit,
      has_more: sortedSongs.length === limit,
    };
  }

  // artists (optional - aggregate from songs)
  async getArtists(
    params?: QueryParams,
  ): Promise<PaginatedResponse<ArtistSummary>> {
    const limit = params?.limit ?? 50;
    const offset = params?.offset ?? 0;

    // query artists with aggregated stats
    const results = await queryArtists({ limit, offset });

    // map to ArtistSummary format
    const artists: ArtistSummary[] = results.map((result) => ({
      artist_id: result.artist.artist_id,
      name: result.artist.name,
      album_count: result.album_count,
      song_count: result.song_count,
      total_duration: result.total_duration,
    }));

    // TODO: get total count properly from database
    // for now, assume has_more if we got a full page
    const hasMore = artists.length === limit;

    return {
      items: artists,
      total: artists.length,
      offset,
      limit,
      has_more: hasMore,
    };
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

    // apply canonical sorting with artist grouping
    const sortedSongs = sortSongsByArtist(songs);

    return {
      items: sortedSongs,
      total: sortedSongs.length,
      offset,
      limit,
      has_more: sortedSongs.length === limit,
    };
  }

  // genres (optional - aggregate from albums/songs)
  async getGenres(
    params?: QueryParams,
  ): Promise<PaginatedResponse<GenreSummary>> {
    const limit = params?.limit ?? 50;
    const offset = params?.offset ?? 0;

    // query genres with aggregated stats
    const results = await queryGenres({ limit, offset });

    // map to GenreSummary format
    const genres: GenreSummary[] = results.map((result) => ({
      genre_id: result.genre.genre_id,
      name: result.genre.name,
      album_count: result.album_count,
      song_count: result.song_count,
    }));

    // TODO: get total count properly from database
    // for now, assume has_more if we got a full page
    const hasMore = genres.length === limit;

    return {
      items: genres,
      total: genres.length,
      offset,
      limit,
      has_more: hasMore,
    };
  }

  async getGenreSongs(
    genreId: string,
    params?: QueryParams,
  ): Promise<PaginatedResponse<Song>> {
    const limit = params?.limit ?? 50;
    const offset = params?.offset ?? 0;

    // get all albums with this genre
    const db = await initMusicDB();

    // find albums with this genre_id
    const allAlbums = await db.getAll(STORE_ALBUMS);
    const genreAlbums = allAlbums.filter((album) => album.genre_id === genreId);
    const albumIds = new Set(genreAlbums.map((a) => a.album_id));

    // get all songs and filter by album_id
    const allSongs = await db.getAll(STORE_SONGS);
    const genreSongs = allSongs.filter((song) => albumIds.has(song.album_id));

    // apply canonical sorting: group by album, then disc+track
    const sortedSongs = sortSongsCanonical(genreSongs);

    // apply pagination
    const paginatedSongs = sortedSongs.slice(offset, offset + limit);

    return {
      items: paginatedSongs,
      total: sortedSongs.length,
      offset,
      limit,
      has_more: offset + limit < sortedSongs.length,
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
