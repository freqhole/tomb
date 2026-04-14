// permission helpers for route authorization
//
// these are hand-written helpers that use the generated route auth metadata
// to check if a user has permission to perform actions.

import {
  roleHierarchy,
  routes,
  type RouteAuth,
  type UserRoleName,
} from "./codegen/routes.js";

// ============================================================================
// core permission functions
// ============================================================================

/**
 * check if a user role has at least the required role level.
 * lower hierarchy number = higher privilege.
 *
 * @param userRole - the user's current role
 * @param requiredRole - the minimum required role
 * @returns true if user has sufficient privileges
 */
export function canAccessRole(
  userRole: UserRoleName,
  requiredRole: UserRoleName,
): boolean {
  return roleHierarchy[userRole] <= roleHierarchy[requiredRole];
}

/**
 * check if user is the owner OR has at least the required role.
 * used for routes with OwnerOr(Role) auth.
 *
 * @param userId - the current user's id
 * @param ownerId - the resource owner's id (can be null for new resources)
 * @param userRole - the user's current role
 * @param requiredRole - the role that grants access regardless of ownership
 * @returns true if user is owner or has sufficient role
 */
export function canAccessOwnerOr(
  userId: string,
  ownerId: string | null,
  userRole: UserRoleName,
  requiredRole: UserRoleName,
): boolean {
  // owner always has access
  if (ownerId !== null && userId === ownerId) {
    return true;
  }
  // otherwise check role
  return canAccessRole(userRole, requiredRole);
}

/**
 * check if user is strictly the owner.
 * used for routes with Owner auth (no admin override).
 *
 * @param userId - the current user's id
 * @param ownerId - the resource owner's id
 * @returns true if user is the owner
 */
export function canAccessOwner(
  userId: string,
  ownerId: string | null,
): boolean {
  return ownerId !== null && userId === ownerId;
}

/**
 * generic route auth check.
 * evaluates any RouteAuth against user context.
 *
 * @param auth - the route's auth requirement
 * @param userRole - the user's current role (null if not authenticated)
 * @param userId - the current user's id (null if not authenticated)
 * @param ownerId - the resource owner's id (null if not applicable)
 * @returns true if user can access the route
 */
export function canAccessRoute(
  auth: RouteAuth,
  userRole: UserRoleName | null,
  userId: string | null,
  ownerId: string | null,
): boolean {
  switch (auth.type) {
    case "public":
      return true;

    case "authenticated":
      return userRole !== null;

    case "role":
      return userRole !== null && canAccessRole(userRole, auth.role);

    case "owner":
      return userId !== null && canAccessOwner(userId, ownerId);

    case "owner_or":
      return (
        userId !== null &&
        userRole !== null &&
        canAccessOwnerOr(userId, ownerId, userRole, auth.role)
      );
  }
}

// ============================================================================
// entity-specific permission helpers
// ============================================================================

/**
 * check if user can delete a playlist.
 * playlists use OwnerOr(Admin) - owner or admin can delete.
 */
export function canDeletePlaylist(
  userId: string,
  playlistOwnerId: string | null,
  userRole: UserRoleName,
): boolean {
  const auth = routes.music.delete_playlist.auth;
  if (auth.type === "owner_or") {
    return canAccessOwnerOr(userId, playlistOwnerId, userRole, auth.role);
  }
  // fallback: shouldn't happen but be safe
  return false;
}

/**
 * check if user can update a playlist.
 * playlists use OwnerOr(Admin) - owner or admin can update.
 */
export function canUpdatePlaylist(
  userId: string,
  playlistOwnerId: string | null,
  userRole: UserRoleName,
): boolean {
  const auth = routes.music.update_playlist.auth;
  if (auth.type === "owner_or") {
    return canAccessOwnerOr(userId, playlistOwnerId, userRole, auth.role);
  }
  return false;
}

/**
 * check if user can add songs to a playlist.
 * playlists use OwnerOr(Admin).
 */
