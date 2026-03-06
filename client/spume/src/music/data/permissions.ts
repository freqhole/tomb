// reactive permission helpers for UI
//
// wraps freqhole-api-client permission functions with plain functions
// so components can check permissions without passing role/userId everywhere.
// these are not memoized - permission checks are cheap and this avoids
// SolidJS reactive context issues from createMemo at module scope.

import { permissions } from "../../app/api/client";
import { getCurrentUser } from "./index";

// ============================================================================
// role-based permission functions
// ============================================================================

/** can user set favorites? requires Member role */
export function canSetFavorite(): boolean {
  const user = getCurrentUser();
  return user ? permissions.canSetFavorite(user.role) : false;
}

/** can user set ratings? requires Member role */
export function canSetRating(): boolean {
  const user = getCurrentUser();
  return user ? permissions.canSetRating(user.role) : false;
}

/** can user create playlists? requires Member role */
export function canCreatePlaylist(): boolean {
  const user = getCurrentUser();
  return user ? permissions.canCreatePlaylist(user.role) : false;
}

/** can user upload music? requires Member role */
export function canUploadMusic(): boolean {
  const user = getCurrentUser();
  return user ? permissions.canUploadMusic(user.role) : false;
}

/** can user upload images? requires Member role */
export function canUploadImage(): boolean {
  const user = getCurrentUser();
  return user ? permissions.canUploadImage(user.role) : false;
}

/** can user create fetch jobs (url downloads)? requires Member role */
export function canCreateFetchJob(): boolean {
  const user = getCurrentUser();
  return user ? permissions.canCreateFetchJob(user.role) : false;
}

/** can user create listen sessions? requires Member role */
export function canCreateListenSession(): boolean {
  const user = getCurrentUser();
  return user ? permissions.canCreateListenSession(user.role) : false;
}

/** is user at least Member? */
export function isMemberOrHigher(): boolean {
  const user = getCurrentUser();
  return user ? permissions.isMemberOrHigher(user.role) : false;
}

/** is user Admin? */
export function isAdmin(): boolean {
  const user = getCurrentUser();
  return user ? permissions.isAdmin(user.role) : false;
}

// ============================================================================
// admin mutation permission functions
// ============================================================================

/** can user delete songs? requires Admin role */
export function canDeleteSong(): boolean {
  const user = getCurrentUser();
  return user ? permissions.canDeleteSong(user.role) : false;
}

/** can user update songs? requires Admin role */
export function canUpdateSong(): boolean {
  const user = getCurrentUser();
  return user ? permissions.canUpdateSong(user.role) : false;
}

/** can user delete albums? requires Admin role */
export function canDeleteAlbum(): boolean {
  const user = getCurrentUser();
  return user ? permissions.canDeleteAlbum(user.role) : false;
}

/** can user update albums? requires Admin role */
export function canUpdateAlbum(): boolean {
  const user = getCurrentUser();
  return user ? permissions.canUpdateAlbum(user.role) : false;
}

/** can user create artists? requires Admin role */
export function canCreateArtist(): boolean {
  const user = getCurrentUser();
  return user ? permissions.canCreateArtist(user.role) : false;
}

/** can user delete artists? requires Admin role */
export function canDeleteArtist(): boolean {
  const user = getCurrentUser();
  return user ? permissions.canDeleteArtist(user.role) : false;
}

/** can user update artists? requires Admin role */
export function canUpdateArtist(): boolean {
  const user = getCurrentUser();
  return user ? permissions.canUpdateArtist(user.role) : false;
}

/** can user manage tags? requires Admin role */
export function canManageTags(): boolean {
  const user = getCurrentUser();
  return user ? permissions.canManageTags(user.role) : false;
}

/** can user delete images? requires Admin role */
export function canDeleteImage(): boolean {
  const user = getCurrentUser();
  return user ? permissions.canDeleteImage(user.role) : false;
}

/** can user set primary image? requires Admin role */
export function canSetPrimaryImage(): boolean {
  const user = getCurrentUser();
  return user ? permissions.canSetPrimaryImage(user.role) : false;
}

/** can user access MusicBrainz lookups? requires Admin role */
export function canAccessMusicBrainz(): boolean {
  const user = getCurrentUser();
  return user ? permissions.canAccessMusicBrainz(user.role) : false;
}

// ============================================================================
// ownership-based permission functions (need owner id parameter)
// ============================================================================

/** can user delete this playlist? requires ownership or Admin role */
export function canDeletePlaylist(playlistOwnerId: string | null): boolean {
  const user = getCurrentUser();
  if (!user) return false;
  return permissions.canDeletePlaylist(user.userId, playlistOwnerId, user.role);
}

/** can user update this playlist? requires ownership or Admin role */
export function canUpdatePlaylist(playlistOwnerId: string | null): boolean {
  const user = getCurrentUser();
  if (!user) return false;
  return permissions.canUpdatePlaylist(user.userId, playlistOwnerId, user.role);
}

/** can user add songs to this playlist? requires ownership or Admin role */
export function canAddSongsToPlaylist(playlistOwnerId: string | null): boolean {
  const user = getCurrentUser();
  if (!user) return false;
  return permissions.canAddSongsToPlaylist(user.userId, playlistOwnerId, user.role);
}

/** can user remove songs from this playlist? requires ownership or Admin role */
export function canRemoveSongsFromPlaylist(playlistOwnerId: string | null): boolean {
  const user = getCurrentUser();
  if (!user) return false;
  return permissions.canRemoveSongsFromPlaylist(user.userId, playlistOwnerId, user.role);
}

/** can user reorder songs in this playlist? requires ownership or Admin role */
export function canReorderPlaylistSongs(playlistOwnerId: string | null): boolean {
  const user = getCurrentUser();
  if (!user) return false;
  return permissions.canReorderPlaylistSongs(user.userId, playlistOwnerId, user.role);
}

/** can user delete this listen session? requires ownership (no admin override) */
export function canDeleteListenSession(sessionOwnerId: string | null): boolean {
  const user = getCurrentUser();
  if (!user) return false;
  return permissions.canDeleteListenSession(user.userId, sessionOwnerId);
}

/** can user update this listen session? requires ownership (no admin override) */
export function canUpdateListenSession(sessionOwnerId: string | null): boolean {
  const user = getCurrentUser();
  if (!user) return false;
  return permissions.canUpdateListenSession(user.userId, sessionOwnerId);
}
