// mock data for gossip channel stories
// characters from Nancy (the comic strip):
//   nancy (main character), sluggo (nancy's friend), fritzi (aunt),
//   rollo (rich kid), butch (rough kid), irma (nancy's best friend),
//   oona goosepimple (eerie girl), phil fumble (clumsy guy)

// --- gossip types (mirrors generated Zod types from grimoire) ---

export interface MusicReference {
    ref_type: "Song" | "Album" | "Artist" | "Playlist" | "Genre";
    remote_id: string;
    source_node_id: string;
    /** display name of the remote this music comes from */
    source_name?: string;
    // song fields
    title?: string;
    track_artist?: string;
    album_title?: string;
    duration?: number;
    track_number?: number;
    disc_number?: number;
    // album fields
    artist_name?: string;
    album_type?: string;
    release_date?: string;
    song_count?: number;
    total_duration?: number;
    genres?: string[];
    // artist fields
    name?: string;
    bio?: string;
    // playlist fields
    description?: string;
    // shared
    thumbnails: string[];
    thumbnail_url?: string;
}

export interface GossipReaction {
    message_id: string;
    topic_id: string;
    target_message_id: string;
    sender_node_id: string;
    sender_name: string | null;
    emoji: string;
    timestamp: number;
}

export interface GossipMessage {
    message_id: string;
    topic_id: string;
    sender_node_id: string;
    sender_name: string | null;
    sender_avatar_url?: string | null;
    msg_type: string;
    payload: string;
    timestamp: number;
    received_at: number;
    deleted_at: number | null;
    // enriched by service layer
    reactions?: GossipReaction[];
}

export interface GossipChannel {
    topic_id: string;
    name: string;
    description: string | null;
    creator_node_id: string;
    settings: string | null;
    /** whether text messages are allowed (default true) — if false, only music shares */
    allow_text?: boolean;
    created_at: number;
    last_message_at: number | null;
}

export interface GossipChannelMember {
    topic_id: string;
    node_id: string;
    display_name: string;
    role: string;
    joined_at: number;
}

export interface GossipFriend {
    node_id: string;
    display_name: string;
    avatar_url?: string | null;
    /** unix timestamp of last seen, null if never */
    last_seen: number | null;
    /** whether currently online */
    online: boolean;
}

// --- mock identities ---

/** 50x50 placeholder avatar URLs keyed by character name */
export const mockAvatars: Record<string, string> = {
    nancy: "https://api.dicebear.com/9.x/thumbs/svg?seed=nancy&size=50",
    sluggo: "https://api.dicebear.com/9.x/thumbs/svg?seed=sluggo&size=50",
    fritzi: "https://api.dicebear.com/9.x/thumbs/svg?seed=fritzi&size=50",
    rollo: "https://api.dicebear.com/9.x/thumbs/svg?seed=rollo&size=50",
    butch: "https://api.dicebear.com/9.x/thumbs/svg?seed=butch&size=50",
    irma: "https://api.dicebear.com/9.x/thumbs/svg?seed=irma&size=50",
    oona: "https://api.dicebear.com/9.x/thumbs/svg?seed=oona&size=50",
    phil: "https://api.dicebear.com/9.x/thumbs/svg?seed=phil&size=50",
};

/** resolve avatar url from a sender name (mock helper) */
export function avatarForName(name: string | null): string | null {
    return name ? mockAvatars[name] ?? null : null;
}

export const mockNodeIds = {
    nancy: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
    sluggo: "b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b200",
    fritzi: "c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b20000",
    rollo: "d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2000000",
    butch: "e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d40000",
    irma: "f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e50000",
    oona: "a1a2a3a4a5a6a7a8a9a0b1b2b3b4b5b6b7b8b9b0c1c2c3c4c5c6c7c8c9c0d1d2",
    phil: "d1d2d3d4d5d6d7d8d9d0e1e2e3e4e5e6e7e8e9e0f1f2f3f4f5f6f7f8f9f0a1a2",
};

/** map node ID to display name (for resolving source_node_id -> source_name) */
export const nodeNames: Record<string, string> = {
    [mockNodeIds.nancy]: "nancy's library",
    [mockNodeIds.sluggo]: "sluggo's stash",
    [mockNodeIds.fritzi]: "fritzi's collection",
    [mockNodeIds.rollo]: "rollo's vault",
    [mockNodeIds.butch]: "butch's boombox",
    [mockNodeIds.irma]: "irma's archives",
    [mockNodeIds.oona]: "oona's crypt",
    [mockNodeIds.phil]: "phil's pile",
};