export function canAddSongsToPlaylist(
  userId: string,
  playlistOwnerId: string | null,
  userRole: UserRoleName,
): boolean {
  const auth = routes.music.add_songs_to_playlist.auth;
  if (auth.type === "owner_or") {
    return canAccessOwnerOr(userId, playlistOwnerId, userRole, auth.role);
  }
  return false;
}

/**
 * check if user can remove songs from a playlist.
 * playlists use OwnerOr(Admin).
 */
export function canRemoveSongsFromPlaylist(
  userId: string,
  playlistOwnerId: string | null,
  userRole: UserRoleName,
): boolean {
  const auth = routes.music.remove_songs_from_playlist.auth;
  if (auth.type === "owner_or") {
    return canAccessOwnerOr(userId, playlistOwnerId, userRole, auth.role);
  }
  return false;
}

/**
 * check if user can delete a listen session.
 * listen sessions use OwnerOr(Admin) - owner or admin can delete.
 */
export function canDeleteListenSession(
  userId: string,
  sessionOwnerId: string | null,
  userRole: UserRoleName,
): boolean {
  // listen sessions use OwnerOr(Admin) - owner or admin can delete
  const auth = routes.music.delete_listen_session.auth;
  if (auth.type === "owner_or") {
    return canAccessOwnerOr(userId, sessionOwnerId, userRole, auth.role);
  }
  return canAccessOwner(userId, sessionOwnerId);
}

/**
 * check if user can update a listen session.
 * listen sessions use Owner - strictly owner only.
 */
export function canUpdateListenSession(
  userId: string,
  sessionOwnerId: string | null,
): boolean {
  return canAccessOwner(userId, sessionOwnerId);
}

/**
 * check if user can delete a song.
 * songs require Admin role.
 */
export function canDeleteSong(userRole: UserRoleName): boolean {
  const auth = routes.music.delete_song.auth;
  if (auth.type === "role") {
    return canAccessRole(userRole, auth.role);
  }
  return false;
}

/**
 * check if user can update songs.
 * songs require Admin role.
 */
export function canUpdateSong(userRole: UserRoleName): boolean {
  const auth = routes.music.update_songs.auth;
  if (auth.type === "role") {
    return canAccessRole(userRole, auth.role);
  }
  return false;
}

/**
 * check if user can delete an album.
 * albums require Admin role.
 */
export function canDeleteAlbum(userRole: UserRoleName): boolean {
  const auth = routes.music.delete_album.auth;
  if (auth.type === "role") {
    return canAccessRole(userRole, auth.role);
  }
  return false;
}

/**
 * check if user can update an album.
 * albums require Admin role.
 */
export function canUpdateAlbum(userRole: UserRoleName): boolean {
  const auth = routes.music.update_album.auth;
  if (auth.type === "role") {
    return canAccessRole(userRole, auth.role);
  }
  return false;
}

/**
 * check if user can delete an artist.
 * artists require Admin role.
 */
export function canDeleteArtist(userRole: UserRoleName): boolean {
  const auth = routes.music.delete_artist.auth;
  if (auth.type === "role") {
    return canAccessRole(userRole, auth.role);
  }
  return false;
}

/**
 * check if user can upload music.
 * uploads require Member role.
 */
export function canUploadMusic(userRole: UserRoleName): boolean {
  const auth = routes.music.upload_music.auth;
  if (auth.type === "role") {
    return canAccessRole(userRole, auth.role);
  }
  return false;
}

/**
 * check if user can create a playlist.
 * playlists require Member role to create.
 */
export function canCreatePlaylist(userRole: UserRoleName): boolean {
  const auth = routes.music.create_playlist.auth;
  if (auth.type === "role") {
    return canAccessRole(userRole, auth.role);
  }
  return false;
}

// ============================================================================
// additional Member role checks
// ============================================================================

/**
 * check if user can set favorites.
 * favorites require Member role.
 */
export function canSetFavorite(userRole: UserRoleName): boolean {
  const auth = routes.music.set_favorite.auth;
  if (auth.type === "role") {
    return canAccessRole(userRole, auth.role);
  }
  return false;
}

/**
 * check if user can set ratings.
 * ratings require Member role.
 */
