fn main() {
    // Load environment variables from .env file at compile time
    // This ensures sqlx macros can find DATABASE_URL during compilation
    if let Err(e) = dotenvy::dotenv() {
        println!("cargo:warning=Could not load .env file: {}", e);
    }

    // Tell cargo to rerun this build script if .env changes
    println!("cargo:rerun-if-changed=.env");
    println!("cargo:rerun-if-changed=../.env");

    // Tell cargo to rerun if migrations directory changes
    println!("cargo:rerun-if-changed=../migrations");
}