// --- mock channels ---

const now = Math.floor(Date.now() / 1000);

export const mockChannels: GossipChannel[] = [
    {
        topic_id: "aabb00112233445566778899aabbccddeeff00112233445566778899aabbccdd",
        name: "jazzy stuff",
        description: "sharing jazz, neo-soul, and anything with a good groove",
        creator_node_id: mockNodeIds.nancy,
        settings: null,
        allow_text: false,
        created_at: now - 86400 * 7,
        last_message_at: now - 120,
    },
    {
        topic_id: "1122334455667788990011223344556677889900112233445566778899001122",
        name: "prog cave",
        description: "progressive rock, art rock, and things that go on for 20 minutes",
        creator_node_id: mockNodeIds.rollo,
        settings: null,
        created_at: now - 86400 * 30,
        last_message_at: now - 3600,
    },
    {
        topic_id: "ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100",
        name: "electronic discoveries",
        description: null,
        creator_node_id: mockNodeIds.fritzi,
        settings: null,
        created_at: now - 86400 * 3,
        last_message_at: now - 7200,
    },
    {
        topic_id: "0000111122223333444455556666777788889999aaaabbbbccccddddeeeeffff",
        name: "the endless stream",
        description: "infinite music recs — keep scrolling, there's always more",
        creator_node_id: mockNodeIds.butch,
        settings: null,
        created_at: now - 86400 * 60,
        last_message_at: now - 10,
    },
];

// --- mock members ---

export const mockMembers: Record<string, GossipChannelMember[]> = {
    [mockChannels[0].topic_id]: [
        { topic_id: mockChannels[0].topic_id, node_id: mockNodeIds.nancy, display_name: "nancy", role: "creator", joined_at: now - 86400 * 7 },
        { topic_id: mockChannels[0].topic_id, node_id: mockNodeIds.sluggo, display_name: "sluggo", role: "member", joined_at: now - 86400 * 6 },
        { topic_id: mockChannels[0].topic_id, node_id: mockNodeIds.fritzi, display_name: "fritzi", role: "member", joined_at: now - 86400 * 5 },
        { topic_id: mockChannels[0].topic_id, node_id: mockNodeIds.rollo, display_name: "rollo", role: "member", joined_at: now - 86400 * 4 },
    ],
    [mockChannels[1].topic_id]: [
        { topic_id: mockChannels[1].topic_id, node_id: mockNodeIds.rollo, display_name: "rollo", role: "creator", joined_at: now - 86400 * 30 },
        { topic_id: mockChannels[1].topic_id, node_id: mockNodeIds.nancy, display_name: "nancy", role: "member", joined_at: now - 86400 * 28 },
        { topic_id: mockChannels[1].topic_id, node_id: mockNodeIds.butch, display_name: "butch", role: "member", joined_at: now - 86400 * 20 },
    ],
    [mockChannels[2].topic_id]: [
        { topic_id: mockChannels[2].topic_id, node_id: mockNodeIds.fritzi, display_name: "fritzi", role: "creator", joined_at: now - 86400 * 3 },
        { topic_id: mockChannels[2].topic_id, node_id: mockNodeIds.sluggo, display_name: "sluggo", role: "member", joined_at: now - 86400 * 2 },
        { topic_id: mockChannels[2].topic_id, node_id: mockNodeIds.rollo, display_name: "rollo", role: "member", joined_at: now - 86400 * 1 },
    ],
    [mockChannels[3].topic_id]: [
        { topic_id: mockChannels[3].topic_id, node_id: mockNodeIds.butch, display_name: "butch", role: "creator", joined_at: now - 86400 * 60 },
        { topic_id: mockChannels[3].topic_id, node_id: mockNodeIds.nancy, display_name: "nancy", role: "member", joined_at: now - 86400 * 58 },
        { topic_id: mockChannels[3].topic_id, node_id: mockNodeIds.sluggo, display_name: "sluggo", role: "member", joined_at: now - 86400 * 55 },
        { topic_id: mockChannels[3].topic_id, node_id: mockNodeIds.fritzi, display_name: "fritzi", role: "member", joined_at: now - 86400 * 50 },
        { topic_id: mockChannels[3].topic_id, node_id: mockNodeIds.rollo, display_name: "rollo", role: "member", joined_at: now - 86400 * 45 },
    ],
};

// --- mock friends ---