export function canSetRating(userRole: UserRoleName): boolean {
  const auth = routes.music.set_rating.auth;
  if (auth.type === "role") {
    return canAccessRole(userRole, auth.role);
  }
  return false;
}

/**
 * check if user can upload images.
 * images require Member role to upload.
 */
export function canUploadImage(userRole: UserRoleName): boolean {
  const auth = routes.music.upload_image.auth;
  if (auth.type === "role") {
    return canAccessRole(userRole, auth.role);
  }
  return false;
}

/**
 * check if user can create listen sessions.
 * listen sessions require Member role.
 */
export function canCreateListenSession(userRole: UserRoleName): boolean {
  const auth = routes.music.create_listen_session.auth;
  if (auth.type === "role") {
    return canAccessRole(userRole, auth.role);
  }
  return false;
}

/**
 * check if user can create fetch jobs (download from URL).
 * fetch jobs require Member role.
 */
export function canCreateFetchJob(userRole: UserRoleName): boolean {
  const auth = routes.music.create_fetch_job.auth;
  if (auth.type === "role") {
    return canAccessRole(userRole, auth.role);
  }
  return false;
}

// ============================================================================
// additional Admin role checks
// ============================================================================

/**
 * check if user can create an artist.
 * artists require Admin role to create.
 */
export function canCreateArtist(userRole: UserRoleName): boolean {
  const auth = routes.music.create_artist.auth;
  if (auth.type === "role") {
    return canAccessRole(userRole, auth.role);
  }
  return false;
}

/**
 * check if user can update an artist.
 * artists require Admin role.
 */
export function canUpdateArtist(userRole: UserRoleName): boolean {
  const auth = routes.music.update_artist.auth;
  if (auth.type === "role") {
    return canAccessRole(userRole, auth.role);
  }
  return false;
}

/**
 * check if user can manage tags (add/remove/replace/delete).
 * tags require Admin role.
 */
export function canManageTags(userRole: UserRoleName): boolean {
  const auth = routes.music.add_albums_tags.auth;
  if (auth.type === "role") {
    return canAccessRole(userRole, auth.role);
  }
  return false;
}

/**
 * check if user can delete images.
 * image deletion requires Admin role.
 */
export function canDeleteImage(userRole: UserRoleName): boolean {
  const auth = routes.music.delete_image.auth;
  if (auth.type === "role") {
    return canAccessRole(userRole, auth.role);
  }
  return false;
}

/**
 * check if user can set primary image.
 * setting primary image requires Admin role.
 */
export function canSetPrimaryImage(userRole: UserRoleName): boolean {
  const auth = routes.music.set_primary_image.auth;
  if (auth.type === "role") {
    return canAccessRole(userRole, auth.role);
  }
  return false;
}

/**
 * check if user can access MusicBrainz lookup.
 * MusicBrainz requires Admin role.
 */
export function canAccessMusicBrainz(userRole: UserRoleName): boolean {
  const auth = routes.music.search_musicbrainz_releases.auth;
  if (auth.type === "role") {
    return canAccessRole(userRole, auth.role);
  }
  return false;
}

// ============================================================================
// playlist mutation helpers (OwnerOr)
// ============================================================================

/**
 * check if user can reorder songs in a playlist.
 * playlists use OwnerOr(Admin).
 */
export function canReorderPlaylistSongs(
  userId: string,
  playlistOwnerId: string | null,
  userRole: UserRoleName,
): boolean {
  const auth = routes.music.reorder_playlist_songs.auth;
  if (auth.type === "owner_or") {
    return canAccessOwnerOr(userId, playlistOwnerId, userRole, auth.role);
  }
  return false;
}

// ============================================================================
// convenience role checks (no route lookup needed)
// ============================================================================

/**
 * check if user has at least Member role.
 * use for UI elements that require any non-Viewer role.
 */
export function isMemberOrHigher(userRole: UserRoleName): boolean {
  return canAccessRole(userRole, "member");
}

/**
 * check if user has Admin role.
 * use for UI elements that require admin access.
 */
export function isAdmin(userRole: UserRoleName): boolean {
  return canAccessRole(userRole, "admin");
}
