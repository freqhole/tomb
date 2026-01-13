//! TypeScript client generator
//! Orchestrates the generation of all TypeScript files

use crate::server::route_def::RouteDefinition;
use std::collections::{HashMap, HashSet};
use zod_gen::ZodGenerator;

use super::templates::*;

// =============================================================================
// Type Name Extraction (for validation)
// =============================================================================

/// Extract the base type name from a Rust type string
/// e.g., "alloc::vec::Vec<codegen_spike::types::music::Song>" -> Some("Song")
///      "String" -> None (primitive)
fn extract_base_type_name(rust_type: &str) -> Option<String> {
    // Skip primitives
    if rust_type == "String" || rust_type.ends_with("::String") {
        return None;
    }

    // Handle Vec<T> - extract T
    if let Some(inner) = rust_type.strip_prefix("alloc::vec::Vec<") {
        let inner = inner.strip_suffix('>').unwrap_or(inner);
        return extract_base_type_name(inner);
    }

    // Handle Option<T> - extract T
    if let Some(inner) = rust_type.strip_prefix("core::option::Option<") {
        let inner = inner.strip_suffix('>').unwrap_or(inner);
        return extract_base_type_name(inner);
    }

    // Extract just the type name (last component)
    Some(
        rust_type
            .split("::")
            .last()
            .unwrap_or(rust_type)
            .to_string(),
    )
}

// =============================================================================
// Zod Schema Generation with Validation
// =============================================================================

fn generate_schema_file(
    definitions: &[RouteDefinition],
) -> Result<String, Box<dyn std::error::Error>> {
    let mut generator = ZodGenerator::new();
    let mut registered = HashSet::new();

    // Call manual type registry from types module
    crate::types::register_all_types(&mut generator, &mut registered);

    // VALIDATION: Check that all types used in routes are registered
    for route in definitions {
        // Check request type
        if let Some(type_name) = extract_base_type_name(route.request_type) {
            if !registered.contains(&type_name) {
                panic!(
                    "\n❌ ERROR: Type '{}' is used in route '{}' (request) but not registered!\n\
                     → Add it to types::register_all_types() in src/types/mod.rs\n",
                    type_name, route.name
                );
            }
        }

        // Check response type
        if let Some(type_name) = extract_base_type_name(route.response_type) {
            if !registered.contains(&type_name) {
                panic!(
                    "\n❌ ERROR: Type '{}' is used in route '{}' (response) but not registered!\n\
                     → Add it to types::register_all_types() in src/types/mod.rs\n",
                    type_name, route.name
                );
            }
        }
    }

    let mut output = schema_header();
    output.push_str(&generator.generate());

    Ok(output)
}

// =============================================================================
// API Client Generation
// =============================================================================

fn generate_api_client_file(
    definitions: &[RouteDefinition],
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

    for route in definitions {
        output.push_str(&client_function(route));
        output.push('\n');
    }

    // Generate namespace structure
    output.push_str(&generate_namespace_structure(definitions));

    Ok(output)
}

/// Generate the namespace structure from route definitions
fn generate_namespace_structure(definitions: &[RouteDefinition]) -> String {
    // Group definitions by module path
    let mut grouped: HashMap<String, Vec<&RouteDefinition>> = HashMap::new();
    for route in definitions {
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

pub fn generate_all(definitions: Vec<RouteDefinition>) -> Result<(), Box<dyn std::error::Error>> {
    println!("=== Generating TypeScript Client ===\n");

    // Create output directory
    std::fs::create_dir_all("freqhole-api-client/src")?;

    // 1. Generate schema.ts (all Zod schemas + TypeScript types)
    let schema_code = generate_schema_file(&definitions)?;
    std::fs::write("freqhole-api-client/src/schema.ts", schema_code)?;
    println!("✓ Generated: src/schema.ts");

    // 2. Generate api-client.ts (all fetch functions + namespace)
    let api_client_code = generate_api_client_file(&definitions)?;
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