export const mockFriends: GossipFriend[] = [
    { node_id: mockNodeIds.nancy, display_name: "nancy", avatar_url: mockAvatars.nancy, last_seen: now, online: true },
    { node_id: mockNodeIds.sluggo, display_name: "sluggo", avatar_url: mockAvatars.sluggo, last_seen: now - 30, online: true },
    { node_id: mockNodeIds.fritzi, display_name: "fritzi", avatar_url: mockAvatars.fritzi, last_seen: now - 120, online: true },
    { node_id: mockNodeIds.irma, display_name: "irma", avatar_url: mockAvatars.irma, last_seen: now - 600, online: true },
    { node_id: mockNodeIds.rollo, display_name: "rollo", avatar_url: mockAvatars.rollo, last_seen: now - 86400 * 2, online: false },
    { node_id: mockNodeIds.butch, display_name: "butch", avatar_url: mockAvatars.butch, last_seen: now - 3600, online: false },
    { node_id: mockNodeIds.oona, display_name: "oona goosepimple", avatar_url: mockAvatars.oona, last_seen: now - 86400 * 5, online: false },
    { node_id: mockNodeIds.phil, display_name: "phil fumble", avatar_url: mockAvatars.phil, last_seen: null, online: false },
];

// --- mock music references ---

export const mockSongRef: MusicReference = {
    ref_type: "Song",
    remote_id: "song-001",
    source_node_id: mockNodeIds.nancy,
    source_name: "nancy's library",
    title: "so what",
    track_artist: "miles davis",
    album_title: "kind of blue",
    duration: 561,
    track_number: 1,
    disc_number: 1,
    thumbnails: [],
    thumbnail_url: "https://picsum.photos/seed/kindofblue/200/200",
};

export const mockAlbumRef: MusicReference = {
    ref_type: "Album",
    remote_id: "album-001",
    source_node_id: mockNodeIds.rollo,
    source_name: "rollo's vault",
    title: "in the court of the crimson king",
    artist_name: "king crimson",
    album_type: "studio",
    release_date: "1969-10-10",
    song_count: 5,
    total_duration: 2634,
    genres: ["progressive rock", "art rock"],
    thumbnails: [],
    thumbnail_url: "https://picsum.photos/seed/crimsonking/200/200",
};

export const mockArtistRef: MusicReference = {
    ref_type: "Artist",
    remote_id: "artist-001",
    source_node_id: mockNodeIds.fritzi,
    source_name: "fritzi's collection",
    name: "boards of canada",
    bio: "scottish electronic music duo",
    thumbnails: [],
    thumbnail_url: "https://picsum.photos/seed/boardsofcanada/200/200",
};

export const mockPlaylistRef: MusicReference = {
    ref_type: "Playlist",
    remote_id: "playlist-001",
    source_node_id: mockNodeIds.nancy,
    source_name: "nancy's library",
    title: "late night jazz",
    description: "mellow jazz for winding down",
    song_count: 24,
    duration: 5400,
    thumbnails: [],
    thumbnail_url: "https://picsum.photos/seed/latenightjazz/200/200",
};

export const mockGenreRef: MusicReference = {
    ref_type: "Genre",
    remote_id: "genre-001",
    source_node_id: mockNodeIds.sluggo,
    source_name: "sluggo's stash",
    name: "shoegaze",
    thumbnails: [],
};

// extra refs for richer conversations
const comfortablyNumbRef: MusicReference = {
    ref_type: "Song",
    remote_id: "song-002",
    source_node_id: mockNodeIds.rollo,
    source_name: "rollo's vault",
    title: "comfortably numb",
    track_artist: "pink floyd",
    album_title: "the wall",
    duration: 382,
    track_number: 6,
    disc_number: 2,
    thumbnails: [],
    thumbnail_url: "https://picsum.photos/seed/thewall/200/200",
};

const darkSideRef: MusicReference = {
    ref_type: "Album",
    remote_id: "album-002",
    source_node_id: mockNodeIds.nancy,
    source_name: "nancy's library",
    title: "the dark side of the moon",
    artist_name: "pink floyd",
    album_type: "studio",
    release_date: "1973-03-01",
    song_count: 10,
    total_duration: 2580,
    genres: ["progressive rock", "psychedelic rock"],
    thumbnails: [],
    thumbnail_url: "https://picsum.photos/seed/darkside/200/200",
};

