// local data source implementation - queries indexeddb directly
import { generateUUID } from "../../../utils/uuid";
import {
  addAlbumTag,
  checkFavorite,
  countSongsByAlbum,
  countSongsByArtist,
  createTag,
  deleteAlbum,
  deleteArtist,
  deleteTag,
  findTagByName,
  getAlbumById,
  getAlbumTags,
  getAllTags,
  getArtistById,
  getOrCreateAlbum,
  getOrCreateArtist,
  getOrCreateGenre,
  getRating,
  getSongById,
  initMusicDB,
  migrateFavorite,
  migrateRating,
  queryAlbums,
  queryArtists,
  queryGenres,
  querySongsWithDetails,
  removeAlbumTag,
  setFavorite as dbSetFavorite,
  setRating as dbSetRating,
  updateAlbum,
  updateArtist,
  updateSong,
} from "../../services/storage/db";
import { storeBlob } from "../../services/storage/blobs";
import { adaptAlbumFromIDB } from "./adapters";
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
  ImageMetadata,
  ListFavoritesParams,
  MusicDataSource,
  PaginatedResponse,
  PlaylistSummary,
  QueryParams,
} from "../types";
import { getPrimaryImageBlobId } from "../../utils/images";


// helper to construct ImageMetadata array from album_images
function buildSongImages(song: Song): ImageMetadata[] {
  // if song already has images array, return it
  if (song.images?.length) {
    return song.images;
  }
  
  // fallback to album images if available
  if (song.album_images?.length) {
    return song.album_images;
  }
  
  return [];
}

// helper to construct ImageMetadata from database image records
function adaptDatabaseImages(dbImages?: Array<{ blob_id: string; is_primary: number }>): ImageMetadata[] {
  if (!dbImages?.length) return [];
  
  return dbImages.map(img => ({
    local_blob_id: img.blob_id,
    is_primary: img.is_primary === 1,
    type: 'thumbnail' as const,
  }));
}

// enrich songs with images array (no more thumbnail_blob_id)
function enrichSongsWithImages(songs: Song[]): Song[] {
  return songs.map((song) => ({
    ...song,
    images: buildSongImages(song),
  }));
}

// local data source implementation
export class LocalMusicDataSource implements MusicDataSource {
  // songs
  async getSongs(params?: QueryParams): Promise<PaginatedResponse<Song>> {
    const limit = params?.limit ?? 50;
    const offset = params?.offset ?? 0;

    const results = await querySongsWithDetails({
      limit,
      offset,
      artistId: params?.artist_id,
      albumId: params?.album_id,
    });

    const songs = enrichSongsWithImages(results);

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
    const song = await getSongById(id);
    if (!song) return null;
    
    return {
      ...song,
      images: buildSongImages(song),
    };
  }

