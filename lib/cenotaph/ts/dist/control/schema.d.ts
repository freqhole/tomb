import { z } from "zod";
declare const MediaRefSchema: z.ZodObject<{
    source_peer_addr: z.ZodString;
    blake3_hash: z.ZodString;
    size_bytes: z.ZodOptional<z.ZodNumber>;
    duration_ms: z.ZodOptional<z.ZodNumber>;
    mime_type: z.ZodOptional<z.ZodString>;
    kind: z.ZodOptional<z.ZodEnum<{
        audio: "audio";
        video: "video";
    }>>;
    title: z.ZodOptional<z.ZodString>;
    artist: z.ZodOptional<z.ZodString>;
    artwork_thumb_url: z.ZodOptional<z.ZodString>;
    artwork_full_url: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type MediaRef = z.infer<typeof MediaRefSchema>;
export declare const PlayerCommandSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    type: z.ZodLiteral<"control">;
    command: z.ZodLiteral<"play">;
    item: z.ZodObject<{
        source_peer_addr: z.ZodString;
        blake3_hash: z.ZodString;
        size_bytes: z.ZodOptional<z.ZodNumber>;
        duration_ms: z.ZodOptional<z.ZodNumber>;
        mime_type: z.ZodOptional<z.ZodString>;
        kind: z.ZodOptional<z.ZodEnum<{
            audio: "audio";
            video: "video";
        }>>;
        title: z.ZodOptional<z.ZodString>;
        artist: z.ZodOptional<z.ZodString>;
        artwork_thumb_url: z.ZodOptional<z.ZodString>;
        artwork_full_url: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"control">;
    command: z.ZodLiteral<"replace_queue">;
    items: z.ZodArray<z.ZodObject<{
        source_peer_addr: z.ZodString;
        blake3_hash: z.ZodString;
        size_bytes: z.ZodOptional<z.ZodNumber>;
        duration_ms: z.ZodOptional<z.ZodNumber>;
        mime_type: z.ZodOptional<z.ZodString>;
        kind: z.ZodOptional<z.ZodEnum<{
            audio: "audio";
            video: "video";
        }>>;
        title: z.ZodOptional<z.ZodString>;
        artist: z.ZodOptional<z.ZodString>;
        artwork_thumb_url: z.ZodOptional<z.ZodString>;
        artwork_full_url: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"control">;
    command: z.ZodLiteral<"append_queue">;
    items: z.ZodArray<z.ZodObject<{
        source_peer_addr: z.ZodString;
        blake3_hash: z.ZodString;
        size_bytes: z.ZodOptional<z.ZodNumber>;
        duration_ms: z.ZodOptional<z.ZodNumber>;
        mime_type: z.ZodOptional<z.ZodString>;
        kind: z.ZodOptional<z.ZodEnum<{
            audio: "audio";
            video: "video";
        }>>;
        title: z.ZodOptional<z.ZodString>;
        artist: z.ZodOptional<z.ZodString>;
        artwork_thumb_url: z.ZodOptional<z.ZodString>;
        artwork_full_url: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"control">;
    command: z.ZodLiteral<"pause">;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"control">;
    command: z.ZodLiteral<"resume">;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"control">;
    command: z.ZodLiteral<"seek">;
    position_ms: z.ZodNumber;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"control">;
    command: z.ZodLiteral<"skip">;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"control">;
    command: z.ZodLiteral<"remove_from_queue">;
    index: z.ZodNumber;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"control">;
    command: z.ZodLiteral<"reorder_queue">;
    from_index: z.ZodNumber;
    to_index: z.ZodNumber;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"control">;
    command: z.ZodLiteral<"set_volume">;
    volume: z.ZodNumber;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"control">;
    command: z.ZodLiteral<"stop">;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"control">;
    command: z.ZodLiteral<"get_status">;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"control">;
    command: z.ZodLiteral<"set_auto_download_enabled">;
    enabled: z.ZodBoolean;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"control">;
    command: z.ZodLiteral<"tune_radio">;
    peer_addr: z.ZodString;
    station_id: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"control">;
    command: z.ZodLiteral<"stop_radio">;
}, z.core.$strip>], "command">;
export type PlayerCommand = z.infer<typeof PlayerCommandSchema>;
export declare const SubscribeRequestSchema: z.ZodObject<{
    type: z.ZodLiteral<"subscribe">;
}, z.core.$strip>;
export type SubscribeRequest = z.infer<typeof SubscribeRequestSchema>;
export declare const PlayerStatusSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    type: z.ZodLiteral<"status">;
    state: z.ZodLiteral<"now_playing">;
    item: z.ZodObject<{
        source_peer_addr: z.ZodString;
        blake3_hash: z.ZodString;
        size_bytes: z.ZodOptional<z.ZodNumber>;
        duration_ms: z.ZodOptional<z.ZodNumber>;
        mime_type: z.ZodOptional<z.ZodString>;
        kind: z.ZodOptional<z.ZodEnum<{
            audio: "audio";
            video: "video";
        }>>;
        title: z.ZodOptional<z.ZodString>;
        artist: z.ZodOptional<z.ZodString>;
        artwork_thumb_url: z.ZodOptional<z.ZodString>;
        artwork_full_url: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    position_ms: z.ZodNumber;
    server_time_ms: z.ZodNumber;
    queue: z.ZodArray<z.ZodObject<{
        source_peer_addr: z.ZodString;
        blake3_hash: z.ZodString;
        size_bytes: z.ZodOptional<z.ZodNumber>;
        duration_ms: z.ZodOptional<z.ZodNumber>;
        mime_type: z.ZodOptional<z.ZodString>;
        kind: z.ZodOptional<z.ZodEnum<{
            audio: "audio";
            video: "video";
        }>>;
        title: z.ZodOptional<z.ZodString>;
        artist: z.ZodOptional<z.ZodString>;
        artwork_thumb_url: z.ZodOptional<z.ZodString>;
        artwork_full_url: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    auto_download_enabled: z.ZodBoolean;
    volume: z.ZodNumber;
    recently_played: z.ZodArray<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"status">;
    state: z.ZodLiteral<"paused">;
    position_ms: z.ZodNumber;
    queue: z.ZodArray<z.ZodObject<{
        source_peer_addr: z.ZodString;
        blake3_hash: z.ZodString;
        size_bytes: z.ZodOptional<z.ZodNumber>;
        duration_ms: z.ZodOptional<z.ZodNumber>;
        mime_type: z.ZodOptional<z.ZodString>;
        kind: z.ZodOptional<z.ZodEnum<{
            audio: "audio";
            video: "video";
        }>>;
        title: z.ZodOptional<z.ZodString>;
        artist: z.ZodOptional<z.ZodString>;
        artwork_thumb_url: z.ZodOptional<z.ZodString>;
        artwork_full_url: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    auto_download_enabled: z.ZodBoolean;
    volume: z.ZodNumber;
    recently_played: z.ZodArray<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"status">;
    state: z.ZodLiteral<"buffering">;
    queue: z.ZodArray<z.ZodObject<{
        source_peer_addr: z.ZodString;
        blake3_hash: z.ZodString;
        size_bytes: z.ZodOptional<z.ZodNumber>;
        duration_ms: z.ZodOptional<z.ZodNumber>;
        mime_type: z.ZodOptional<z.ZodString>;
        kind: z.ZodOptional<z.ZodEnum<{
            audio: "audio";
            video: "video";
        }>>;
        title: z.ZodOptional<z.ZodString>;
        artist: z.ZodOptional<z.ZodString>;
        artwork_thumb_url: z.ZodOptional<z.ZodString>;
        artwork_full_url: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    auto_download_enabled: z.ZodBoolean;
    volume: z.ZodNumber;
    recently_played: z.ZodArray<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"status">;
    state: z.ZodLiteral<"stopped">;
    queue: z.ZodArray<z.ZodObject<{
        source_peer_addr: z.ZodString;
        blake3_hash: z.ZodString;
        size_bytes: z.ZodOptional<z.ZodNumber>;
        duration_ms: z.ZodOptional<z.ZodNumber>;
        mime_type: z.ZodOptional<z.ZodString>;
        kind: z.ZodOptional<z.ZodEnum<{
            audio: "audio";
            video: "video";
        }>>;
        title: z.ZodOptional<z.ZodString>;
        artist: z.ZodOptional<z.ZodString>;
        artwork_thumb_url: z.ZodOptional<z.ZodString>;
        artwork_full_url: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    auto_download_enabled: z.ZodBoolean;
    volume: z.ZodNumber;
    recently_played: z.ZodArray<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"status">;
    state: z.ZodLiteral<"error">;
    message: z.ZodString;
    queue: z.ZodArray<z.ZodObject<{
        source_peer_addr: z.ZodString;
        blake3_hash: z.ZodString;
        size_bytes: z.ZodOptional<z.ZodNumber>;
        duration_ms: z.ZodOptional<z.ZodNumber>;
        mime_type: z.ZodOptional<z.ZodString>;
        kind: z.ZodOptional<z.ZodEnum<{
            audio: "audio";
            video: "video";
        }>>;
        title: z.ZodOptional<z.ZodString>;
        artist: z.ZodOptional<z.ZodString>;
        artwork_thumb_url: z.ZodOptional<z.ZodString>;
        artwork_full_url: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    auto_download_enabled: z.ZodBoolean;
    volume: z.ZodNumber;
    recently_played: z.ZodArray<z.ZodString>;
}, z.core.$strip>], "state">;
export type PlayerStatus = z.infer<typeof PlayerStatusSchema>;
export declare const CommandAckSchema: z.ZodObject<{
    type: z.ZodLiteral<"command_ack">;
    ok: z.ZodBoolean;
    reason: z.ZodOptional<z.ZodEnum<{
        untrusted: "untrusted";
        invalid_command: "invalid_command";
    }>>;
    status: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
        type: z.ZodLiteral<"status">;
        state: z.ZodLiteral<"now_playing">;
        item: z.ZodObject<{
            source_peer_addr: z.ZodString;
            blake3_hash: z.ZodString;
            size_bytes: z.ZodOptional<z.ZodNumber>;
            duration_ms: z.ZodOptional<z.ZodNumber>;
            mime_type: z.ZodOptional<z.ZodString>;
            kind: z.ZodOptional<z.ZodEnum<{
                audio: "audio";
                video: "video";
            }>>;
            title: z.ZodOptional<z.ZodString>;
            artist: z.ZodOptional<z.ZodString>;
            artwork_thumb_url: z.ZodOptional<z.ZodString>;
            artwork_full_url: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>;
        position_ms: z.ZodNumber;
        server_time_ms: z.ZodNumber;
        queue: z.ZodArray<z.ZodObject<{
            source_peer_addr: z.ZodString;
            blake3_hash: z.ZodString;
            size_bytes: z.ZodOptional<z.ZodNumber>;
            duration_ms: z.ZodOptional<z.ZodNumber>;
            mime_type: z.ZodOptional<z.ZodString>;
            kind: z.ZodOptional<z.ZodEnum<{
                audio: "audio";
                video: "video";
            }>>;
            title: z.ZodOptional<z.ZodString>;
            artist: z.ZodOptional<z.ZodString>;
            artwork_thumb_url: z.ZodOptional<z.ZodString>;
            artwork_full_url: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        auto_download_enabled: z.ZodBoolean;
        volume: z.ZodNumber;
        recently_played: z.ZodArray<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"status">;
        state: z.ZodLiteral<"paused">;
        position_ms: z.ZodNumber;
        queue: z.ZodArray<z.ZodObject<{
            source_peer_addr: z.ZodString;
            blake3_hash: z.ZodString;
            size_bytes: z.ZodOptional<z.ZodNumber>;
            duration_ms: z.ZodOptional<z.ZodNumber>;
            mime_type: z.ZodOptional<z.ZodString>;
            kind: z.ZodOptional<z.ZodEnum<{
                audio: "audio";
                video: "video";
            }>>;
            title: z.ZodOptional<z.ZodString>;
            artist: z.ZodOptional<z.ZodString>;
            artwork_thumb_url: z.ZodOptional<z.ZodString>;
            artwork_full_url: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        auto_download_enabled: z.ZodBoolean;
        volume: z.ZodNumber;
        recently_played: z.ZodArray<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"status">;
        state: z.ZodLiteral<"buffering">;
        queue: z.ZodArray<z.ZodObject<{
            source_peer_addr: z.ZodString;
            blake3_hash: z.ZodString;
            size_bytes: z.ZodOptional<z.ZodNumber>;
            duration_ms: z.ZodOptional<z.ZodNumber>;
            mime_type: z.ZodOptional<z.ZodString>;
            kind: z.ZodOptional<z.ZodEnum<{
                audio: "audio";
                video: "video";
            }>>;
            title: z.ZodOptional<z.ZodString>;
            artist: z.ZodOptional<z.ZodString>;
            artwork_thumb_url: z.ZodOptional<z.ZodString>;
            artwork_full_url: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        auto_download_enabled: z.ZodBoolean;
        volume: z.ZodNumber;
        recently_played: z.ZodArray<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"status">;
        state: z.ZodLiteral<"stopped">;
        queue: z.ZodArray<z.ZodObject<{
            source_peer_addr: z.ZodString;
            blake3_hash: z.ZodString;
            size_bytes: z.ZodOptional<z.ZodNumber>;
            duration_ms: z.ZodOptional<z.ZodNumber>;
            mime_type: z.ZodOptional<z.ZodString>;
            kind: z.ZodOptional<z.ZodEnum<{
                audio: "audio";
                video: "video";
            }>>;
            title: z.ZodOptional<z.ZodString>;
            artist: z.ZodOptional<z.ZodString>;
            artwork_thumb_url: z.ZodOptional<z.ZodString>;
            artwork_full_url: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        auto_download_enabled: z.ZodBoolean;
        volume: z.ZodNumber;
        recently_played: z.ZodArray<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"status">;
        state: z.ZodLiteral<"error">;
        message: z.ZodString;
        queue: z.ZodArray<z.ZodObject<{
            source_peer_addr: z.ZodString;
            blake3_hash: z.ZodString;
            size_bytes: z.ZodOptional<z.ZodNumber>;
            duration_ms: z.ZodOptional<z.ZodNumber>;
            mime_type: z.ZodOptional<z.ZodString>;
            kind: z.ZodOptional<z.ZodEnum<{
                audio: "audio";
                video: "video";
            }>>;
            title: z.ZodOptional<z.ZodString>;
            artist: z.ZodOptional<z.ZodString>;
            artwork_thumb_url: z.ZodOptional<z.ZodString>;
            artwork_full_url: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        auto_download_enabled: z.ZodBoolean;
        volume: z.ZodNumber;
        recently_played: z.ZodArray<z.ZodString>;
    }, z.core.$strip>], "state">>;
}, z.core.$strip>;
export type CommandAck = z.infer<typeof CommandAckSchema>;
export {};
//# sourceMappingURL=schema.d.ts.map