const okComputerRef: MusicReference = {
    ref_type: "Album",
    remote_id: "album-003",
    source_node_id: mockNodeIds.fritzi,
    source_name: "fritzi's collection",
    title: "ok computer",
    artist_name: "radiohead",
    album_type: "studio",
    release_date: "1997-06-16",
    song_count: 12,
    total_duration: 3182,
    genres: ["alternative rock", "art rock"],
    thumbnails: [],
    thumbnail_url: "https://picsum.photos/seed/okcomputer/200/200",
};

const discoveryRef: MusicReference = {
    ref_type: "Album",
    remote_id: "album-009",
    source_node_id: mockNodeIds.sluggo,
    source_name: "sluggo's stash",
    title: "discovery",
    artist_name: "daft punk",
    album_type: "studio",
    release_date: "2001-03-12",
    song_count: 14,
    total_duration: 3612,
    genres: ["electronic", "house", "french house"],
    thumbnails: [],
    thumbnail_url: "https://picsum.photos/seed/discovery/200/200",
};

const aphexTwinRef: MusicReference = {
    ref_type: "Artist",
    remote_id: "artist-002",
    source_node_id: mockNodeIds.fritzi,
    source_name: "fritzi's collection",
    name: "aphex twin",
    bio: "prolific electronic musician and producer",
    thumbnails: [],
    thumbnail_url: "https://picsum.photos/seed/aphextwin/200/200",
};

const nevermindRef: MusicReference = {
    ref_type: "Album",
    remote_id: "album-008",
    source_node_id: mockNodeIds.butch,
    source_name: "butch's boombox",
    title: "nevermind",
    artist_name: "nirvana",
    album_type: "studio",
    release_date: "1991-09-24",
    song_count: 12,
    total_duration: 2891,
    genres: ["grunge", "alternative rock"],
    thumbnails: [],
    thumbnail_url: "https://picsum.photos/seed/nevermind/200/200",
};

// --- mock messages ---

function makePayload(text: string | null, items: MusicReference[]): string {
    return JSON.stringify({ text, items });
}

