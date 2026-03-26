//! gossip channel API handlers

use crate::api_registry::{Domain, Method, RouteAuth, RouteInfo};
use crate::error::ErrorDetail;
use crate::gossip::models::*;
use crate::gossip::protocol::*;
use crate::gossip::repository;
use crate::gossip::service::GossipService;
use crate::offal::caller::Caller;
use crate::offal::parse_body;
use crate::response::GrimoireResponse;
use serde_json::Value as JsonValue;

/// route metadata for gossip
pub const ROUTES: &[RouteInfo] = &[
    RouteInfo {
        name: "create_gossip_channel",
        path: "/api/gossip/channels",
        method: Method::POST,
        domain: Domain::Gossip,
        request_type: "CreateChannelRequest",
        response_type: "GossipChannel",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "list_gossip_channels",
        path: "/api/gossip/channels/list",
        method: Method::POST,
        domain: Domain::Gossip,
        request_type: "EmptyRequest",
        response_type: "Vec<GossipChannel>",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "get_gossip_channel",
        path: "/api/gossip/channels/get",
        method: Method::POST,
        domain: Domain::Gossip,
        request_type: "GetChannelRequest",
        response_type: "ChannelDetailResponse",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "leave_gossip_channel",
        path: "/api/gossip/channels/leave",
        method: Method::POST,
        domain: Domain::Gossip,
        request_type: "GetChannelRequest",
        response_type: "EmptyResponse",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "join_gossip_channel",
        path: "/api/gossip/channels/join",
        method: Method::POST,
        domain: Domain::Gossip,
        request_type: "JoinChannelRequest",
        response_type: "GossipChannel",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "get_gossip_channel_invite",
        path: "/api/gossip/channels/invite",
        method: Method::POST,
        domain: Domain::Gossip,
        request_type: "GetChannelRequest",
        response_type: "ChannelInvite",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "get_gossip_messages",
        path: "/api/gossip/messages/list",
        method: Method::POST,
        domain: Domain::Gossip,
        request_type: "GetMessagesWithChannelRequest",
        response_type: "MessagesResponse",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "send_gossip_message",
        path: "/api/gossip/messages/send",
        method: Method::POST,
        domain: Domain::Gossip,
        request_type: "SendMessageWithChannelRequest",
        response_type: "GossipMessage",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "react_gossip_message",
        path: "/api/gossip/messages/react",
        method: Method::POST,
        domain: Domain::Gossip,
        request_type: "ReactWithChannelRequest",
        response_type: "EmptyResponse",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "delete_gossip_message",
        path: "/api/gossip/messages/delete",
        method: Method::POST,
        domain: Domain::Gossip,
        request_type: "DeleteMessageRequest",
        response_type: "EmptyResponse",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "list_gossip_members",
        path: "/api/gossip/members/list",
        method: Method::POST,
        domain: Domain::Gossip,
        request_type: "GetChannelRequest",
        response_type: "Vec<GossipChannelMember>",
        auth: RouteAuth::Authenticated,
    },
];

/// request that only needs a topic_id
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, zod_gen_derive::ZodSchema)]
pub struct GetChannelRequest {
    pub topic_id: String,
}

/// messages request with channel context
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, zod_gen_derive::ZodSchema)]
pub struct GetMessagesWithChannelRequest {
    pub topic_id: String,
    pub before_timestamp: Option<i64>,
    pub limit: Option<i64>,
}

/// send message request with channel context
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, zod_gen_derive::ZodSchema)]
pub struct SendMessageWithChannelRequest {
    pub topic_id: String,
    pub text: Option<String>,
    pub items: Vec<MusicReference>,
}

/// react request with channel context
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, zod_gen_derive::ZodSchema)]
pub struct ReactWithChannelRequest {
    pub topic_id: String,
    pub target_message_id: String,
    pub emoji: String,
}

/// delete message request
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, zod_gen_derive::ZodSchema)]
pub struct DeleteMessageRequest {
    pub topic_id: String,
    pub message_id: String,
}

/// empty request body (for listing endpoints)
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, zod_gen_derive::ZodSchema)]
pub struct EmptyRequest {}

/// collect gossip route metadata
pub fn routes() -> Vec<RouteInfo> {
    ROUTES.to_vec()
}

/// dispatch gossip routes
pub async fn dispatch(
    path: &str,
    caller: &Caller,
    body: &JsonValue,
) -> Option<GrimoireResponse<JsonValue>> {
    match path {
        "/api/gossip/channels" => Some(create_channel(caller, body.clone()).await),
        "/api/gossip/channels/list" => Some(list_channels(caller, body.clone()).await),
        "/api/gossip/channels/get" => Some(get_channel(caller, body.clone()).await),
        "/api/gossip/channels/leave" => Some(leave_channel(caller, body.clone()).await),
        "/api/gossip/channels/join" => Some(join_channel(caller, body.clone()).await),
        "/api/gossip/channels/invite" => Some(get_invite(caller, body.clone()).await),
        "/api/gossip/messages/list" => Some(get_messages(caller, body.clone()).await),
        "/api/gossip/messages/send" => Some(send_message(caller, body.clone()).await),
        "/api/gossip/messages/react" => Some(react_message(caller, body.clone()).await),
        "/api/gossip/messages/delete" => Some(delete_message(caller, body.clone()).await),
        "/api/gossip/members/list" => Some(list_members(caller, body.clone()).await),
        _ => None,
    }
}

