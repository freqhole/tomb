-- gossip channels: peer-to-peer music sharing conversations via iroh-gossip

-- channels this node participates in
CREATE TABLE gossip_channelz (
    topic_id TEXT PRIMARY KEY,           -- hex-encoded TopicId (64 chars)
    name TEXT NOT NULL,
    description TEXT,
    creator_node_id TEXT NOT NULL,
    music_only INTEGER NOT NULL DEFAULT 1, -- 1 = music shares only, 0 = text + music
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    settings TEXT,                       -- JSON: future settings
    last_message_at INTEGER,
    destroyed_at INTEGER                 -- set when creator broadcasts ChannelDestroyed (tombstone)
);

-- channel membership
CREATE TABLE gossip_channel_memberz (
    topic_id TEXT NOT NULL REFERENCES gossip_channelz(topic_id) ON DELETE CASCADE,
    node_id TEXT NOT NULL,
    display_name TEXT,
    role TEXT NOT NULL DEFAULT 'member', -- 'creator', 'member'
    joined_at INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (topic_id, node_id)
);

-- message history
CREATE TABLE gossip_messagez (
    message_id TEXT PRIMARY KEY,
    topic_id TEXT NOT NULL REFERENCES gossip_channelz(topic_id) ON DELETE CASCADE,
    sender_node_id TEXT NOT NULL,
    sender_name TEXT,
    msg_type TEXT NOT NULL,
    payload TEXT NOT NULL,               -- JSON
    timestamp INTEGER NOT NULL,
    received_at INTEGER NOT NULL DEFAULT (unixepoch()),
    deleted_at INTEGER                   -- set when MessageDeleted received
);

CREATE INDEX idx_gossip_messagez_topic_ts ON gossip_messagez(topic_id, timestamp);
CREATE INDEX idx_gossip_messagez_topic_received ON gossip_messagez(topic_id, received_at);

-- reactions
CREATE TABLE gossip_reactionz (
    message_id TEXT PRIMARY KEY,         -- the reaction message's own ID
    topic_id TEXT NOT NULL REFERENCES gossip_channelz(topic_id) ON DELETE CASCADE,
    target_message_id TEXT NOT NULL REFERENCES gossip_messagez(message_id) ON DELETE CASCADE,
    sender_node_id TEXT NOT NULL,
    sender_name TEXT,
    emoji TEXT NOT NULL,
    timestamp INTEGER NOT NULL
);

CREATE INDEX idx_gossip_reactionz_target ON gossip_reactionz(target_message_id);

-- knock requests for gossip channels
CREATE TABLE gossip_knock_requestz (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    topic_id TEXT NOT NULL REFERENCES gossip_channelz(topic_id) ON DELETE CASCADE,
    node_id TEXT NOT NULL,
    display_name TEXT,
    message TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    processed_at INTEGER,
    UNIQUE(topic_id, node_id)
);

-- gossip profiles: display name + avatar for any node_id seen in gossip
-- populated from gossip messages and profile update broadcasts
CREATE TABLE gossip_profilez (
    node_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    avatar_blob TEXT,                    -- base64-encoded small WebP (~5-10KB)
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
