//! TypeScript client generator
//! Generates type-safe client with proper module structure

use crate::server::routes::RouteDefinition;
use crate::types::*;
use std::collections::HashMap;
use zod_gen::ZodGenerator;

// =============================================================================
// Type Name Extraction
// =============================================================================

/// Extract clean TypeScript type name from Rust's fully-qualified type name
/// e.g., "codegen_spike::types::music::QueryParams" -> "QueryParams"
///      "alloc::vec::Vec<codegen_spike::types::music::Song>" -> "Song[]"
fn extract_type_name(rust_type: &str) -> String {
    // Handle Vec<T> -> T[]
    if let Some(inner) = rust_type.strip_prefix("alloc::vec::Vec<") {
        let inner = inner.strip_suffix('>').unwrap_or(inner);
        return format!("{}[]", extract_type_name(inner));
    }

    // Handle Option<T> -> T | null
    if let Some(inner) = rust_type.strip_prefix("core::option::Option<") {
        let inner = inner.strip_suffix('>').unwrap_or(inner);
        return format!("{} | null", extract_type_name(inner));
    }

    // Extract just the type name from full path
    rust_type
        .split("::")
        .last()
        .unwrap_or(rust_type)
        .to_string()
}

// =============================================================================
// Client Function Generation
// =============================================================================

fn generate_client_function(route: &RouteDefinition) -> String {
    let method = route.method.as_str();
    let has_body = matches!(
        route.method,
        crate::server::routes::Method::POST
            | crate::server::routes::Method::PUT
            | crate::server::routes::Method::PATCH
    );

    // Extract clean type names
    let req_type = extract_type_name(route.request_type);
    let resp_type = extract_type_name(route.response_type);

    let req_schema = if req_type.ends_with("[]") {
        format!("{}Schema", req_type.trim_end_matches("[]"))
    } else if req_type == "String" {
        String::new()
    } else {
        format!("{}Schema", req_type)
    };

    let resp_schema = if resp_type.ends_with("[]") {
        format!("{}Schema", resp_type.trim_end_matches("[]"))
    } else {
        format!("{}Schema", resp_type)
    };

    let body_section = if has_body && req_type != "String" {
        "      body: JSON.stringify(validated),\n"
    } else {
        ""
    };

    let validation_section = if has_body && !req_schema.is_empty() {
        format!("  const validated = {}.parse(params);\n\n", req_schema)
    } else {
        String::new()
    };

    let resp_parse = if resp_type.ends_with("[]") {
        format!("  return {}.array().parse(data);", resp_schema)
    } else {
        format!("  return {}.parse(data);", resp_schema)
    };

    format!(
        r#"export async function {name}(params: {req_type}): Promise<{resp_type}> {{
{validation}  const response = await fetch(`${{getBaseUrl()}}{path}`, {{
    method: '{method}',
    headers: {{
      'Content-Type': 'application/json',
    }},
{body}  }});

  if (!response.ok) {{
    throw new Error(`API error: ${{response.status}}`);
  }}

  const data = await response.json();
{resp_parse}
}}
"#,
        name = route.name,
        req_type = req_type,
        resp_type = resp_type,
        path = route.path,
        method = method,
        validation = validation_section,
        body = body_section,
        resp_parse = resp_parse,
    )
}

// =============================================================================
// Module Generation
// =============================================================================

fn generate_module_client(
    module_name: &str,
    parent_path: &str,
    routes: &[RouteDefinition],
) -> String {
    let type_import_depth = if parent_path.is_empty() {
        "../.."
    } else {
        "../../.."
    };

    let mut output = format!(
        r#"// Auto-generated client for {module}
// DO NOT EDIT

import {{ z }} from 'zod';
import {{ getBaseUrl }} from '{depth}/config';
import * as types from '{depth}/types';

"#,
        module = module_name,
        depth = type_import_depth
    );

    for route in routes {
        output.push_str(&generate_client_function(route));
        output.push('\n');
    }

    output
}

// =============================================================================
// Config Generation
// =============================================================================

fn generate_config() -> String {
    r#"// Client configuration

let baseUrl = 'http://localhost:3000';

export function getBaseUrl(): string {
  return baseUrl;
}

export function setBaseUrl(url: string) {
  baseUrl = url;
}
"#
    .to_string()
}

// =============================================================================
// Index/Re-export Generation
// =============================================================================

fn generate_namespace_index(modules: &[&str], with_types: bool) -> String {
    let mut output = String::from("// Auto-generated index\n// DO NOT EDIT\n\n");

    if with_types {
        output.push_str("export * as types from './types';\n");
        output.push_str("export { getBaseUrl, setBaseUrl } from './config';\n\n");
    }

    for module in modules {
        output.push_str(&format!("export * as {} from './{}';\n", module, module));
    }

    output
}

// =============================================================================
// tsconfig.json Generation
// =============================================================================

fn generate_tsconfig() -> String {
    r#"{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "lib": ["ES2020", "DOM"],
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
"#
    .to_string()
}

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

    let mut output = String::from(
        r#"// Auto-generated types and Zod schemas
// DO NOT EDIT

import { z } from 'zod';

"#,
    );

    output.push_str(&generator.generate());

    Ok(output)
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
    let config = generate_config();
    std::fs::write("freqhole-api-client/src/config.ts", config)?;
    println!("✓ Generated: src/config.ts");

    // 2. Generate types + Zod schemas
    let types = generate_types_file()?;
    std::fs::write("freqhole-api-client/src/types.ts", types)?;
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
    let music_index = generate_namespace_index(&["playlists", "songs", "albums"], false);
    std::fs::write("freqhole-api-client/src/api/music/index.ts", music_index)?;
    println!("✓ Generated: src/api/music/index.ts");

    // 6. Generate api namespace index
    let api_index = generate_namespace_index(&["music", "users"], false);
    std::fs::write("freqhole-api-client/src/api/index.ts", api_index)?;
    println!("✓ Generated: src/api/index.ts");

    // 7. Generate root index with namespaced exports
    let root_index = r#"// Auto-generated API client
// DO NOT EDIT

export * as types from './types';
export { getBaseUrl, setBaseUrl } from './config';
export * as api from './api';

// Convenience: also export the api directly as default
import * as api from './api';
export default api;
"#;
    std::fs::write("freqhole-api-client/src/index.ts", root_index)?;
    println!("✓ Generated: src/index.ts");

    // 8. Generate tsconfig.json
    let tsconfig = generate_tsconfig();
    std::fs::write("freqhole-api-client/tsconfig.json", tsconfig)?;
    println!("✓ Generated: tsconfig.json");

    println!("\nTypeScript client generated successfully!");
    println!("\nNext steps:");
    println!("  cd freqhole-api-client");
    println!("  npm install");
    println!("  npm run typecheck");

    Ok(())
}
