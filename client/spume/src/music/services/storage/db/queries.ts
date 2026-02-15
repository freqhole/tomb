// query helpers with joins across multiple stores
import { initMusicDB } from "./init";
import { checkFavorite } from "./favorites";
import { getRating } from "./ratings";
import type {
  Album,
  AlbumQueryResult,
  Artist,
  ArtistWithStats,
  Genre,
  GenreRef,
  GenreWithStats,
  Song,
} from "../types";
import {
  STORE_ALBUM_TAGS,
  STORE_ALBUMS,
  STORE_ARTISTS,
  STORE_GENRES,
  STORE_SONGS,
  STORE_TAGS,
} from "../types";

export async function queryAlbums(options?: {
  limit?: number;
  offset?: number;
  albumId?: string;
}): Promise<AlbumQueryResult[]> {
  const db = await initMusicDB();

  // get all albums (or specific album if albumId provided)
  const allAlbums = options?.albumId
    ? [await db.get(STORE_ALBUMS, options.albumId)].filter(Boolean) as Album[]
    : await db.getAll(STORE_ALBUMS);

  // get all songs, artists, and genres once
  const allSongs = await db.getAll(STORE_SONGS);
  const allArtists = await db.getAll(STORE_ARTISTS);
  const allGenres = await db.getAll(STORE_GENRES);

  // create artist and genre lookup maps
  const artistsById = new Map<string, Artist>();
  for (const artist of allArtists) {
    artistsById.set(artist.artist_id, artist);
  }

  const genresById = new Map<string, Genre>();
  for (const genre of allGenres) {
    genresById.set(genre.genre_id, genre);
  }

  // group songs by album_id
  const songsByAlbum = new Map<string, Song[]>();
  for (const song of allSongs) {
    if (!songsByAlbum.has(song.album_id)) {
      songsByAlbum.set(song.album_id, []);
    }
    songsByAlbum.get(song.album_id)!.push(song);
  }

  // build album results with stats
  const results: AlbumQueryResult[] = [];
  for (const album of allAlbums) {
    const songs = songsByAlbum.get(album.album_id) || [];

    // skip albums with no songs
    if (songs.length === 0) continue;

    // get artist name from map
    const artist = album.artist_id ? artistsById.get(album.artist_id) : null;
    const artistName = artist?.name || "various artists";

    // get genre name from map and add to result
    let genreName: string | undefined;
    if (album.genre_id) {
      const genre = genresById.get(album.genre_id);
      if (genre) {
        genreName = genre.name;
      }
    }

    // gather unique genres from songs in this album (album_genres is GenreRef[])
    const genresMap = new Map<string, GenreRef>();
    for (const song of songs) {
      if (song.album_genres) {
        song.album_genres.forEach(g => {
          if (!genresMap.has(g.id)) {
            genresMap.set(g.id, { id: g.id, name: g.name });
          }
        });
      }
    }
    const genres = genresMap.size > 0 ? Array.from(genresMap.values()) : undefined;

    // calculate total duration
    const totalDuration = songs.reduce(
      (sum, song) => sum + song.duration_seconds,
      0,
    );

    results.push({
      album,
      artist_name: artistName,
      song_count: songs.length,
      total_duration: totalDuration,
      genres,
    });
  }

  // sort by album title (handle null/undefined titles)
  results.sort((a, b) => {
    const titleA = a.album.title || '';
    const titleB = b.album.title || '';
    return titleA.localeCompare(titleB);
  });

  // apply pagination if specified
  const limit = options?.limit ?? results.length;
  const offset = options?.offset ?? 0;

  return results.slice(offset, offset + limit);
}

