//! knock-management handlers (accept/reject/delete/reject_all + listing
//! is handled inline in the dispatch table).

use crate::admin_dispatch::helpers::{decode, to_value};
use crate::admin_dispatch::types::knocks::{
    KnocksAcceptRequest, KnocksDeleteRequest, KnocksRejectAllResponse, KnocksRejectRequest,
};
use crate::federation::knock;
use crate::offal::Caller;
use crate::response::GrimoireResponse;
use serde_json::Value as JsonValue;

pub(in crate::admin_dispatch) async fn accept(
    args: JsonValue,
    caller: &Caller,
) -> GrimoireResponse<JsonValue> {
    let req: KnocksAcceptRequest = match decode(args) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let process = knock::ProcessKnockRequest {
        username: req.username,
        role: req.role,
        user_id: req.user_id,
    };
    match knock::accept_knock(&req.knock_id, process, &caller.user_id).await {
        Ok(k) => to_value(GrimoireResponse::success("knock accepted", k)),
        Err(e) => GrimoireResponse::failure("failed to accept knock", vec![e.into()]),
    }
}

pub(in crate::admin_dispatch) async fn reject(
    args: JsonValue,
    caller: &Caller,
) -> GrimoireResponse<JsonValue> {
    let req: KnocksRejectRequest = match decode(args) {
        Ok(v) => v,
        Err(r) => return r,
    };
    match knock::reject_knock(&req.knock_id, &caller.user_id).await {
        Ok(k) => to_value(GrimoireResponse::success("knock rejected", k)),
        Err(e) => GrimoireResponse::failure("failed to reject knock", vec![e.into()]),
    }
}

pub(in crate::admin_dispatch) async fn delete(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: KnocksDeleteRequest = match decode(args) {
        Ok(v) => v,
        Err(r) => return r,
    };
    match knock::delete_knock(&req.knock_id).await {
        Ok(()) => GrimoireResponse::success("knock deleted", JsonValue::Null),
        Err(e) => GrimoireResponse::failure("failed to delete knock", vec![e.into()]),
    }
}

/// reject every currently-pending knock. returns `{ rejected: <count> }`.
pub(in crate::admin_dispatch) async fn reject_all(caller: &Caller) -> GrimoireResponse<JsonValue> {
    let list = knock::list_knocks(false).await;
    let knocks = match list.data {
        Some(k) => k,
        None => return GrimoireResponse::failure("failed to list knocks", list.errors),
    };
    let mut rejected = 0u32;
    for k in knocks {
        if knock::reject_knock(&k.id, &caller.user_id).await.is_ok() {
            rejected += 1;
        }
    }
    let body = KnocksRejectAllResponse { rejected };
    to_value(GrimoireResponse::success(
        format!("rejected {} knocks", rejected),
        body,
    ))
}
