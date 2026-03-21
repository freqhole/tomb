//! generic offal dispatch for CLI plumbing commands
//!
//! provides dispatch_to_offal function that:
//! 1. gets the first root user as caller
//! 2. calls offal dispatch with the route path and body
//! 3. returns CommandOutput

use crate::plumbing::utils::CommandOutput;
use grimoire::offal::{dispatch, Caller};
use grimoire::users::UserService;
use serde_json::Value as JsonValue;

/// dispatch a request to offal and return CommandOutput
///
/// this is the core function for all plumbing commands that map to offal routes.
/// it handles:
/// - getting the CLI caller (first root user)
/// - calling offal dispatch
/// - converting GrimoireResponse to CommandOutput
pub async fn dispatch_to_offal(path: &str, body: JsonValue) -> CommandOutput<JsonValue> {
    // get first root user for CLI caller
    let caller = match get_cli_caller().await {
        Ok(c) => c,
        Err(output) => return output,
    };

    // dispatch to offal
    let response = dispatch(path, &caller, body, None).await;

    // convert to CommandOutput
    if response.success {
        CommandOutput::success(&response.message, response.data.unwrap_or(JsonValue::Null))
    } else {
        CommandOutput::failure(&response.message, response.errors, ())
    }
}

/// get the CLI caller (first root user)
async fn get_cli_caller() -> Result<Caller, CommandOutput<JsonValue>> {
    let service = UserService::new();
    let response = service.get_first_root_user().await;

    match response.data {
        Some(user) => Ok(Caller::new(&user.id, &user.username, user.role)),
        None => Err(CommandOutput::failure(
            "no root user found - run setup first",
            response.errors,
            (),
        )),
    }
}