export async function queryArtists(options?: {
  limit?: number;
  offset?: number;
  artistId?: string;
}): Promise<ArtistWithStats[]> {
  const db = await initMusicDB();

  // get all artists (or specific artist if artistId provided)
  const allArtists = options?.artistId
    ? [await db.get(STORE_ARTISTS, options.artistId)].filter(Boolean) as Artist[]
    : await db.getAll(STORE_ARTISTS);

  // get all songs and albums to aggregate by artist
  const allSongs = await db.getAll(STORE_SONGS);
  const allAlbums = await db.getAll(STORE_ALBUMS);

  // group songs by artist_id
  const songsByArtist = new Map<string, Song[]>();
  for (const song of allSongs) {
    if (!songsByArtist.has(song.artist_id)) {
      songsByArtist.set(song.artist_id, []);
    }
    songsByArtist.get(song.artist_id)!.push(song);
  }

  // group albums by artist_id
  const albumsByArtist = new Map<string, Set<string>>();
  for (const album of allAlbums) {
    if (album.artist_id) {
      if (!albumsByArtist.has(album.artist_id)) {
        albumsByArtist.set(album.artist_id, new Set());
      }
      albumsByArtist.get(album.artist_id)!.add(album.album_id);
    }
  }

  // build artist results with stats
  const results: ArtistWithStats[] = [];
  for (const artist of allArtists) {
    const songs = songsByArtist.get(artist.artist_id) || [];

    // skip artists with no songs
    if (songs.length === 0) continue;

    // get unique album count
    const albums = albumsByArtist.get(artist.artist_id) || new Set();

    // calculate total duration
    const totalDuration = songs.reduce(
      (sum, song) => sum + song.duration_seconds,
      0,
    );

    results.push({
      artist,
      album_count: albums.size,
      song_count: songs.length,
      total_duration: totalDuration,
    });
  }

  // sort by artist name (handle undefined names)
  results.sort((a, b) => {
    const nameA = a.artist.name || "";
    const nameB = b.artist.name || "";
    return nameA.localeCompare(nameB);
  });

  // apply pagination if specified
  const limit = options?.limit ?? results.length;
  const offset = options?.offset ?? 0;

  return results.slice(offset, offset + limit);
}

export async function queryGenres(options?: {
  limit?: number;
  offset?: number;
  search?: string;
}): Promise<GenreWithStats[]> {
  const db = await initMusicDB();

  // get all genres
  let allGenres = await db.getAll(STORE_GENRES);

  // filter by search if provided
  if (options?.search) {
    const searchLower = options.search.toLowerCase();
    allGenres = allGenres.filter(g => g.name.toLowerCase().includes(searchLower));
  }

  // get all albums and songs to count by genre
  const allAlbums = await db.getAll(STORE_ALBUMS);
  const allSongs = await db.getAll(STORE_SONGS);

  // create maps for album genre relationships
  const albumsByGenre = new Map<string, Set<string>>();
  for (const album of allAlbums) {
    if (album.genre_id) {
      if (!albumsByGenre.has(album.genre_id)) {
        albumsByGenre.set(album.genre_id, new Set());
      }
      albumsByGenre.get(album.genre_id)!.add(album.album_id);
    }
  }

  // count songs by album genre
  const songsByGenre = new Map<string, Set<string>>();
  for (const song of allSongs) {
    const album = allAlbums.find((a) => a.album_id === song.album_id);
    if (album?.genre_id) {
      if (!songsByGenre.has(album.genre_id)) {
        songsByGenre.set(album.genre_id, new Set());
      }
      songsByGenre.get(album.genre_id)!.add(song.sha256);
    }
  }

  // build genre results with stats
  const results: GenreWithStats[] = [];
  for (const genre of allGenres) {
    const albums = albumsByGenre.get(genre.genre_id) || new Set();
    const songs = songsByGenre.get(genre.genre_id) || new Set();

    // skip genres with no albums or songs
    if (albums.size === 0 && songs.size === 0) continue;

    results.push({
      genre,
      album_count: albums.size,
      song_count: songs.size,
    });
  }

  // sort by genre name (handle undefined names)
  results.sort((a, b) => {
    const nameA = a.genre.name || "";
    const nameB = b.genre.name || "";
    return nameA.localeCompare(nameB);
  });

  // apply pagination if specified
  const limit = options?.limit ?? results.length;
  const offset = options?.offset ?? 0;

  return results.slice(offset, offset + limit);
}

