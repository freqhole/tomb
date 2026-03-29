// gossip type re-exports — single import path for components
//
// API types come from freqhole-api-client (generated).
// client-only types and extended types are defined here.
// the generated types are strict (discriminated unions, no extra fields),
// so we extend them with client-side fields used by UI components.

import type {
  GossipChannel as ApiGossipChannel,
  GossipChannelMember as ApiGossipChannelMember,
  GossipMessage as ApiGossipMessage,
  GossipReaction as ApiGossipReaction,
  GossipProfile as ApiGossipProfile,
  GossipEnvelope as ApiGossipEnvelope,
} from "freqhole-api-client";

// unchanged re-exports
export type { ApiGossipReaction as GossipReaction };
export type { ApiGossipProfile as GossipProfile };
export type { ApiGossipEnvelope as GossipEnvelope };

/** extends generated GossipChannelMember with client-side tracking fields */
export type GossipChannelMember = ApiGossipChannelMember & {
  /** message_id of the last message this member has read (from ReadReceipt) */
  last_read_message_id?: string;
  /** timestamp of the last read receipt */
  last_read_at?: number;
  /** last heartbeat timestamp from this member */
  last_heartbeat?: number;
  /** unix timestamp when this member came online (from Heartbeat payload) */
  online_since?: number | null;
};

/** extends generated GossipMessage with client-side fields */
export type GossipMessage = ApiGossipMessage & {
  sender_avatar_url?: string | null;
  reactions?: ApiGossipReaction[];
};

/** extends GossipChannel with convenience fields */
export type GossipChannel = ApiGossipChannel & {
  allow_text?: boolean;
};

/**
 * flattened music reference for UI rendering.
 * the generated API has separate SongReference, AlbumReference, etc. but
 * components render all variants with a single switch on ref_type,
 * so we use a flat interface with optional variant-specific fields.
 */
export interface MusicReference {
  ref_type: "Song" | "Album" | "Artist" | "Playlist" | "Genre";
  remote_id: string;
  source_node_id: string;
  source_name?: string | null;
  // song
  title?: string;
  track_artist?: string | null;
  album_title?: string | null;
  duration?: number | null;
  track_number?: number;
  disc_number?: number;
  bpm?: number | null;
  // album
  artist_name?: string | null;
  album_type?: string;
  release_date?: string | null;
  song_count?: number;
  total_duration?: number;
  genres?: string[];
  // artist
  name?: string;
  bio?: string | null;
  // playlist
  description?: string | null;
  // shared
  thumbnails: string[];
  thumbnail_url?: string;
}

/** client-only: friend entry stored in IndexedDB */
export interface GossipFriend {
  node_id: string;
  display_name: string;
  avatar_url?: string | null;
  last_seen: number | null;
  online: boolean;
}

/** client-only: incoming friend request */
export interface FriendRequest {
  node_id: string;
  display_name: string;
  avatar_url: string | null;
  message?: string;
  requested_at: number;
}
