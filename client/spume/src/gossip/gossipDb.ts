// gossip IndexedDB — local cache for channels, messages, members, profiles
//
// separate database from music (different lifecycle, different sync patterns).
// gossip data is fetched from the server and cached here for offline access +
// fast rendering. eventual consistency: server is source of truth.

import { openDB, type IDBPDatabase } from "idb";
import { debug } from "../utils/logger";

const GOSSIP_DB_NAME = "freqhole-gossip";
const GOSSIP_DB_VERSION = 2;

// store names
export const STORE_CHANNELS = "channels";
export const STORE_MESSAGES = "messages";
export const STORE_REACTIONS = "reactions";
export const STORE_MEMBERS = "members";
export const STORE_PROFILES = "profiles";
export const STORE_FRIENDS = "friends";

let dbInstance: IDBPDatabase | null = null;

export async function initGossipDB(): Promise<IDBPDatabase> {
  if (dbInstance) return dbInstance;

  dbInstance = await openDB(GOSSIP_DB_NAME, GOSSIP_DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        // channels
        const channels = db.createObjectStore(STORE_CHANNELS, { keyPath: "topic_id" });
        channels.createIndex("by_last_message", "last_message_at");

        // messages
        const messages = db.createObjectStore(STORE_MESSAGES, { keyPath: "message_id" });
        messages.createIndex("by_topic_ts", ["topic_id", "timestamp"]);
        messages.createIndex("by_topic_id", "topic_id");

        // reactions
        const reactions = db.createObjectStore(STORE_REACTIONS, { keyPath: "message_id" });
        reactions.createIndex("by_target", "target_message_id");
        reactions.createIndex("by_topic_id", "topic_id");

        // members
        const members = db.createObjectStore(STORE_MEMBERS, { keyPath: ["topic_id", "node_id"] });
        members.createIndex("by_topic_id", "topic_id");

        // gossip profiles (display name + avatar per node)
        db.createObjectStore(STORE_PROFILES, { keyPath: "node_id" });
      }

      if (oldVersion < 2) {
        // friends
        db.createObjectStore(STORE_FRIENDS, { keyPath: "node_id" });
      }
    },
    blocked() {
      // if another tab has the old version open, just close and reopen
      dbInstance?.close();
      dbInstance = null;
    },
  });

  debug("gossip-db", "initialized");
  return dbInstance;
}

async function db(): Promise<IDBPDatabase> {
  return dbInstance ?? initGossipDB();
}

// ============================================================================
// channels
// ============================================================================

export async function putChannel(channel: any): Promise<void> {
  const d = await db();
  await d.put(STORE_CHANNELS, channel);
}

export async function putChannels(channels: any[]): Promise<void> {
  const d = await db();
  const tx = d.transaction(STORE_CHANNELS, "readwrite");
  for (const c of channels) tx.store.put(c);
  await tx.done;
}

export async function getChannel(topicId: string): Promise<any | undefined> {
  const d = await db();
  return d.get(STORE_CHANNELS, topicId);
}

export async function getAllChannels(): Promise<any[]> {
  const d = await db();
  return d.getAll(STORE_CHANNELS);
}

export async function deleteChannel(topicId: string): Promise<void> {
  const d = await db();
  await d.delete(STORE_CHANNELS, topicId);
}

// ============================================================================
// messages
// ============================================================================

export async function putMessages(messages: any[]): Promise<void> {
  const d = await db();
  const tx = d.transaction(STORE_MESSAGES, "readwrite");
  for (const m of messages) tx.store.put(m);
  await tx.done;
}

export async function getMessagesByTopic(topicId: string): Promise<any[]> {
  const d = await db();
  return d.getAllFromIndex(STORE_MESSAGES, "by_topic_id", topicId);
}

export async function deleteMessagesByTopic(topicId: string): Promise<void> {
  const d = await db();
  const tx = d.transaction(STORE_MESSAGES, "readwrite");
  const idx = tx.store.index("by_topic_id");
  let cursor = await idx.openCursor(topicId);
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}

// ============================================================================
// reactions
// ============================================================================

export async function putReactions(reactions: any[]): Promise<void> {
  const d = await db();
  const tx = d.transaction(STORE_REACTIONS, "readwrite");
  for (const r of reactions) tx.store.put(r);
  await tx.done;
}

export async function getReactionsByTarget(targetMessageId: string): Promise<any[]> {
  const d = await db();
  return d.getAllFromIndex(STORE_REACTIONS, "by_target", targetMessageId);
}

export async function getReactionsByTopic(topicId: string): Promise<any[]> {
  const d = await db();
  return d.getAllFromIndex(STORE_REACTIONS, "by_topic_id", topicId);
}

// ============================================================================
// members
// ============================================================================

export async function putMembers(topicId: string, members: any[]): Promise<void> {
  const d = await db();
  const tx = d.transaction(STORE_MEMBERS, "readwrite");
  for (const m of members) tx.store.put({ ...m, topic_id: topicId });
  await tx.done;
}

export async function getMembersByTopic(topicId: string): Promise<any[]> {
  const d = await db();
  return d.getAllFromIndex(STORE_MEMBERS, "by_topic_id", topicId);
}

// ============================================================================
// profiles
// ============================================================================

export async function putProfile(profile: any): Promise<void> {
  const d = await db();
  await d.put(STORE_PROFILES, profile);
}

export async function getProfile(nodeId: string): Promise<any | undefined> {
  const d = await db();
  return d.get(STORE_PROFILES, nodeId);
}

export async function getAllProfiles(): Promise<any[]> {
  const d = await db();
  return d.getAll(STORE_PROFILES);
}

export async function deleteProfile(nodeId: string): Promise<void> {
  const d = await db();
  await d.delete(STORE_PROFILES, nodeId);
}

// ============================================================================
// bulk operations
// ============================================================================

/** clear all gossip data (for logout / remote switch) */
export async function clearAllGossipData(): Promise<void> {
  const d = await db();
  const tx = d.transaction(
    [STORE_CHANNELS, STORE_MESSAGES, STORE_REACTIONS, STORE_MEMBERS, STORE_PROFILES, STORE_FRIENDS],
    "readwrite",
  );
  await Promise.all([
    tx.objectStore(STORE_CHANNELS).clear(),
    tx.objectStore(STORE_MESSAGES).clear(),
    tx.objectStore(STORE_REACTIONS).clear(),
    tx.objectStore(STORE_MEMBERS).clear(),
    tx.objectStore(STORE_PROFILES).clear(),
    tx.objectStore(STORE_FRIENDS).clear(),
    tx.done,
  ]);
  debug("gossip-db", "cleared all data");
}

// ============================================================================
// friends
// ============================================================================

export async function putFriend(friend: any): Promise<void> {
  const d = await db();
  await d.put(STORE_FRIENDS, friend);
}

export async function getFriend(nodeId: string): Promise<any | undefined> {
  const d = await db();
  return d.get(STORE_FRIENDS, nodeId);
}

export async function getAllFriends(): Promise<any[]> {
  const d = await db();
  return d.getAll(STORE_FRIENDS);
}

export async function deleteFriend(nodeId: string): Promise<void> {
  const d = await db();
  await d.delete(STORE_FRIENDS, nodeId);
}
