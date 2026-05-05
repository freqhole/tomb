//! in-process transport: calls grimoire functions directly.
//!
//! caller construction follows the same pattern
//! [cli/src/plumbing/dispatch.rs](../../../../cli/src/plumbing/dispatch.rs)
//! uses: `UserService::get_first_root_user()` for the bootstrap
//! caller. m1 adds an admin-picker on top so the user can switch.

use async_trait::async_trait;
use grimoire::offal::Caller;
use grimoire::response::GrimoireResponse;
use grimoire::users::UserService;
use serde_json::Value as JsonValue;

use super::Transport;

pub struct LocalTransport {
    caller: Caller,
}

impl LocalTransport {
    /// build a `LocalTransport` using the first root user as caller.
    /// fails if no root user exists (the setup wizard, m0+, will
    /// handle that case before we get here).
    pub async fn from_first_root() -> color_eyre::Result<Self> {
        let service = UserService::new();
        let resp = service.get_first_root_user().await;
        match resp.data {
            Some(user) => Ok(Self {
                caller: Caller::new(&user.id, &user.username, user.role),
            }),
            None => Err(color_eyre::eyre::eyre!(
                "no root user in freqhole — run `freqhole setup` (or the rathole setup wizard, m0+) first"
            )),
        }
    }

    pub fn caller(&self) -> &Caller {
        &self.caller
    }
}

#[async_trait]
impl Transport for LocalTransport {
    async fn admin_dispatch(&self, cmd: &str, args: JsonValue) -> GrimoireResponse<JsonValue> {
        grimoire::admin_dispatch::handle(cmd, args, &self.caller).await
    }
}
