//! TypeScript client generator
//! Orchestrates the generation of all TypeScript files

use crate::server::route_def::RouteDefinition;
use crate::types::*;
use std::collections::{HashMap, HashSet};
use zod_gen::ZodGenerator;

use super::templates::*;

// =============================================================================
// Type Collection
// =============================================================================

/// Extract the base type name from a Rust type string
/// e.g., "alloc::vec::Vec<codegen_spike::types::music::Song>" -> "Song"
fn extract_base_type(rust_type: &str) -> Option<String> {
    // Handle Vec<T>
    if let Some(inner) = rust_type.strip_prefix("alloc::vec::Vec<") {
        let inner = inner.strip_suffix('>').unwrap_or(inner);
        return extract_base_type(inner);
    }

    // Handle Option<T>
    if let Some(inner) = rust_type.strip_prefix("core::option::Option<") {
        let inner = inner.strip_suffix('>').unwrap_or(inner);
        return extract_base_type(inner);
    }

    // Skip primitive types
    if rust_type == "String" || rust_type == "alloc::string::String" {
        return None;
    }

    // Extract just the type name from full path
    Some(
        rust_type
            .split("::")
            .last()
            .unwrap_or(rust_type)
            .to_string(),
    )
}

/// Collect all unique type names from routes
fn collect_types_from_routes(routes: &[RouteDefinition]) -> Vec<String> {
    let mut types = HashSet::new();

    for route in routes {
        if let Some(t) = extract_base_type(route.request_type) {
            types.insert(t);
        }
        if let Some(t) = extract_base_type(route.response_type) {
            types.insert(t);
        }
    }

    let mut sorted: Vec<_> = types.into_iter().collect();
    sorted.sort();
    sorted
}

// =============================================================================
// Zod Schema Generation
// =============================================================================

fn generate_schema_file(routes: &[RouteDefinition]) -> Result<String, Box<dyn std::error::Error>> {
    // Collect types from routes
    let type_names = collect_types_from_routes(routes);

    let mut generator = ZodGenerator::new();

    // Add schemas for each type (in practice, we'd map these dynamically)
    // For now, we map known types - later this could use reflection or a registry
    for type_name in &type_names {
        match type_name.as_str() {
            "QueryParams" => generator.add_schema::<QueryParams>("QueryParams"),
            "Playlist" => generator.add_schema::<Playlist>("Playlist"),
            "PlaylistQueryResult" => {
                generator.add_schema::<PlaylistQueryResult>("PlaylistQueryResult")
            }
            "Song" => generator.add_schema::<Song>("Song"),
            "Album" => generator.add_schema::<Album>("Album"),
            "User" => generator.add_schema::<User>("User"),
            "CreateUserRequest" => generator.add_schema::<CreateUserRequest>("CreateUserRequest"),
            "LoginRequest" => generator.add_schema::<LoginRequest>("LoginRequest"),
            "LoginResponse" => generator.add_schema::<LoginResponse>("LoginResponse"),
            _ => eprintln!("Warning: Unknown type {}", type_name),
        }
    }

    let mut output = schema_header();
    output.push_str(&generator.generate());

    // Note: zod_gen already generates the type exports, so we don't add them again

    Ok(output)
}

// =============================================================================
// API Client Generation
// =============================================================================

fn generate_api_client_file(
    routes: &[RouteDefinition],
) -> Result<String, Box<dyn std::error::Error>> {
    let mut output = api_client_header();

    // Generate functions for each route
    output.push_str(
        "// ============================================================================\n",
    );
    output.push_str("// API Functions\n");
    output.push_str(
        "// ============================================================================\n\n",
    );

    for route in routes {
        output.push_str(&client_function(route));
        output.push('\n');
    }

    // Generate namespace structure
    output.push_str(&generate_namespace_structure(routes));

    Ok(output)
}

/// Generate the namespace structure from routes
fn generate_namespace_structure(routes: &[RouteDefinition]) -> String {
    // Group routes by module path
    let mut grouped: HashMap<String, Vec<&RouteDefinition>> = HashMap::new();
    for route in routes {
        grouped
            .entry(route.module_path.to_string())
            .or_insert_with(Vec::new)
            .push(route);
    }

    let mut output = String::new();
    output.push_str(
        "// ============================================================================\n",
    );
    output.push_str("// API Namespace\n");
    output.push_str(
        "// ============================================================================\n\n",
    );

    output.push_str("export const api = {\n");

    // Build music namespace
    output.push_str("  music: {\n");

    // Playlists
    if let Some(routes) = grouped.get("music/playlists") {
        output.push_str("    playlists: {\n");
        for route in routes {
            output.push_str(&format!("      {}: {},\n", route.key, route.name));
        }
        output.push_str("    },\n");
    }

    // Songs
    if let Some(routes) = grouped.get("music/songs") {
        output.push_str("    songs: {\n");
        for route in routes {
            output.push_str(&format!("      {}: {},\n", route.key, route.name));
        }
        output.push_str("    },\n");
    }

    // Albums
    if let Some(routes) = grouped.get("music/albums") {
        output.push_str("    albums: {\n");
        for route in routes {
            output.push_str(&format!("      {}: {},\n", route.key, route.name));
        }
        output.push_str("    },\n");
    }

    output.push_str("  },\n");

    // Users namespace
    if let Some(routes) = grouped.get("users") {
        output.push_str("  users: {\n");
        for route in routes {
            output.push_str(&format!("    {}: {},\n", route.key, route.name));
        }
        output.push_str("  },\n");
    }

    output.push_str("};\n\n");
    output.push_str("export default api;\n");

    output
}

// =============================================================================
// Public API - Generate All Files
// =============================================================================

pub fn generate_all(routes: Vec<RouteDefinition>) -> Result<(), Box<dyn std::error::Error>> {
    println!("=== Generating TypeScript Client ===\n");

    // Create output directory
    std::fs::create_dir_all("freqhole-api-client/src")?;

    // 1. Generate schema.ts (all Zod schemas + TypeScript types)
    let schema_code = generate_schema_file(&routes)?;
    std::fs::write("freqhole-api-client/src/schema.ts", schema_code)?;
    println!("✓ Generated: src/schema.ts");

    // 2. Generate api-client.ts (all fetch functions + namespace)
    let api_client_code = generate_api_client_file(&routes)?;
    std::fs::write("freqhole-api-client/src/api-client.ts", api_client_code)?;
    println!("✓ Generated: src/api-client.ts");

    println!("\n✨ TypeScript client generated successfully!");
    println!("\nGenerated files:");
    println!("  - schema.ts      (Zod schemas + TypeScript types)");
    println!("  - api-client.ts  (API functions + namespace)");
    println!("\nNext steps:");
    println!("  cd freqhole-api-client");
    println!("  npm install");
    println!("  npm run typecheck");

    Ok(())
}