  // albums (optional - aggregate from songs)
  async getAlbums(
    params?: QueryParams,
  ): Promise<PaginatedResponse<AlbumSummary>> {
    const limit = params?.limit ?? 50;
    const offset = params?.offset ?? 0;
    const albumId = params?.album_id;

    const results = await queryAlbums({
      limit,
      offset,
      albumId,
    });

    // use adapter to convert IDB results to AlbumSummary with images array
    const albumPromises = results.map(async (result) => {
      try {
        const album = adaptAlbumFromIDB(result);
        if (!album.album_id) {
          console.warn("skipping album with missing id:", result);
          return null;
        }
        return {
          ...album,
          images: result.album?.images || [], // images are already ImageMetadata[] from IDB
        };
      } catch (error) {
        console.error("failed to process album:", result, error);
        return null;
      }
    });

    const albumResults = await Promise.all(albumPromises);
    const albums = albumResults.filter(a => a !== null) as AlbumSummary[];

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

    const songsWithImages = enrichSongsWithImages(results);

    // TODO: get total count properly from database
    const hasMore = songsWithImages.length === limit;

    return {
      items: songsWithImages,
      total: songsWithImages.length,
      offset,
      limit,
      has_more: hasMore,
    };
  }
  // artists (optional - aggregate from songs)
  async getArtists(
    params?: QueryParams,
  ): Promise<PaginatedResponse<ArtistSummary>> {
    console.log(`[LocalMusicDataSource.getArtists] called with params:`, params);
    try {

      const limit = params?.limit ?? 50;
      const offset = params?.offset ?? 0;

      console.log(`[LocalMusicDataSource.getArtists] calling queryArtists...`);
      // query artists with aggregated stats
      const results = await queryArtists({ 
        limit, 
        offset,
        artistId: params?.artist_id, 
      });

      console.log(`[localSource.getArtists] queryArtists returned ${results.length} results`);

    // map to ArtistSummary format with images array
    const artistPromises = results.map(async (result) => {
      try {
        // validate required fields
        if (!result.artist || !result.artist.artist_id) {
          console.warn("skipping artist with missing id:", result);
          return null;
        }
        if (!result.artist.name) {
          console.warn("artist missing name, using fallback:", result.artist.artist_id);
        }
        
        return {
          artist_id: result.artist.artist_id,
          name: result.artist.name || "Unknown Artist",
          album_count: result.album_count,
          song_count: result.song_count,
          total_duration: result.total_duration,
          images: result.artist.images || [], // images are already ImageMetadata[] from IDB
          is_favorite: result.artist.is_favorite,
          user_rating: result.artist.user_rating,
        };
      } catch (error) {
        console.error("failed to process artist:", result.artist?.artist_id, error);
        return null;
      }
    });

    const artistResults = await Promise.all(artistPromises);
    // filter out null entries (failed artists)
    const artists = artistResults.filter(a => a !== null) as ArtistSummary[];

    console.log(`[localSource.getArtists] returning ${artists.length} artists after filtering`);

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
    } catch (error) {
      console.error(`[LocalMusicDataSource.getArtists] ERROR:`, error);
      throw error;
    }
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

    const songsWithImages = enrichSongsWithImages(results);

    // TODO: get total count properly from database
    const hasMore = songsWithImages.length === limit;

    return {
      items: songsWithImages,
      total: songsWithImages.length,
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

    // enrich with images and apply canonical sorting
    const songs = enrichSongsWithImages(results);
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

    // get song counts and build images array for each playlist
    const playlistPromises = activePlaylists.map(async (playlist) => {
      try {
        if (!playlist.playlist_id) {
          console.warn("skipping playlist with missing id:", playlist);
          return null;
        }
        
        const playlistSongs = await db.getAllFromIndex(
          STORE_PLAYLIST_SONGS,
          "by_playlist_id",
          playlist.playlist_id,
        );

        const summary: PlaylistSummary = {
          playlist_id: playlist.playlist_id,
          title: playlist.title || "Untitled Playlist",
          description: playlist.description,
          is_public: playlist.is_public,
          images: adaptDatabaseImages(playlist.images),
          song_count: playlistSongs.length,
          created_at: playlist.created_at,
          updated_at: playlist.updated_at,
          is_favorite: playlist.is_favorite ?? false,
        };
        return summary;
      } catch (error) {
        console.error("failed to process playlist:", playlist.playlist_id, error);
        return null;
      }
    });

    const playlistResults = await Promise.all(playlistPromises);
    const playlistsWithCounts = playlistResults.filter(p => p !== null) as PlaylistSummary[];

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

    const songsWithImages = enrichSongsWithImages(results);

    // maintain playlist order
    const songMap = new Map(songsWithImages.map((song) => [song.id, song]));
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
      images: [],
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
      images?: ImageMetadata[] | null;
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
    if (params.images !== undefined) {
      playlist.images = params.images || undefined;
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
      images: playlist.images,
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
    sub_genres?: string[];
    year?: number;
  }): Promise<void> {
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
    
    // if sub_genres were provided, update all songs in this album
    if (params.sub_genres !== undefined) {
      const db = await initMusicDB();
      const allSongs = await db.getAll(STORE_SONGS);
      const albumSongs = allSongs.filter(song => song.album_id === params.album_id);
      
      for (const song of albumSongs) {
        const updated = {
          ...song,
          album_sub_genres: params.sub_genres,
          updated_at: Date.now(),
        };
        await db.put(STORE_SONGS, updated);
      }
    }
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
    // get first song to check old artist/album for metadata copying
    const firstSong = await getSongById(params.song_ids[0]);
    if (!firstSong) {
      throw new Error(`song not found: ${params.song_ids[0]}`);
    }

    const oldArtistId = firstSong.artist_id;
    const oldAlbumId = firstSong.album_id;

    // resolve artist/album/genre IDs if names are provided without IDs
    let artistId = params.artist_id;
    let albumId = params.album_id;
    let genreId = params.genre_id;
    
    if (params.artist && !artistId) {
      // get old artist for metadata copying
      const oldArtist = oldArtistId ? await getArtistById(oldArtistId) : null;
      
      // create or get new artist
      const artist = await getOrCreateArtist(params.artist);
      artistId = artist.artist_id;

      // if we created a new artist and have old artist metadata, copy it
      if (oldArtist && artistId !== oldArtistId) {
        await updateArtist(artistId, {
          bio: oldArtist.bio,
          images: oldArtist.images,
        });
        
        // migrate favorites and ratings
        await migrateFavorite("artist", oldArtistId, artistId);
        await migrateRating("artist", oldArtistId, artistId);
      }
    }
    
    if (params.album && !albumId && artistId) {
      // get old album for metadata copying
      const oldAlbum = oldAlbumId ? await getAlbumById(oldAlbumId) : null;

      // create or get new album
      const album = await getOrCreateAlbum(params.album, artistId);
      albumId = album.album_id;

      // if we created a new album and have old album metadata, copy it
      if (oldAlbum && albumId !== oldAlbumId) {
        await updateAlbum(albumId, {
          album_type: oldAlbum.album_type,
          release_date: oldAlbum.release_date,
          release_date_precision: oldAlbum.release_date_precision,
          label: oldAlbum.label,
          genre_id: oldAlbum.genre_id,
          year: oldAlbum.year,
          images: oldAlbum.images,
        });
        
        // migrate favorites and ratings
        await migrateFavorite("album", oldAlbumId, albumId);
        await migrateRating("album", oldAlbumId, albumId);
      }
    }
    
    if (params.genre && !genreId) {
      const genre = await getOrCreateGenre(params.genre);
      genreId = genre.genre_id;
    }
    
    // get artist and album names for denormalized fields
    let artistName: string | undefined;
    let albumTitle: string | undefined;
    
    if (artistId && params.artist) {
      artistName = params.artist;
    } else if (artistId) {
      const artist = await getArtistById(artistId);
      artistName = artist?.name;
    }
    
    if (albumId && params.album) {
      albumTitle = params.album;
    } else if (albumId) {
      const album = await getAlbumById(albumId);
      albumTitle = album?.title;
    }
    
    // update each song - bulk update for local storage
    const updates = {
      title: params.title,
      artist_id: artistId,
      album_id: albumId,
      artist_name: artistName, // denormalized
      album_title: albumTitle, // denormalized
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

    // check if old artist/album are now orphaned and delete if so
    if (artistId && oldArtistId && artistId !== oldArtistId) {
      const count = await countSongsByArtist(oldArtistId);
      if (count === 0) {
        console.log(`deleting orphaned artist: ${oldArtistId}`);
        await deleteArtist(oldArtistId);
      }
    }

    if (albumId && oldAlbumId && albumId !== oldAlbumId) {
      const count = await countSongsByAlbum(oldAlbumId);
      if (count === 0) {
        console.log(`deleting orphaned album: ${oldAlbumId}`);
        await deleteAlbum(oldAlbumId);
      }
    }
  }

  async getTags(): Promise<{ tag_id: string; name: string; created_at: number }[]> {
    return await getAllTags();
  }

  async addTag(params: { name: string }): Promise<void> {
    await createTag(params.name);
  }

  async deleteTag(params: { name: string }): Promise<void> {
    const tag = await findTagByName(params.name);
    if (tag) {
      await deleteTag(tag.tag_id);
    }
  }

  // album tags
  async getAlbumTags(albumId: string): Promise<string[]> {
    const tags = await getAlbumTags(albumId);
    return tags.map((t) => t.name);
  }

  async addTagsToAlbum(albumId: string, tagNames: string[]): Promise<void> {
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
    // store blob in OPFS/Cache
    const blobId = await storeBlob(params.file, params.file.type);

    // update entity with new image
    const db = await initMusicDB();
    const imageMetadata: ImageMetadata = {
      local_blob_id: blobId,
      is_primary: params.isPrimary ?? false,
      type: 'thumbnail',
    };

    if (params.entityType === "album") {
      const album = await db.get(STORE_ALBUMS, params.entityId);
      if (album) {
        const images = album.images || [];
        // if this is primary, mark others as non-primary
        if (params.isPrimary) {
          images.forEach(img => img.is_primary = false);
        }
        images.push(imageMetadata);
        album.images = images;
        album.updated_at = Date.now();
        await db.put(STORE_ALBUMS, album);
      }
    } else if (params.entityType === "artist") {
      const artist = await db.get(STORE_ARTISTS, params.entityId);
      if (artist) {
        const images = artist.images || [];
        if (params.isPrimary) {
          images.forEach(img => img.is_primary = false);
        }
        images.push(imageMetadata);
        artist.images = images;
        artist.updated_at = Date.now();
        await db.put(STORE_ARTISTS, artist);
      }
    } else if (params.entityType === "playlist") {
      const playlist = await db.get(STORE_PLAYLISTS, params.entityId);
      if (playlist) {
        const images = playlist.images || [];
        if (params.isPrimary) {
          images.forEach(img => img.is_primary = 0);
          playlist.thumbnail_blob_id = blobId;
        }
        images.push(imageMetadata);
        playlist.images = images;
        playlist.updated_at = Date.now();
        await db.put(STORE_PLAYLISTS, playlist);
      }
    }

    return blobId;
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
        const song = await getSongById(favorite.target_id);
        if (song) {
          // enrich with images array
          const enriched = enrichSongsWithImages([song])[0];
          items.push({
            type: "song",
            favorited_at: favorite.favorited_at,
            data: enriched,
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
              images: adaptDatabaseImages(album.images),
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
              images: adaptDatabaseImages(artist.images),
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
              images: adaptDatabaseImages(playlist.images),
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
