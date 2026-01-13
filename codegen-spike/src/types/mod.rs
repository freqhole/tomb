pub mod music;
pub mod users;

pub use music::*;
pub use users::*;

use std::collections::HashSet;
use zod_gen::ZodGenerator;

pub fn register_all_types(gen: &mut ZodGenerator, registered: &mut HashSet<String>) {
    gen.add_schema::<QueryParams>("QueryParams");
    registered.insert("QueryParams".to_string());

    gen.add_schema::<Playlist>("Playlist");
    registered.insert("Playlist".to_string());

    gen.add_schema::<PlaylistQueryResult>("PlaylistQueryResult");
    registered.insert("PlaylistQueryResult".to_string());

    gen.add_schema::<Song>("Song");
    registered.insert("Song".to_string());

    gen.add_schema::<Album>("Album");
    registered.insert("Album".to_string());

    gen.add_schema::<User>("User");
    registered.insert("User".to_string());

    gen.add_schema::<CreateUserRequest>("CreateUserRequest");
    registered.insert("CreateUserRequest".to_string());

    gen.add_schema::<LoginRequest>("LoginRequest");
    registered.insert("LoginRequest".to_string());

    gen.add_schema::<LoginResponse>("LoginResponse");
    registered.insert("LoginResponse".to_string());
}