// --- handler functions ---

/// create a new gossip channel
pub async fn create_channel(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: CreateChannelRequest = match parse_body(body) {
        Ok(r) => r,
        Err(e) => return e,
    };

    // use the caller's node_id (from their peer node) or user_id as node identity
    // for now, use user_id as a stand-in (real node_id comes from federation endpoint)
    let creator_node_id = &caller.user_id;
    let creator_name = &caller.username;

    match GossipService::create_channel(
        creator_node_id,
        creator_name,
        &req.name,
        req.description.as_deref(),
    )
    .await
    {
        Ok(channel) => {
            GrimoireResponse::success("channel created", serde_json::to_value(channel).unwrap())
        }
        Err(e) => GrimoireResponse::failure("failed to create channel", vec![ErrorDetail::from(e)]),
    }
}

/// list all channels
pub async fn list_channels(_caller: &Caller, _body: JsonValue) -> GrimoireResponse<JsonValue> {
    match repository::list_channels().await {
        Ok(channels) => {
            GrimoireResponse::success("channels listed", serde_json::to_value(channels).unwrap())
        }
        Err(e) => GrimoireResponse::failure("failed to list channels", vec![ErrorDetail::from(e)]),
    }
}

/// get channel details with members
pub async fn get_channel(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: GetChannelRequest = match parse_body(body) {
        Ok(r) => r,
        Err(e) => return e,
    };

    let channel = match repository::get_channel(&req.topic_id).await {
        Ok(Some(ch)) => ch,
        Ok(None) => {
            return GrimoireResponse::failure(
                "channel not found",
                vec![ErrorDetail::new(
                    "not_found",
                    "channel not found",
                    "no channel with that topic_id",
                )],
            )
        }
        Err(e) => {
            return GrimoireResponse::failure("failed to get channel", vec![ErrorDetail::from(e)])
        }
    };

    let members = match repository::list_members(&req.topic_id).await {
        Ok(m) => m,
        Err(e) => {
            return GrimoireResponse::failure("failed to get members", vec![ErrorDetail::from(e)])
        }
    };

    let detail = ChannelDetailResponse { channel, members };
    GrimoireResponse::success("channel details", serde_json::to_value(detail).unwrap())
}

/// leave a channel
pub async fn leave_channel(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: GetChannelRequest = match parse_body(body) {
        Ok(r) => r,
        Err(e) => return e,
    };

    match GossipService::leave_channel(&req.topic_id).await {
        Ok(()) => GrimoireResponse::success("left channel", serde_json::to_value(()).unwrap()),
        Err(e) => GrimoireResponse::failure("failed to leave channel", vec![ErrorDetail::from(e)]),
    }
}

/// join a channel via invite
pub async fn join_channel(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: JoinChannelRequest = match parse_body(body) {
        Ok(r) => r,
        Err(e) => return e,
    };

    match GossipService::join_channel(&caller.user_id, &caller.username, &req).await {
        Ok(channel) => {
            GrimoireResponse::success("joined channel", serde_json::to_value(channel).unwrap())
        }
        Err(e) => GrimoireResponse::failure("failed to join channel", vec![ErrorDetail::from(e)]),
    }
}

/// get channel invite payload
pub async fn get_invite(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: GetChannelRequest = match parse_body(body) {
        Ok(r) => r,
        Err(e) => return e,
    };

    match GossipService::generate_invite(&req.topic_id).await {
        Ok(invite) => {
            GrimoireResponse::success("invite generated", serde_json::to_value(invite).unwrap())
        }
        Err(e) => {
            GrimoireResponse::failure("failed to generate invite", vec![ErrorDetail::from(e)])
        }
    }
}

/// get messages for a channel
pub async fn get_messages(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: GetMessagesWithChannelRequest = match parse_body(body) {
        Ok(r) => r,
        Err(e) => return e,
    };

    match GossipService::get_messages(&req.topic_id, req.before_timestamp, req.limit).await {
        Ok(response) => GrimoireResponse::success(
            "messages retrieved",
            serde_json::to_value(response).unwrap(),
        ),
        Err(e) => GrimoireResponse::failure("failed to get messages", vec![ErrorDetail::from(e)]),
    }
}