// -- jazzy stuff channel messages --
export const mockJazzyMessages: GossipMessage[] = [
    {
        message_id: "msg-001",
        topic_id: mockChannels[0].topic_id,
        sender_node_id: mockNodeIds.nancy,
        sender_name: "nancy",
        msg_type: "MusicShare",
        payload: makePayload(null, [mockSongRef]),
        timestamp: now - 7200,
        received_at: now - 7200,
        deleted_at: null,
        reactions: [
            { message_id: "react-001", topic_id: mockChannels[0].topic_id, target_message_id: "msg-001", sender_node_id: mockNodeIds.sluggo, sender_name: "sluggo", emoji: "\u{1F525}", timestamp: now - 7100 },
            { message_id: "react-002", topic_id: mockChannels[0].topic_id, target_message_id: "msg-001", sender_node_id: mockNodeIds.fritzi, sender_name: "fritzi", emoji: "\u{1F525}", timestamp: now - 7000 },
            { message_id: "react-003", topic_id: mockChannels[0].topic_id, target_message_id: "msg-001", sender_node_id: mockNodeIds.fritzi, sender_name: "fritzi", emoji: "\u{1F49C}", timestamp: now - 6900 },
        ],
    },
    {
        message_id: "msg-002",
        topic_id: mockChannels[0].topic_id,
        sender_node_id: mockNodeIds.sluggo,
        sender_name: "sluggo",
        msg_type: "MusicShare",
        payload: makePayload(null, [mockAlbumRef]),
        timestamp: now - 5400,
        received_at: now - 5400,
        deleted_at: null,
        reactions: [
            { message_id: "react-004", topic_id: mockChannels[0].topic_id, target_message_id: "msg-002", sender_node_id: mockNodeIds.nancy, sender_name: "nancy", emoji: "\u{1F440}", timestamp: now - 5300 },
        ],
    },
    {
        message_id: "msg-003",
        topic_id: mockChannels[0].topic_id,
        sender_node_id: mockNodeIds.fritzi,
        sender_name: "fritzi",
        msg_type: "MusicShare",
        payload: makePayload(null, [mockArtistRef]),
        timestamp: now - 3600,
        received_at: now - 3600,
        deleted_at: null,
        reactions: [],
    },
    {
        message_id: "msg-deleted-jazz",
        topic_id: mockChannels[0].topic_id,
        sender_node_id: mockNodeIds.rollo,
        sender_name: "rollo",
        msg_type: "MusicShare",
        payload: "{}",
        timestamp: now - 2700,
        received_at: now - 2700,
        deleted_at: now - 2600,
        reactions: [],
    },
    {
        message_id: "msg-004",
        topic_id: mockChannels[0].topic_id,
        sender_node_id: mockNodeIds.rollo,
        sender_name: "rollo",
        msg_type: "MusicShare",
        payload: makePayload(null, [mockPlaylistRef]),
        timestamp: now - 2400,
        received_at: now - 2400,
        deleted_at: null,
        reactions: [],
    },
    {
        message_id: "msg-005",
        topic_id: mockChannels[0].topic_id,
        sender_node_id: mockNodeIds.nancy,
        sender_name: "nancy",
        msg_type: "MusicShare",
        payload: makePayload(null, [mockPlaylistRef, mockSongRef]),
        timestamp: now - 1800,
        received_at: now - 1800,
        deleted_at: null,
        reactions: [],
    },
    {
        message_id: "msg-006",
        topic_id: mockChannels[0].topic_id,
        sender_node_id: mockNodeIds.sluggo,
        sender_name: "sluggo",
        msg_type: "MusicShare",
        payload: makePayload(null, [mockGenreRef]),
        timestamp: now - 600,
        received_at: now - 600,
        deleted_at: null,
        reactions: [],
    },
    {
        message_id: "msg-007",
        topic_id: mockChannels[0].topic_id,
        sender_node_id: mockNodeIds.fritzi,
        sender_name: "fritzi",
        msg_type: "MusicShare",
        payload: makePayload(null, [{
            ref_type: "Artist",
            remote_id: "artist-003",
            source_node_id: mockNodeIds.fritzi,
            name: "yussef dayes",
            bio: "british drummer, composer and producer blending jazz, broken beat and electronic music",
            thumbnails: [],
            thumbnail_url: "https://picsum.photos/seed/yussefdays/200/200",
            source_name: "fritzi's collection",
        }]),
        timestamp: now - 300,
        received_at: now - 300,
        deleted_at: null,
        reactions: [
            { message_id: "react-005", topic_id: mockChannels[0].topic_id, target_message_id: "msg-007", sender_node_id: mockNodeIds.nancy, sender_name: "nancy", emoji: "\u{1F64C}", timestamp: now - 250 },
        ],
    },
    {
        message_id: "msg-008",
        topic_id: mockChannels[0].topic_id,
        sender_node_id: mockNodeIds.nancy,
        sender_name: "nancy",
        msg_type: "MusicShare",
        payload: makePayload(null, [{
            ref_type: "Artist",
            remote_id: "artist-004",
            source_node_id: mockNodeIds.nancy,
            name: "ezra collective",
            bio: "london-based five-piece jazz group blending afrobeat, reggae and hip-hop",
            thumbnails: [],
            thumbnail_url: "https://picsum.photos/seed/ezracollective/200/200",
            source_name: "nancy's library",
        }]),
        timestamp: now - 120,
        received_at: now - 120,
        deleted_at: null,
        reactions: [],
    },
];

