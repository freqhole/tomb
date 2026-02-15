// cascade delete operations for artists, albums, and songs
// separated to avoid circular dependencies between entity modules
import { initMusicDB } from "./init";
import { countSongsByArtist } from "./artists";
import { countSongsByAlbum } from "./albums";
import { STORE_ALBUMS, STORE_ARTISTS, STORE_PLAYLISTS, STORE_SONGS } from "../types";
import { deleteBlob } from "../blobs";
import { deleteAudioFromOPFS, deleteThumbnailFromOPFS } from "../../opfs/helpers";
import { debug, warn } from "../../../../utils/logger";

/**
 * delete artist with cascade: deletes all albums and songs, cleans up blobs
 * also removes from playlists and cleans up orphaned data
 */
export async function deleteArtistCascade(artistId: string): Promise<{ deletedSongs: number; deletedAlbums: number; deletedBlobs: number }> {
  const db = await initMusicDB();

  let deletedSongs = 0;
  let deletedAlbums = 0;
  let deletedBlobs = 0;

  // get all albums by this artist
  const albumIndex = db.transaction(STORE_ALBUMS).store.index("by_artist_id");
  const albums = await albumIndex.getAll(artistId);

  // delete each album's songs and blobs
  for (const album of albums) {
    const result = await deleteAlbumCascade(album.album_id, false); // don't check orphan artist since we're deleting it
    deletedSongs += result.deletedSongs;
    deletedBlobs += result.deletedBlobs;
    deletedAlbums++;
  }

  // delete artist images - try both blob system and opfs thumbnails
  const artist = await db.get(STORE_ARTISTS, artistId);
  if (artist?.images) {
    for (const img of artist.images) {
      if (img.local_blob_id) {
        try {
          await deleteBlob(img.local_blob_id);
          deletedBlobs++;
        } catch {
          try {
            await deleteThumbnailFromOPFS(img.local_blob_id);
            deletedBlobs++;
          } catch {
            // ignore - blob may not exist in either location
          }
        }
      }
    }
  }

  // delete the artist
  await db.delete(STORE_ARTISTS, artistId);

  return { deletedSongs, deletedAlbums, deletedBlobs };
}

/**
 * delete album with cascade: deletes all songs and their blobs, cleans up orphaned artists
 */
export async function deleteAlbumCascade(albumId: string, checkOrphanArtist = true): Promise<{ deletedSongs: number; deletedBlobs: number; orphanedArtistDeleted: boolean }> {
  const db = await initMusicDB();

  let deletedSongs = 0;
  let deletedBlobs = 0;
  let orphanedArtistDeleted = false;

  // get the album first for artist reference
  const album = await db.get(STORE_ALBUMS, albumId);

  // get all songs in this album
  const songIndex = db.transaction(STORE_SONGS).store.index("by_album_id");
  const songs = await songIndex.getAll(albumId);

  // delete each song and its blobs (don't check orphans since we're deleting the album)
  for (const song of songs) {
    const result = await deleteSongCascade(song.id, false);
    deletedBlobs += result.deletedBlobs;
    deletedSongs++;
  }

  // delete album images - try both blob system and opfs thumbnails
  if (album?.images) {
    for (const img of album.images) {
      if (img.local_blob_id) {
        try {
          await deleteBlob(img.local_blob_id);
          deletedBlobs++;
        } catch {
          try {
            await deleteThumbnailFromOPFS(img.local_blob_id);
            deletedBlobs++;
          } catch {
            // ignore - blob may not exist in either location
          }
        }
      }
    }
  }

  // delete the album
  await db.delete(STORE_ALBUMS, albumId);

  // check if artist is now orphaned
  if (checkOrphanArtist && album?.artist_id) {
    const artistSongCount = await countSongsByArtist(album.artist_id);
    if (artistSongCount === 0) {
      // also delete artist images before deleting artist
      const artist = await db.get(STORE_ARTISTS, album.artist_id);
      if (artist?.images) {
        for (const img of artist.images) {
          if (img.local_blob_id) {
            try {
              await deleteBlob(img.local_blob_id);
              deletedBlobs++;
            } catch {
              try {
                await deleteThumbnailFromOPFS(img.local_blob_id);
                deletedBlobs++;
              } catch {
                // ignore - blob may not exist in either location
              }
            }
          }
        }
      }
      await db.delete(STORE_ARTISTS, album.artist_id);
      orphanedArtistDeleted = true;
    }
  }

  return { deletedSongs, deletedBlobs, orphanedArtistDeleted };
}

/**
 * delete song with blob cleanup: deletes audio file from OPFS and image blobs
 * also removes from playlists and optionally checks for orphaned artists/albums
 */
export async function deleteSongCascade(songId: string, checkOrphans = true): Promise<{ deletedBlobs: number; orphanedArtistDeleted: boolean; orphanedAlbumDeleted: boolean }> {
  const db = await initMusicDB();

  let deletedBlobs = 0;
  let orphanedArtistDeleted = false;
  let orphanedAlbumDeleted = false;

  // get the song first so we know what to clean up
  const song = await db.get(STORE_SONGS, songId);
  if (!song) {
    return { deletedBlobs, orphanedArtistDeleted, orphanedAlbumDeleted };
  }

  // delete audio file from OPFS if exists (local/downloaded files)
  if (song.opfs_path) {
    try {
      await deleteAudioFromOPFS(song.opfs_path);
      deletedBlobs++;
      debug(`deleted audio from opfs: ${song.opfs_path}`);
    } catch (error) {
      warn(`failed to delete audio from opfs: ${song.opfs_path}`, error);
    }
  }

  // delete image blobs - try both blob system and opfs thumbnails
  if (song.images) {
    for (const img of song.images) {
      if (img.local_blob_id) {
        try {
          // try blobs system first (for locally uploaded images)
          await deleteBlob(img.local_blob_id);
          deletedBlobs++;
        } catch {
          // if that fails, try opfs thumbnails (for downloaded images)
          try {
            await deleteThumbnailFromOPFS(img.local_blob_id);
            deletedBlobs++;
          } catch {
            // ignore - blob may not exist in either location
          }
        }
      }
    }
  }

  // remove from all playlists
  await removeSongFromAllPlaylists(songId);

  // delete the song
  await db.delete(STORE_SONGS, songId);

  // check for orphaned album/artist if requested
  if (checkOrphans && song.album_id) {
    const albumSongCount = await countSongsByAlbum(song.album_id);
    if (albumSongCount === 0) {
      const album = await db.get(STORE_ALBUMS, song.album_id);
      await db.delete(STORE_ALBUMS, song.album_id);
      orphanedAlbumDeleted = true;

      // check if artist is now orphaned
      if (album?.artist_id) {
        const artistSongCount = await countSongsByArtist(album.artist_id);
        if (artistSongCount === 0) {
          await db.delete(STORE_ARTISTS, album.artist_id);
          orphanedArtistDeleted = true;
        }
      }
    }
  }

  return { deletedBlobs, orphanedArtistDeleted, orphanedAlbumDeleted };
}

// remove a song from all playlists that contain it
async function removeSongFromAllPlaylists(songId: string): Promise<void> {
  const db = await initMusicDB();
  const playlists = await db.getAll(STORE_PLAYLISTS);

  for (const playlist of playlists) {
    if (playlist.song_ids?.includes(songId)) {
      const updatedSongIds = playlist.song_ids.filter((id: string) => id !== songId);
      await db.put(STORE_PLAYLISTS, { ...playlist, song_ids: updatedSongIds });
    }
  }
}