/// send a music share message
pub async fn send_message(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: SendMessageWithChannelRequest = match parse_body(body) {
        Ok(r) => r,
        Err(e) => return e,
    };

    if req.items.is_empty() {
        return GrimoireResponse::failure(
            "must include at least one music item",
            vec![ErrorDetail::new(
                "validation_error",
                "missing music items",
                "music share must have at least one item",
            )],
        );
    }

    let payload = MusicSharePayload {
        text: req.text,
        items: req.items,
    };

    let envelope = match GossipService::build_music_share_envelope(
        &caller.user_id,
        &caller.username,
        &payload,
    ) {
        Ok(env) => env,
        Err(e) => {
            return GrimoireResponse::failure("failed to build message", vec![ErrorDetail::from(e)])
        }
    };

    // persist locally
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    let msg = GossipMessage {
        message_id: envelope.message_id.clone(),
        topic_id: req.topic_id.clone(),
        sender_node_id: envelope.sender_node_id.clone(),
        sender_name: Some(envelope.sender_name.clone()),
        msg_type: envelope.msg_type.to_string(),
        payload: envelope.payload.clone(),
        timestamp: envelope.timestamp,
        received_at: now,
        deleted_at: None,
    };

    if let Err(e) = repository::insert_message(&msg).await {
        return GrimoireResponse::failure("failed to persist message", vec![ErrorDetail::from(e)]);
    }

    if let Err(e) = repository::update_last_message_at(&req.topic_id, envelope.timestamp).await {
        tracing::warn!("failed to update last_message_at: {}", e);
    }

    // broadcast to gossip peers (best-effort — no error if federation isn't running)
    if let Some(manager) = crate::gossip::manager::get_gossip_manager() {
        if let Err(e) = manager.broadcast(&req.topic_id, &envelope).await {
            tracing::warn!("gossip broadcast failed (non-fatal): {}", e);
        }
    }

    GrimoireResponse::success("message sent", serde_json::to_value(msg).unwrap())
}

/// react to a message
pub async fn react_message(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: ReactWithChannelRequest = match parse_body(body) {
        Ok(r) => r,
        Err(e) => return e,
    };

    let reaction_payload = ReactionPayload {
        target_message_id: req.target_message_id.clone(),
        emoji: req.emoji.clone(),
    };

    let envelope = GossipService::build_reaction_envelope(
        &caller.user_id,
        &caller.username,
        &reaction_payload,
    );

    let reaction = GossipReaction {
        message_id: envelope.message_id.clone(),
        topic_id: req.topic_id.clone(),
        target_message_id: req.target_message_id,
        sender_node_id: caller.user_id.clone(),
        sender_name: Some(caller.username.clone()),
        emoji: req.emoji,
        timestamp: envelope.timestamp,
    };

    if let Err(e) = repository::insert_reaction(&reaction).await {
        return GrimoireResponse::failure("failed to add reaction", vec![ErrorDetail::from(e)]);
    }

    // broadcast reaction to gossip peers
    if let Some(manager) = crate::gossip::manager::get_gossip_manager() {
        if let Err(e) = manager.broadcast(&req.topic_id, &envelope).await {
            tracing::warn!("gossip reaction broadcast failed (non-fatal): {}", e);
        }
    }

    GrimoireResponse::success("reaction added", serde_json::to_value(()).unwrap())
}

/// delete own message
pub async fn delete_message(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: DeleteMessageRequest = match parse_body(body) {
        Ok(r) => r,
        Err(e) => return e,
    };

    match repository::soft_delete_message(&req.message_id, &caller.user_id).await {
        Ok(true) => {
            // broadcast deletion to gossip peers
            let envelope = GossipService::build_delete_envelope(
                &caller.user_id,
                &caller.username,
                &req.message_id,
            );
            if let Some(manager) = crate::gossip::manager::get_gossip_manager() {
                if let Err(e) = manager.broadcast(&req.topic_id, &envelope).await {
                    tracing::warn!("gossip delete broadcast failed (non-fatal): {}", e);
                }
            }
            GrimoireResponse::success("message deleted", serde_json::to_value(()).unwrap())
        }
        Ok(false) => GrimoireResponse::failure(
            "message not found or not yours",
            vec![ErrorDetail::new(
                "not_found",
                "message not found",
                "no matching message found (you can only delete your own messages)",
            )],
        ),
        Err(e) => GrimoireResponse::failure("failed to delete message", vec![ErrorDetail::from(e)]),
    }
}

/// list channel members
pub async fn list_members(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: GetChannelRequest = match parse_body(body) {
        Ok(r) => r,
        Err(e) => return e,
    };

    match repository::list_members(&req.topic_id).await {
        Ok(members) => {
            GrimoireResponse::success("members listed", serde_json::to_value(members).unwrap())
        }
        Err(e) => GrimoireResponse::failure("failed to list members", vec![ErrorDetail::from(e)]),
    }
}