// -- prog cave channel messages --
export const mockProgMessages: GossipMessage[] = [
    {
        message_id: "msg-prog-001",
        topic_id: mockChannels[1].topic_id,
        sender_node_id: mockNodeIds.rollo,
        sender_name: "rollo",
        msg_type: "MusicShare",
        payload: makePayload("ok hear me out \u2014 dark side of the moon played backwards syncs up with the wizard of oz", [darkSideRef]),
        timestamp: now - 86400 * 2,
        received_at: now - 86400 * 2,
        deleted_at: null,
        reactions: [
            { message_id: "react-prog-001", topic_id: mockChannels[1].topic_id, target_message_id: "msg-prog-001", sender_node_id: mockNodeIds.nancy, sender_name: "nancy", emoji: "\u{1F92F}", timestamp: now - 86400 * 2 + 300 },
            { message_id: "react-prog-002", topic_id: mockChannels[1].topic_id, target_message_id: "msg-prog-001", sender_node_id: mockNodeIds.butch, sender_name: "butch", emoji: "\u{1F480}", timestamp: now - 86400 * 2 + 600 },
        ],
    },
    {
        message_id: "msg-prog-002",
        topic_id: mockChannels[1].topic_id,
        sender_node_id: mockNodeIds.nancy,
        sender_name: "nancy",
        msg_type: "MusicShare",
        payload: makePayload("rollo please. anyway here's the real classic", [comfortablyNumbRef]),
        timestamp: now - 86400 * 2 + 900,
        received_at: now - 86400 * 2 + 900,
        deleted_at: null,
        reactions: [],
    },
    {
        message_id: "msg-prog-003",
        topic_id: mockChannels[1].topic_id,
        sender_node_id: mockNodeIds.butch,
        sender_name: "butch",
        msg_type: "MusicShare",
        payload: makePayload("prog is cool but have you considered just listening to three chords really loud", [nevermindRef]),
        timestamp: now - 86400,
        received_at: now - 86400,
        deleted_at: null,
        reactions: [
            { message_id: "react-prog-003", topic_id: mockChannels[1].topic_id, target_message_id: "msg-prog-003", sender_node_id: mockNodeIds.rollo, sender_name: "rollo", emoji: "\u{1F612}", timestamp: now - 86400 + 120 },
        ],
    },
    {
        message_id: "msg-prog-004",
        topic_id: mockChannels[1].topic_id,
        sender_node_id: mockNodeIds.rollo,
        sender_name: "rollo",
        msg_type: "MusicShare",
        payload: makePayload("butch you absolute philistine. here, educate yourself", [mockAlbumRef]),
        timestamp: now - 86400 + 300,
        received_at: now - 86400 + 300,
        deleted_at: null,
        reactions: [],
    },
    {
        message_id: "msg-prog-005",
        topic_id: mockChannels[1].topic_id,
        sender_node_id: mockNodeIds.nancy,
        sender_name: "nancy",
        msg_type: "MusicShare",
        payload: makePayload("ok computer is basically prog right? radiohead went full art-rock on that one", [okComputerRef]),
        timestamp: now - 43200,
        received_at: now - 43200,
        deleted_at: null,
        reactions: [
            { message_id: "react-prog-004", topic_id: mockChannels[1].topic_id, target_message_id: "msg-prog-005", sender_node_id: mockNodeIds.rollo, sender_name: "rollo", emoji: "\u{1F525}", timestamp: now - 43000 },
            { message_id: "react-prog-005", topic_id: mockChannels[1].topic_id, target_message_id: "msg-prog-005", sender_node_id: mockNodeIds.butch, sender_name: "butch", emoji: "\u{1F44F}", timestamp: now - 42800 },
        ],
    },
    {
        message_id: "msg-prog-006",
        topic_id: mockChannels[1].topic_id,
        sender_node_id: mockNodeIds.butch,
        sender_name: "butch",
        msg_type: "MusicShare",
        payload: makePayload("ok fine that one IS good", []),
        timestamp: now - 42000,
        received_at: now - 42000,
        deleted_at: null,
        reactions: [],
    },
    {
        message_id: "msg-prog-007",
        topic_id: mockChannels[1].topic_id,
        sender_node_id: mockNodeIds.rollo,
        sender_name: "rollo",
        msg_type: "MusicShare",
        payload: makePayload("character development from butch", []),
        timestamp: now - 3600,
        received_at: now - 3600,
        deleted_at: null,
        reactions: [
            { message_id: "react-prog-006", topic_id: mockChannels[1].topic_id, target_message_id: "msg-prog-007", sender_node_id: mockNodeIds.nancy, sender_name: "nancy", emoji: "\u{1F602}", timestamp: now - 3500 },
        ],
    },
];

