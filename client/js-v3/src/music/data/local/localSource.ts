// local data source implementation - queries indexeddb directly
import { generateUUID } from "../../../utils/uuid";
import {
  checkFavorite,
  getRating,
  getSongById,
  initMusicDB,
  queryAlbums,
  queryArtists,
  queryGenres,
  querySongsWithDetails,
  setFavorite as dbSetFavorite,
  setRating as dbSetRating,
} from "../../services/storage/db";
import {
  deletePlaylist as deletePlaylistFromDB,
  updatePlaylistSongs,
} from "../../services/storage/playlists";
import {
  STORE_ALBUMS,
  STORE_ARTISTS,
  STORE_PLAYLIST_SONGS,
  STORE_PLAYLISTS,
  STORE_SONGS,
  type Playlist,
  type PlaylistSong,
  type Song,
} from "../../services/storage/types";
import { sortSongsByArtist, sortSongsCanonical } from "../../utils/songSort";
import type {
  AlbumSummary,
  ArtistSummary,
  FavoriteTarget,
  FavoriteItem,
  GenreSummary,
  ListFavoritesParams,
  MusicDataSource,
  PaginatedResponse,
  PlaylistSummary,
  QueryParams,
} from "../types";

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

    // querySongsWithDetails returns enriched Song[] directly
    const songs = results;

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
    return getSongById(id) ?? null;
  }

  // albums (optional - aggregate from songs)
  async getAlbums(
    params?: QueryParams,
  ): Promise<PaginatedResponse<AlbumSummary>> {
    const limit = params?.limit ?? 50;
    const offset = params?.offset ?? 0;

    // query albums with aggregated stats
    const results = await queryAlbums({ 
      limit, 
      offset,
      albumId: params?.album_id, 
    });

    // map to AlbumSummary format
    const albums: AlbumSummary[] = results.map((result) => ({
      album_id: result.album.album_id,
      title: result.album.title,
      artist_id: result.album.artist_id || "",
      artist_name: result.artist_name,
      album_type: result.album.album_type,
      year: result.album.year ?? undefined,
      release_date: result.album.release_date ?? undefined,
      label: result.album.label ?? undefined,
      genre_id: result.album.genre_id ?? undefined,
      genre: (result.album as any).genre ?? undefined, // genre name added at runtime in queryAlbums
      sub_genres: (result.album as any).sub_genres ?? undefined, // TODO: populate from songs
      song_count: result.song_count,
      total_duration: result.total_duration,
      is_favorite: result.album.is_favorite,
      user_rating: result.album.user_rating,
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

    // querySongsWithDetails returns enriched Song[] directly
    const songs = results;

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
    const results = await queryArtists({ 
      limit, 
      offset,
      artistId: params?.artist_id, 
    });

    // map to ArtistSummary format
    const artists: ArtistSummary[] = results.map((result) => ({
      artist_id: result.artist.artist_id,
      name: result.artist.name,
      album_count: result.album_count,
      song_count: result.song_count,
      total_duration: result.total_duration,
      is_favorite: result.artist.is_favorite,
      user_rating: result.artist.user_rating,
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

    // querySongsWithDetails returns enriched Song[] directly
    const songs = results;

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
    const results = await queryGenres({ 
      limit, 
      offset,
      search: params?.search,
    });

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

    // use querySongsWithDetails to get fully hydrated songs
    const results = await querySongsWithDetails({
      limit,
      offset,
      genreId,
    });

    // querySongsWithDetails returns enriched Song[] directly
    const songs = results;

    // apply canonical sorting: group by album, then disc+track
    const sortedSongs = sortSongsCanonical(songs);

    return {
      items: sortedSongs,
      total: sortedSongs.length,
      offset,
      limit,
      has_more: sortedSongs.length === limit,
    };
  }

  // playlists
  async getPlaylists(
    params?: QueryParams,
  ): Promise<PaginatedResponse<PlaylistSummary>> {
    const limit = params?.limit ?? 50;
    const offset = params?.offset ?? 0;

    const db = await initMusicDB();
    const allPlaylists = await db.getAll(STORE_PLAYLISTS);

    // filter out deleted playlists
    const activePlaylists = allPlaylists.filter((p) => !p.deleted_at);

    // sort by updated_at desc
    activePlaylists.sort((a, b) => b.updated_at - a.updated_at);

    // get song counts for each playlist
    const playlistsWithCounts = await Promise.all(
      activePlaylists.map(async (playlist) => {
        const playlistSongs = await db.getAllFromIndex(
          STORE_PLAYLIST_SONGS,
          "by_playlist_id",
          playlist.playlist_id,
        );

        const summary: PlaylistSummary = {
          playlist_id: playlist.playlist_id,
          title: playlist.title,
          description: playlist.description,
          is_public: playlist.is_public,
          thumbnail_blob_id: playlist.thumbnail_blob_id,
          song_count: playlistSongs.length,
          created_at: playlist.created_at,
          updated_at: playlist.updated_at,
          is_favorite: playlist.is_favorite ?? false,
        };

        return summary;
      }),
    );

    // apply pagination
    const paginatedPlaylists = playlistsWithCounts.slice(
      offset,
      offset + limit,
    );

    return {
      items: paginatedPlaylists,
      total: playlistsWithCounts.length,
      offset,
      limit,
      has_more: offset + limit < playlistsWithCounts.length,
    };
  }

  async getPlaylistSongs(
    playlistId: string,
    params?: QueryParams,
  ): Promise<PaginatedResponse<Song>> {
    const limit = params?.limit ?? 50;
    const offset = params?.offset ?? 0;

    const db = await initMusicDB();

    // get playlist songs ordered by position
    const playlistSongs = await db.getAllFromIndex(
      STORE_PLAYLIST_SONGS,
      "by_playlist_id",
      playlistId,
    );

    // sort by position
    playlistSongs.sort((a, b) => a.position - b.position);

    // get song_ids for querySongsWithDetails
    const songIds = playlistSongs.map((ps) => ps.song_id);

    // use querySongsWithDetails to get fully hydrated songs
    const results = await querySongsWithDetails({
      songIds: songIds,
    });

    // maintain playlist order (querySongsWithDetails returns Song[] directly)
    const songMap = new Map(results.map((song) => [song.id, song]));
    const songs = songIds
      .map((id) => songMap.get(id))
      .filter((s) => s !== undefined) as Song[];

    // apply pagination
    const paginatedSongs = songs.slice(offset, offset + limit);

    return {
      items: paginatedSongs,
      total: songs.length,
      offset,
      limit,
      has_more: offset + limit < songs.length,
    };
  }

  // playlist mutations
  async createPlaylist(params: {
    title: string;
    description?: string | null;
    is_public?: boolean;
  }): Promise<PlaylistSummary> {
    const db = await initMusicDB();
    const now = Date.now();

    const playlist: Playlist = {
      playlist_id: generateUUID(),
      title: params.title,
      description: params.description || null,
      is_public: params.is_public ?? false,
      thumbnail_blob_id: null,
      source_type: "local",
      source_remote_id: null,
      source_remote_url: null,
      source_etag: null,
      last_synced_at: null,
      is_editable: true,
      created_at: now,
      updated_at: now,
    };

    await db.put(STORE_PLAYLISTS, playlist);

    return {
      playlist_id: playlist.playlist_id,
      title: playlist.title,
      description: playlist.description,
      is_public: playlist.is_public,
      thumbnail_blob_id: playlist.thumbnail_blob_id,
      song_count: 0,
      created_at: playlist.created_at,
      updated_at: playlist.updated_at,
    };
  }

  async updatePlaylist(
    playlistId: string,
    params: {
      title?: string | null;
      description?: string | null;
      is_public?: boolean | null;
      thumbnail_blob_id?: string | null;
    },
  ): Promise<PlaylistSummary> {
    const db = await initMusicDB();

    const playlist = await db.get(STORE_PLAYLISTS, playlistId);
    if (!playlist) {
      throw new Error("playlist not found");
    }

    // update fields
    if (params.title !== undefined) {
      playlist.title = params.title || "";
    }
    if (params.description !== undefined) {
      playlist.description = params.description;
    }
    if (params.is_public !== undefined) {
      playlist.is_public = params.is_public ?? false;
    }
    if (params.thumbnail_blob_id !== undefined) {
      playlist.thumbnail_blob_id = params.thumbnail_blob_id;
    }

    playlist.updated_at = Date.now();

    await db.put(STORE_PLAYLISTS, playlist);

    // get song count
    const playlistSongs = await db.getAllFromIndex(
      STORE_PLAYLIST_SONGS,
      "by_playlist_id",
      playlistId,
    );

    return {
      playlist_id: playlist.playlist_id,
      title: playlist.title,
      description: playlist.description,
      is_public: playlist.is_public,
      thumbnail_blob_id: playlist.thumbnail_blob_id,
      song_count: playlistSongs.length,
      created_at: playlist.created_at,
      updated_at: playlist.updated_at,
    };
  }

  async deletePlaylist(playlistId: string): Promise<void> {
    const db = await initMusicDB();
    await deletePlaylistFromDB(db, playlistId);
  }

  async addSongsToPlaylist(
    playlistId: string,
    songIds: string[],
  ): Promise<void> {
    const db = await initMusicDB();

    // get current max position
    const existingSongs = await db.getAllFromIndex(
      STORE_PLAYLIST_SONGS,
      "by_playlist_id",
      playlistId,
    );

    let maxPosition = 0;
    for (const ps of existingSongs) {
      if (ps.position > maxPosition) {
        maxPosition = ps.position;
      }
    }

    // add new songs
    const now = Date.now();
    for (let i = 0; i < songIds.length; i++) {
      const songId = songIds[i];

      // check if song already exists in playlist
      const existing = existingSongs.find((ps) => ps.song_id === songId);
      if (existing) {
        continue; // skip duplicates
      }

      const playlistSong: PlaylistSong = {
        playlist_id: playlistId,
        song_id: songId,
        position: maxPosition + i + 1,
        added_at: now,
      };

      await db.put(STORE_PLAYLIST_SONGS, playlistSong);
    }

    // update playlist updated_at
    const playlist = await db.get(STORE_PLAYLISTS, playlistId);
    if (playlist) {
      playlist.updated_at = Date.now();
      await db.put(STORE_PLAYLISTS, playlist);
    }
  }

  async removeSongsFromPlaylist(
    playlistId: string,
    songIds: string[],
  ): Promise<void> {
    const db = await initMusicDB();

    // delete each song from playlist
    for (const songId of songIds) {
      await db.delete(STORE_PLAYLIST_SONGS, [playlistId, songId]);
    }

    // update playlist updated_at
    const playlist = await db.get(STORE_PLAYLISTS, playlistId);
    if (playlist) {
      playlist.updated_at = Date.now();
      await db.put(STORE_PLAYLISTS, playlist);
    }
  }

  async reorderPlaylistSongs(
    playlistId: string,
    songIds: string[],
    newPosition: number,
  ): Promise<void> {
    const db = await initMusicDB();

    // get all songs in playlist
    const allSongs = await db.getAllFromIndex(
      STORE_PLAYLIST_SONGS,
      "by_playlist_id",
      playlistId,
    );

    // sort by position
    allSongs.sort((a, b) => a.position - b.position);

    // find songs to move
    const songsToMove = allSongs.filter((ps) => songIds.includes(ps.song_id));
    const songsToKeep = allSongs.filter((ps) => !songIds.includes(ps.song_id));

    // insert moved songs at new position (1-based index -> 0-based)
    const targetIndex = newPosition - 1;
    const reordered = [
      ...songsToKeep.slice(0, targetIndex),
      ...songsToMove,
      ...songsToKeep.slice(targetIndex),
    ];

    // update positions
    const updates = reordered.map((song, index) => ({
      song_id: song.id,
      position: index + 1,
    }));

    await updatePlaylistSongs(db, playlistId, updates);

    // update playlist updated_at
    const playlist = await db.get(STORE_PLAYLISTS, playlistId);
    if (playlist) {
      playlist.updated_at = Date.now();
      await db.put(STORE_PLAYLISTS, playlist);
    }
  }

  // mutations
  async setFavorite(params: {
    targetType: FavoriteTarget;
    targetId: string;
    isFavorite: boolean;
  }): Promise<void> {
    const db = await initMusicDB();

    // use db helper to update favorites table
    await dbSetFavorite(
      params.targetType as "song" | "album" | "artist" | "playlist",
      params.targetId,
      params.isFavorite,
    );

    // also update denormalized is_favorite field in the main record
    if (params.targetType === "song") {
      const song = await db.get(STORE_SONGS, params.targetId);
      if (song) {
        song.is_favorite = params.isFavorite;
        await db.put(STORE_SONGS, song);
      }
    } else if (params.targetType === "album") {
      const album = await db.get(STORE_ALBUMS, params.targetId);
      if (album) {
        album.is_favorite = params.isFavorite;
        await db.put(STORE_ALBUMS, album);
      }
      
      // also update album_is_favorite on all songs from this album
      const albumSongs = await db.getAllFromIndex(
        STORE_SONGS,
        "by_album_id",
        params.targetId
      );
      for (const song of albumSongs) {
        song.album_is_favorite = params.isFavorite;
        await db.put(STORE_SONGS, song);
      }
    } else if (params.targetType === "artist") {
      const artist = await db.get(STORE_ARTISTS, params.targetId);
      if (artist) {
        artist.is_favorite = params.isFavorite;
        await db.put(STORE_ARTISTS, artist);
      }
    } else if (params.targetType === "playlist") {
      const playlist = await db.get(STORE_PLAYLISTS, params.targetId);
      if (playlist) {
        playlist.is_favorite = params.isFavorite;
        await db.put(STORE_PLAYLISTS, playlist);
      }
    }
  }

  async setRating(params: {
    targetType: "song" | "album" | "artist";
    targetId: string;
    rating: number;
  }): Promise<void> {
    const db = await initMusicDB();

    // validate rating
    if (params.rating < 0 || params.rating > 5) {
      throw new Error("rating must be between 0 and 5");
    }

    // use db helper to update ratings table
    await dbSetRating(params.targetType, params.targetId, params.rating);

    // also update denormalized user_rating field in the main record
    if (params.targetType === "song") {
      const song = await db.get(STORE_SONGS, params.targetId);
      if (song) {
        song.user_rating = params.rating || undefined;
        await db.put(STORE_SONGS, song);
      }
    } else if (params.targetType === "album") {
      const album = await db.get(STORE_ALBUMS, params.targetId);
      if (album) {
        album.user_rating = params.rating || undefined;
        await db.put(STORE_ALBUMS, album);
      }
    } else if (params.targetType === "artist") {
      const artist = await db.get(STORE_ARTISTS, params.targetId);
      if (artist) {
        artist.user_rating = params.rating || undefined;
        await db.put(STORE_ARTISTS, artist);
      }
    }
  }

  async updateArtist(params: {
    artist_id: string;
    name?: string;
    bio?: string;
  }): Promise<void> {
    const { updateArtist } = await import("../../services/storage/db");
    await updateArtist(params.artist_id, {
      name: params.name,
      bio: params.bio,
    });
  }

  async updateAlbum(params: {
    album_id: string;
    title?: string;
    artist_id?: string;
    album_type?: string;
    release_date?: string;
    label?: string;
    genre_id?: string;
    genre?: string;
    year?: number;
  }): Promise<void> {
    const { updateAlbum, getOrCreateGenre } = await import("../../services/storage/db");
    
    // if genre name is provided without id, create/fetch genre first
    let genreId = params.genre_id;
    if (params.genre && !genreId) {
      const genre = await getOrCreateGenre(params.genre);
      genreId = genre.genre_id;
    }
    
    // build updates object, filtering out undefined values
    const updates: Record<string, any> = {};
    if (params.title !== undefined) updates.title = params.title;
    if (params.artist_id !== undefined) updates.artist_id = params.artist_id;
    if (params.album_type !== undefined) updates.album_type = params.album_type;
    if (params.release_date !== undefined) updates.release_date = params.release_date;
    if (params.label !== undefined) updates.label = params.label;
    if (genreId !== undefined) updates.genre_id = genreId;
    if (params.year !== undefined) updates.year = params.year;
    
    await updateAlbum(params.album_id, updates);
  }

  async updateSong(params: {
    song_ids: string[];
    title?: string | null;
    artist?: string | null;
    artist_id?: string | null;
    album?: string | null;
    album_id?: string | null;
    genre?: string | null;
    genre_id?: string | null;
    sub_genre_ids?: string[] | null;
    sub_genres?: string[] | null;
    track_number?: number | null;
    disc_number?: number | null;
    year?: number | null;
    duration?: number | null;
    bpm?: number | null;
    key_signature?: string | null;
    lyrics?: string | null;
    user_id?: string | null;
    updated_by?: string | null;
  }): Promise<void> {
    const { updateSong, getOrCreateArtist, getOrCreateAlbum, getOrCreateGenre } = await import("../../services/storage/db");
    
    // resolve artist/album/genre IDs if names are provided without IDs
    let artistId = params.artist_id;
    let albumId = params.album_id;
    let genreId = params.genre_id;
    
    if (params.artist && !artistId) {
      const artist = await getOrCreateArtist(params.artist);
      artistId = artist.artist_id;
    }
    
    if (params.album && !albumId && artistId) {
      const album = await getOrCreateAlbum(params.album, artistId);
      albumId = album.album_id;
    }
    
    if (params.genre && !genreId) {
      const genre = await getOrCreateGenre(params.genre);
      genreId = genre.genre_id;
    }
    
    // update each song - bulk update for local storage
    const updates = {
      title: params.title,
      artist_id: artistId,
      album_id: albumId,
      genre_id: genreId,
      track_number: params.track_number,
      disc_number: params.disc_number,
      year: params.year,
      bpm: params.bpm,
      key_signature: params.key_signature,
      lyrics: params.lyrics,
    };
    
    // filter out null/undefined values
    const filteredUpdates = Object.fromEntries(
      Object.entries(updates).filter(([_, v]) => v != null)
    );
    
    for (const songId of params.song_ids) {
      await updateSong(songId, filteredUpdates);
    }
  }

  async getTags(): Promise<{ tag_id: string; name: string; created_at: number }[]> {
    const { getAllTags } = await import("../../services/storage/db");
    return await getAllTags();
  }

  async addTag(params: { name: string }): Promise<void> {
    const { createTag } = await import("../../services/storage/db");
    await createTag(params.name);
  }

  async deleteTag(params: { name: string }): Promise<void> {
    const { findTagByName, deleteTag } = await import("../../services/storage/db");
    const tag = await findTagByName(params.name);
    if (tag) {
      await deleteTag(tag.tag_id);
    }
  }

  // album tags
  async getAlbumTags(albumId: string): Promise<string[]> {
    const { getAlbumTags } = await import("../../services/storage/db");
    const tags = await getAlbumTags(albumId);
    return tags.map((t) => t.name);
  }

  async addTagsToAlbum(albumId: string, tagNames: string[]): Promise<void> {
    const { findTagByName, createTag, addAlbumTag } = await import("../../services/storage/db");
    
    for (const tagName of tagNames) {
      // find or create tag
      let tag = await findTagByName(tagName);
      if (!tag) {
        await createTag(tagName);
        tag = await findTagByName(tagName);
      }
      
      if (tag) {
        await addAlbumTag(albumId, tag.tag_id);
      }
    }
  }

  async removeTagsFromAlbum(albumId: string, tagIds: string[]): Promise<void> {
    const { removeAlbumTag } = await import("../../services/storage/db");
    
    for (const tagId of tagIds) {
      await removeAlbumTag(albumId, tagId);
    }
  }

  // image operations - local storage using OPFS
  async uploadImage(params: {
    file: File;
    entityType: 'song' | 'artist' | 'album' | 'playlist';
    entityId: string;
    isPrimary?: boolean;
  }): Promise<string> {
    // TODO: implement OPFS storage
    // for now just return a placeholder
    throw new Error("local image upload not yet implemented");
  }

  async getEntityImages(params: {
    entityType: 'song' | 'artist' | 'album' | 'playlist';
    entityId: string;
  }): Promise<string[]> {
    // TODO: implement reading from OPFS
    // for now return empty array
    return [];
  }

  async removeImage(params: {
    entityType: 'song' | 'artist' | 'album' | 'playlist';
    entityId: string;
    blobId: string;
  }): Promise<void> {
    // TODO: implement OPFS deletion
    throw new Error("local image removal not yet implemented");
  }

  // favorites
  async listFavorites(
    params?: ListFavoritesParams,
  ): Promise<PaginatedResponse<FavoriteItem>> {
    const db = await initMusicDB();
    const limit = params?.limit ?? 50;
    const offset = params?.offset ?? 0;

    // get all favorites from the table
    let allFavorites = await db.getAll("favorites");

    // filter by target_type if specified
    if (params?.target_type) {
      allFavorites = allFavorites.filter(
        (fav) => fav.target_type === params.target_type,
      );
    }

    // sort by favorited_at descending (most recent first)
    allFavorites.sort((a, b) => b.favorited_at - a.favorited_at);

    const total = allFavorites.length;
    const paginatedFavorites = allFavorites.slice(offset, offset + limit);

    // hydrate each favorite with its data
    const items: FavoriteItem[] = [];

    for (const favorite of paginatedFavorites) {
      if (favorite.target_type === "song") {
        const song = await db.get(STORE_SONGS, favorite.target_id);
        if (song) {
          items.push({
            type: "song",
            favorited_at: favorite.favorited_at,
            data: song,
          });
        }
      } else if (favorite.target_type === "album") {
        const album = await db.get(STORE_ALBUMS, favorite.target_id);
        if (album) {
          const isFavorite = await checkFavorite("album", album.album_id);
          const rating = await getRating("album", album.album_id);
          // count songs in this album
          const albumSongs = await db
            .getAllFromIndex(STORE_SONGS, "by_album_id", album.album_id);
          const totalDuration = albumSongs.reduce(
            (sum, song) => sum + song.duration_seconds,
            0,
          );
          items.push({
            type: "album",
            favorited_at: favorite.favorited_at,
            data: {
              album_id: album.album_id,
              title: album.title,
              artist_name: album.artist_name,
              artist_id: album.artist_id,
              album_type: album.album_type,
              genre_id: album.genre_id || undefined,
              release_date: album.release_date || null,
              song_count: albumSongs.length,
              total_duration: totalDuration,
              is_favorite: isFavorite,
              user_rating: rating,
            },
          });
        }
      } else if (favorite.target_type === "artist") {
        const artist = await db.get(STORE_ARTISTS, favorite.target_id);
        if (artist) {
          const isFavorite = await checkFavorite("artist", artist.artist_id);
          const rating = await getRating("artist", artist.artist_id);
          // count songs and albums by this artist
          const artistSongs = await db
            .getAllFromIndex(STORE_SONGS, "by_artist_id", artist.artist_id);
          const artistAlbums = await db
            .getAllFromIndex(STORE_ALBUMS, "by_artist_id", artist.artist_id);
          const totalDuration = artistSongs.reduce(
            (sum, song) => sum + song.duration_seconds,
            0,
          );
          items.push({
            type: "artist",
            favorited_at: favorite.favorited_at,
            data: {
              artist_id: artist.artist_id,
              name: artist.name,
              song_count: artistSongs.length,
              album_count: artistAlbums.length,
              total_duration: totalDuration,
              is_favorite: isFavorite,
              user_rating: rating,
            },
          });
        }
      } else if (favorite.target_type === "playlist") {
        const playlist = await db.get(STORE_PLAYLISTS, favorite.target_id);
        if (playlist) {
          // count songs in playlist
          const playlistSongs = await db
            .getAllFromIndex(STORE_PLAYLIST_SONGS, "by_playlist_id", playlist.playlist_id);
          items.push({
            type: "playlist",
            favorited_at: favorite.favorited_at,
            data: {
              playlist_id: playlist.playlist_id,
              title: playlist.title,
              description: playlist.description || null,
              is_public: playlist.is_public,
              thumbnail_blob_id: playlist.thumbnail_blob_id || null,
              song_count: playlistSongs.length,
              created_at: playlist.created_at,
              updated_at: playlist.updated_at,
              is_favorite: playlist.is_favorite ?? false,
            },
          });
        }
      }
    }

    return {
      items,
      total,
      offset,
      limit,
      has_more: offset + limit < total,
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
