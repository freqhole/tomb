//! TypeScript client generator
//! Orchestrates the generation of all TypeScript files

use crate::server::route_def::RouteDefinition;
use crate::types::*;
use std::collections::HashMap;
use zod_gen::ZodGenerator;

use super::templates::*;

// =============================================================================
// Zod Schema Generation
// =============================================================================

fn generate_types_file() -> Result<String, Box<dyn std::error::Error>> {
    let mut generator = ZodGenerator::new();

    // Music types
    generator.add_schema::<QueryParams>("QueryParams");
    generator.add_schema::<Playlist>("Playlist");
    generator.add_schema::<PlaylistQueryResult>("PlaylistQueryResult");
    generator.add_schema::<Song>("Song");
    generator.add_schema::<Album>("Album");

    // User types
    generator.add_schema::<User>("User");
    generator.add_schema::<CreateUserRequest>("CreateUserRequest");
    generator.add_schema::<LoginRequest>("LoginRequest");
    generator.add_schema::<LoginResponse>("LoginResponse");

    let mut output = types_header();
    output.push_str(&generator.generate());

    Ok(output)
}

// =============================================================================
// Module Generation
// =============================================================================

fn generate_module_client(
    module_name: &str,
    parent_path: &str,
    routes: &[RouteDefinition],
) -> String {
    let mut output = module_header(module_name, parent_path);

    for route in routes {
        output.push_str(&client_function(route));
        output.push('\n');
    }

    output
}

// =============================================================================
// Public API - Generate All Files
// =============================================================================

pub fn generate_all(routes: Vec<RouteDefinition>) -> Result<(), Box<dyn std::error::Error>> {
    println!("=== Generating TypeScript Client ===\n");

    // Create directory structure
    std::fs::create_dir_all("freqhole-api-client/src/api/music/playlists")?;
    std::fs::create_dir_all("freqhole-api-client/src/api/music/songs")?;
    std::fs::create_dir_all("freqhole-api-client/src/api/music/albums")?;
    std::fs::create_dir_all("freqhole-api-client/src/api/users")?;

    // 1. Generate config
    let config_code = config();
    std::fs::write("freqhole-api-client/src/config.ts", config_code)?;
    println!("✓ Generated: src/config.ts");

    // 2. Generate types + Zod schemas
    let types_code = generate_types_file()?;
    std::fs::write("freqhole-api-client/src/types.ts", types_code)?;
    println!("✓ Generated: src/types.ts");

    // 3. Group routes by module path
    let mut modules: HashMap<String, Vec<RouteDefinition>> = HashMap::new();
    for route in routes {
        modules
            .entry(route.module_path.to_string())
            .or_insert_with(Vec::new)
            .push(route);
    }

    // 4. Generate each module
    for (module_path, module_routes) in modules {
        let module_name = module_path.split('/').last().unwrap();
        let parent = module_path
            .split('/')
            .take(module_path.split('/').count() - 1)
            .collect::<Vec<_>>()
            .join("/");

        let client_code = generate_module_client(module_name, &parent, &module_routes);
        let file_path = format!("freqhole-api-client/src/api/{}/index.ts", module_path);
        std::fs::write(&file_path, client_code)?;
        println!("✓ Generated: src/api/{}/index.ts", module_path);
    }

    // 5. Generate music namespace index
    let music_index = namespace_index(&["playlists", "songs", "albums"], false);
    std::fs::write("freqhole-api-client/src/api/music/index.ts", music_index)?;
    println!("✓ Generated: src/api/music/index.ts");

    // 6. Generate api namespace index
    let api_index = namespace_index(&["music", "users"], false);
    std::fs::write("freqhole-api-client/src/api/index.ts", api_index)?;
    println!("✓ Generated: src/api/index.ts");

    // 7. Generate root index with namespaced exports
    let root_index_code = root_index();
    std::fs::write("freqhole-api-client/src/index.ts", root_index_code)?;
    println!("✓ Generated: src/index.ts");

    // 8. Generate tsconfig.json
    let tsconfig_code = tsconfig();
    std::fs::write("freqhole-api-client/tsconfig.json", tsconfig_code)?;
    println!("✓ Generated: tsconfig.json");

    println!("\nTypeScript client generated successfully!");
    println!("\nNext steps:");
    println!("  cd freqhole-api-client");
    println!("  npm install");
    println!("  npm run typecheck");

    Ok(())
}