// -- electronic discoveries channel messages --
export const mockElectronicMessages: GossipMessage[] = [
    {
        message_id: "msg-elec-001",
        topic_id: mockChannels[2].topic_id,
        sender_node_id: mockNodeIds.fritzi,
        sender_name: "fritzi",
        msg_type: "MusicShare",
        payload: makePayload("started this channel for all the electronic stuff we keep derailing the other channels with", []),
        timestamp: now - 86400 * 3,
        received_at: now - 86400 * 3,
        deleted_at: null,
        reactions: [],
    },
    {
        message_id: "msg-elec-002",
        topic_id: mockChannels[2].topic_id,
        sender_node_id: mockNodeIds.sluggo,
        sender_name: "sluggo",
        msg_type: "MusicShare",
        payload: makePayload("finally! ok first up, this absolutely slaps", [discoveryRef]),
        timestamp: now - 86400 * 3 + 600,
        received_at: now - 86400 * 3 + 600,
        deleted_at: null,
        reactions: [
            { message_id: "react-elec-001", topic_id: mockChannels[2].topic_id, target_message_id: "msg-elec-002", sender_node_id: mockNodeIds.fritzi, sender_name: "fritzi", emoji: "\u{1F525}", timestamp: now - 86400 * 3 + 700 },
        ],
    },
    {
        message_id: "msg-elec-003",
        topic_id: mockChannels[2].topic_id,
        sender_node_id: mockNodeIds.fritzi,
        sender_name: "fritzi",
        msg_type: "MusicShare",
        payload: makePayload("absolute legend. SAW 85-92 is still one of the best ambient records ever made", [aphexTwinRef]),
        timestamp: now - 86400 * 2,
        received_at: now - 86400 * 2,
        deleted_at: null,
        reactions: [],
    },
    {
        message_id: "msg-elec-004",
        topic_id: mockChannels[2].topic_id,
        sender_node_id: mockNodeIds.rollo,
        sender_name: "rollo",
        msg_type: "MusicShare",
        payload: makePayload("i usually listen to prog but the electronic stuff with complex time signatures gets me. autechre anyone?", []),
        timestamp: now - 86400,
        received_at: now - 86400,
        deleted_at: null,
        reactions: [
            { message_id: "react-elec-002", topic_id: mockChannels[2].topic_id, target_message_id: "msg-elec-004", sender_node_id: mockNodeIds.fritzi, sender_name: "fritzi", emoji: "\u{1F440}", timestamp: now - 86400 + 100 },
            { message_id: "react-elec-003", topic_id: mockChannels[2].topic_id, target_message_id: "msg-elec-004", sender_node_id: mockNodeIds.sluggo, sender_name: "sluggo", emoji: "\u{1F440}", timestamp: now - 86400 + 200 },
        ],
    },
    {
        message_id: "msg-elec-005",
        topic_id: mockChannels[2].topic_id,
        sender_node_id: mockNodeIds.sluggo,
        sender_name: "sluggo",
        msg_type: "MusicShare",
        payload: makePayload("autechre is elite. also check out clark and squarepusher if you haven't already", []),
        timestamp: now - 7200,
        received_at: now - 7200,
        deleted_at: null,
        reactions: [],
    },
];

// -- "the endless stream" channel: generates messages on demand --

/** music topics/quotes for the infinite generator */
const endlessTexts = [
    "this track has the best bassline i've heard all week",
    "does anyone else think this album is underrated",
    "just discovered this artist and i'm obsessed",
    "been on a deep dive into 70s krautrock. help",
    "the production on this is insane, listen with good headphones",
    "ok this song made me cry on the bus today. sharing for accountability",
    "hot take: this is their best album and i will die on this hill",
    null,
    "why did nobody tell me about this band sooner",
    "this playlist is my entire personality now",
    "the guitar tone on this track is perfection",
    null,
    "played this at a party and everyone asked what it was",
    "3am vibes only. don't listen to this during the day",
    "controversial opinion: the remix is better than the original",
    "this whole album is a masterpiece start to finish",
    null,
    "found this in a record store bargain bin and it changed my life",
    "the way the drums come in at 2:47 gives me chills every time",
    "adding this to every playlist i have",
    "this is what peak music sounds like, you may not like it",
    "can we talk about how good the b-sides are",
    null,
    "ok who recommended this because i haven't stopped listening",
    "putting this on while i clean the house. instant motivation",
    "the transition between tracks 3 and 4 is *chef's kiss*",
];

const endlessRefs: MusicReference[] = [
    mockSongRef, mockAlbumRef, mockArtistRef, comfortablyNumbRef, darkSideRef,
    okComputerRef, discoveryRef, aphexTwinRef, nevermindRef, mockPlaylistRef,
    mockGenreRef,
];

const endlessNames: { nodeId: string; name: string }[] = [
    { nodeId: mockNodeIds.nancy, name: "nancy" },
    { nodeId: mockNodeIds.sluggo, name: "sluggo" },
    { nodeId: mockNodeIds.fritzi, name: "fritzi" },
    { nodeId: mockNodeIds.rollo, name: "rollo" },
    { nodeId: mockNodeIds.butch, name: "butch" },
];

const endlessEmojis = ["\u{1F525}", "\u{1F49C}", "\u{1F440}", "\u{2728}", "\u{1F64C}", "\u{1F480}", "\u{1F92F}", "\u{1F44F}"];

/** deterministic pseudo-random from seed */
function seededRand(seed: number): number {
    const x = Math.sin(seed * 9301 + 49297) * 233280;
    return x - Math.floor(x);
}