export async function querySongsWithDetails(options?: {
  limit?: number;
  offset?: number;
  artistId?: string;
  albumId?: string;
  genreId?: string;
  songIds?: string[];
  sortField?: "added_at" | "title" | "artist" | "album" | "genre" | "year" | "duration";
  sortDirection?: "asc" | "desc";
}): Promise<Song[]> {
  const db = await initMusicDB();
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;
  const sortField = options?.sortField ?? "added_at";
  const sortDirection = options?.sortDirection ?? "desc";

  // map sort field to compound index (all maintain album grouping)
  // note: genre uses in-memory sort because compound index excludes songs with null genre
  const indexMap: Record<string, string> = {
    added_at: "by_album_added_at_album_disc_track",
    title: "by_album_title_disc_track",
    artist: "by_artist_album_disc_track",
    album: "by_album_title_disc_track",
    year: "by_year_album_disc_track",
  };

  // fields that need in-memory sorting (no compound index or null values cause issues)
  const inMemorySortFields = ["genre", "duration"];

  let songsToQuery: Song[];

  // if filtering by artist or album, use those indexes first
  if (options?.artistId) {
    const index = db.transaction(STORE_SONGS).store.index("by_artist_id");
    songsToQuery = await index.getAll(options.artistId);
    // sort in memory since we're already filtered
    songsToQuery.sort((a, b) => {
      // always maintain album grouping: album_title -> disc -> track
      if (a.album_title !== b.album_title) {
        const titleA = a.album_title || "";
        const titleB = b.album_title || "";
        return titleA.localeCompare(titleB);
      }
      if (a.disc_number !== b.disc_number) {
        return a.disc_number - b.disc_number;
      }
      return a.track_number - b.track_number;
    });
  } else if (options?.albumId) {
    const index = db.transaction(STORE_SONGS).store.index("by_album_id");
    songsToQuery = await index.getAll(options.albumId);
    // sort by disc/track for single album
    songsToQuery.sort((a, b) => {
      if (a.disc_number !== b.disc_number) {
        return a.disc_number - b.disc_number;
      }
      return a.track_number - b.track_number;
    });
  } else if (options?.songIds) {
    // query by specific song IDs
    songsToQuery = [];
    for (const sha256 of options.songIds) {
      const song = await db.get(STORE_SONGS, sha256);
      if (song) songsToQuery.push(song);
    }
  } else if (options?.genreId) {
    // get all albums with this genre
    const allAlbums = await db.getAll(STORE_ALBUMS);
    const genreAlbums = allAlbums.filter((album) => album.genre_id === options.genreId);
    const albumIds = new Set(genreAlbums.map((a) => a.album_id));
    // get all songs and filter by album_id
    const allSongs = await db.getAll(STORE_SONGS);
    songsToQuery = allSongs.filter((song) => albumIds.has(song.album_id));
  } else if (inMemorySortFields.includes(sortField)) {
    // for genre and duration: load all songs and sort in memory
    // (compound index excludes songs with null values, causing them to disappear)
    const allSongs = await db.getAll(STORE_SONGS);

    // sort by the field, then by album grouping
    allSongs.sort((a, b) => {
      let cmp = 0;
      if (sortField === "genre") {
        const genreA = a.album_primary_genre_id || "";
        const genreB = b.album_primary_genre_id || "";
        cmp = genreA.localeCompare(genreB);
      } else if (sortField === "duration") {
        cmp = (a.duration_seconds || 0) - (b.duration_seconds || 0);
      }

      if (cmp !== 0) return sortDirection === "desc" ? -cmp : cmp;

      // secondary sort by album grouping
      const albumCmp = (a.album_title || "").localeCompare(b.album_title || "");
      if (albumCmp !== 0) return albumCmp;
      if (a.disc_number !== b.disc_number) return a.disc_number - b.disc_number;
      return a.track_number - b.track_number;
    });

    songsToQuery = allSongs.slice(offset, offset + limit);
  } else {
    // use compound index for sorted, album-grouped results
    const indexName = indexMap[sortField];
    const index = db.transaction(STORE_SONGS).store.index(indexName);

    // for desc sort: load all, group by album, reverse albums, then paginate
    // this ensures newest albums are at top with correct disc/track order
    if (sortDirection === "desc") {
      // load all songs from index (in asc order to maintain disc/track)
      const allSongs = await index.getAll();

      // group by album_id preserving order
      const albumGroups: Song[][] = [];
      const seenAlbums = new Set<string>();

      for (const song of allSongs) {
        if (!seenAlbums.has(song.album_id)) {
          seenAlbums.add(song.album_id);
          albumGroups.push([]);
        }
        albumGroups[albumGroups.length - 1].push(song);
      }

      // reverse album groups to get newest first
      albumGroups.reverse();

      // flatten and paginate
      const flattened = albumGroups.flat();
      songsToQuery = flattened.slice(offset, offset + limit);
    } else {
      // asc: use cursor pagination normally
      const cursor = await index.openCursor(null, "next");
      songsToQuery = [];
      let skipped = 0;
      let collected = 0;

      if (cursor) {
        let currentCursor = cursor;
        while (currentCursor && collected < limit) {
          if (skipped < offset) {
            skipped++;
            currentCursor = await currentCursor.continue();
          } else {
            songsToQuery.push(currentCursor.value);
            collected++;
            currentCursor = await currentCursor.continue();
          }
        }
      }
    }
  }

  // apply pagination if we loaded all (artist/album filter cases)
  if (options?.artistId || options?.albumId) {
    songsToQuery = songsToQuery.slice(offset, offset + limit);
  }

  // join with artists, albums, genres and enrich songs with denormalized fields
  const results: Song[] = [];

  // load all albums, artists, genres, tags once for lookups
  const allAlbums = await db.getAll(STORE_ALBUMS);
  const allGenres = await db.getAll(STORE_GENRES);
  const allTags = await db.getAll(STORE_TAGS);
  const allAlbumTags = await db.getAll(STORE_ALBUM_TAGS);

  const albumsMap = new Map(allAlbums.map(a => [a.album_id, a]));
  const genresMap = new Map(allGenres.map(g => [g.genre_id, g]));
  const tagsMap = new Map(allTags.map(t => [t.tag_id, t]));

  // build map of album_id -> tag names
  const albumTagsMap = new Map<string, string[]>();
  for (const albumTag of allAlbumTags) {
    const tag = tagsMap.get(albumTag.tag_id);
    if (tag) {
      if (!albumTagsMap.has(albumTag.album_id)) {
        albumTagsMap.set(albumTag.album_id, []);
      }
      albumTagsMap.get(albumTag.album_id)!.push(tag.name);
    }
  }

  for (const song of songsToQuery) {
    const isFavorite = await checkFavorite("song", song.id);
    const rating = await getRating("song", song.id);

    // get album to populate denormalized fields
    const album = albumsMap.get(song.album_id);
    const albumIsFavorite = album ? await checkFavorite("album", album.album_id) : false;
    const albumRating = album ? await getRating("album", album.album_id) : null;

    // get genre name if album has genre_id
    const genreName = album?.genre_id ? genresMap.get(album.genre_id)?.name : undefined;

    // get album tags
    const albumTags = album ? albumTagsMap.get(album.album_id) : undefined;

    // enrich song object with is_favorite, user_rating, and denormalized album fields
    const enrichedSong: Song = {
      ...song,
      is_favorite: isFavorite,
      user_rating: rating ?? undefined,
      album_is_favorite: albumIsFavorite,
      album_rating: albumRating ?? undefined,
      album_primary_genre_id: album?.genre_id,
      album_primary_genre_name: genreName,
      album_tags: albumTags,
      album_images: album?.images, // include album images for artwork display
      // album_genres is already on the song from import/edit
    };

    results.push(enrichedSong);
  }

  return results;
}