/**
 * generate N messages for the endless stream channel.
 * messages are generated oldest-first (ascending timestamp).
 * page 0 = most recent, page 1 = older, etc.
 */
export function generateEndlessMessages(page: number, pageSize: number = 30): GossipMessage[] {
    const topicId = mockChannels[3].topic_id;
    const msgs: GossipMessage[] = [];

    for (let i = 0; i < pageSize; i++) {
        const globalIdx = page * pageSize + i;
        const r = seededRand(globalIdx);
        const r2 = seededRand(globalIdx + 10000);
        const r3 = seededRand(globalIdx + 20000);
        const r4 = seededRand(globalIdx + 30000);

        const sender = endlessNames[Math.floor(r * endlessNames.length)];
        const textEntry = endlessTexts[Math.floor(r2 * endlessTexts.length)];
        // ~60% of messages have an attachment
        const hasAttachment = r3 < 0.6;
        const ref = hasAttachment ? endlessRefs[Math.floor(r3 * endlessRefs.length)] : null;
        const items = ref ? [ref] : [];

        // older pages = further back in time
        const baseTs = now - (page * pageSize + (pageSize - i)) * 180; // ~3 min apart

        // some messages have reactions
        const reactions: GossipReaction[] = [];
        if (r4 > 0.5) {
            const reactorIdx = Math.floor(seededRand(globalIdx + 40000) * endlessNames.length);
            const reactor = endlessNames[reactorIdx];
            if (reactor.nodeId !== sender.nodeId) {
                reactions.push({
                    message_id: `react-endless-${globalIdx}`,
                    topic_id: topicId,
                    target_message_id: `msg-endless-${globalIdx}`,
                    sender_node_id: reactor.nodeId,
                    sender_name: reactor.name,
                    emoji: endlessEmojis[Math.floor(seededRand(globalIdx + 50000) * endlessEmojis.length)],
                    timestamp: baseTs + 60,
                });
            }
        }

        msgs.push({
            message_id: `msg-endless-${globalIdx}`,
            topic_id: topicId,
            sender_node_id: sender.nodeId,
            sender_name: sender.name,
            msg_type: "MusicShare",
            payload: makePayload(textEntry, items),
            timestamp: baseTs,
            received_at: baseTs,
            deleted_at: null,
            reactions,
        });
    }

    return msgs;
}

// legacy export — the "jazzy stuff" channel messages (used by individual story files)
export const mockMessages = mockJazzyMessages;

// all initial messages keyed by topic
export const mockMessagesByTopic: Record<string, GossipMessage[]> = {
    [mockChannels[0].topic_id]: mockJazzyMessages,
    [mockChannels[1].topic_id]: mockProgMessages,
    [mockChannels[2].topic_id]: mockElectronicMessages,
    [mockChannels[3].topic_id]: generateEndlessMessages(0),
};

// deleted message example
export const mockDeletedMessage: GossipMessage = {
    message_id: "msg-deleted",
    topic_id: mockChannels[0].topic_id,
    sender_node_id: mockNodeIds.sluggo,
    sender_name: "sluggo",
    msg_type: "MusicShare",
    payload: "{}",
    timestamp: now - 900,
    received_at: now - 900,
    deleted_at: now - 800,
    reactions: [],
};

// --- helpers ---

export function parsePayload(msg: GossipMessage): { text: string | null; items: MusicReference[] } {
    try {
        return JSON.parse(msg.payload);
    } catch {
        return { text: null, items: [] };
    }
}

export function formatTimestamp(ts: number): string {
    const date = new Date(ts * 1000);
    const today = new Date();
    const isToday = date.toDateString() === today.toDateString();
    if (isToday) {
        return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    return date.toLocaleDateString([], { month: "short", day: "numeric" }) + " " +
        date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function formatDuration(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
}

/** group reactions by emoji with sender names */
export function groupReactions(reactions: GossipReaction[]): { emoji: string; count: number; senders: string[] }[] {
    const map = new Map<string, string[]>();
    for (const r of reactions) {
        const existing = map.get(r.emoji) || [];
        existing.push(r.sender_name || "unknown");
        map.set(r.emoji, existing);
    }
    return Array.from(map.entries()).map(([emoji, senders]) => ({
        emoji,
        count: senders.length,
        senders,
    }));
}

/** common emoji reactions */
export const commonEmojis = ["🔥", "💜", "👀", "🎵", "✨", "🙌", "💀", "🤯", "👏", "🎶", "❤️", "😍"];
