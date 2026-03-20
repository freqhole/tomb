//! typescript client generator - outputs route config + schemas

use grimoire::api_registry::{RouteAuth, RouteInfo};
use grimoire::offal;
use std::collections::HashSet;
use zod_gen::ZodGenerator;

fn generate_schema_file(routes: &[RouteInfo]) -> Result<String, Box<dyn std::error::Error>> {
    let mut generator = ZodGenerator::new();
    let mut registered = HashSet::new();

    grimoire::api_registry::type_registry::register_all_types(&mut generator, &mut registered);

    // validate all route types are registered (collect all errors first)
    let mut missing_types = Vec::new();
    for route in routes {
        if let Some(t) = extract_type(route.request_type) {
            if !registered.contains(&t) {
                missing_types.push(format!("  {} (request for '{}')", t, route.name));
            }
        }
        if let Some(t) = extract_type(route.response_type) {
            if !registered.contains(&t) {
                missing_types.push(format!("  {} (response for '{}')", t, route.name));
            }
        }
    }

    if !missing_types.is_empty() {
        missing_types.sort();
        missing_types.dedup();
        panic!(
            "Unregistered types used in routes:\n{}",
            missing_types.join("\n")
        );
    }

    Ok(generator.generate())
}

fn extract_type(rust_type: &str) -> Option<String> {
    // primitives, json types, and empty types don't need registration
    if rust_type == "String"
        || rust_type == "bool"
        || rust_type == "i32"
        || rust_type == "i64"
        || rust_type == "u32"
        || rust_type == "u64"
        || rust_type == "f32"
        || rust_type == "f64"
        || rust_type == "serde_json::Value"
        || rust_type == "EmptyRequest"
        || rust_type == "EmptyResponse"
        || rust_type == "()"
    {
        return None;
    }
    if let Some(start) = rust_type.find("Vec<") {
        return extract_type(&rust_type[start + 4..].trim_end_matches('>'));
    }
    if let Some(start) = rust_type.find("Option<") {
        return extract_type(&rust_type[start + 7..].trim_end_matches('>'));
    }
    Some(
        rust_type
            .split("::")
            .last()
            .unwrap_or(rust_type)
            .to_string(),
    )
}

/// format RouteAuth enum as TypeScript object literal
fn auth_to_ts(auth: &RouteAuth) -> String {
    match auth {
        RouteAuth::Public => "{ type: 'public' }".to_string(),
        RouteAuth::Authenticated => "{ type: 'authenticated' }".to_string(),
        RouteAuth::Role(role) => {
            format!("{{ type: 'role', role: '{}' }}", role.as_str())
        }
        RouteAuth::Owner => "{ type: 'owner' }".to_string(),
        RouteAuth::OwnerOr(role) => {
            format!("{{ type: 'owner_or', role: '{}' }}", role.as_str())
        }
    }
}

fn generate_routes_file(routes: &[RouteInfo]) -> String {
    let mut output = String::from(
        "// generated route config\nimport * as s from './schema';\nimport { z } from 'zod';\n\n",
    );

    // add role hierarchy constant
    output.push_str("// role hierarchy - lower number = higher privilege\n");
    output.push_str("export const roleHierarchy = {\n");
    output.push_str("  root: 0,\n");
    output.push_str("  admin: 10,\n");
    output.push_str("  member: 20,\n");
    output.push_str("  viewer: 30,\n");
    output.push_str("} as const;\n\n");

    // add type definitions
    output.push_str("export type UserRoleName = keyof typeof roleHierarchy;\n");
    output.push_str(
        "export type RouteAuthType = 'public' | 'authenticated' | 'role' | 'owner' | 'owner_or';\n",
    );
    output.push_str("export type RouteAuth =\n");
    output.push_str("  | { type: 'public' }\n");
    output.push_str("  | { type: 'authenticated' }\n");
    output.push_str("  | { type: 'role'; role: UserRoleName }\n");
    output.push_str("  | { type: 'owner' }\n");
    output.push_str("  | { type: 'owner_or'; role: UserRoleName };\n\n");

    // group routes by domain (BTreeMap for consistent ordering)
    let mut domains: std::collections::BTreeMap<&str, Vec<&RouteInfo>> =
        std::collections::BTreeMap::new();
    for route in routes {
        domains
            .entry(route.domain.as_str())
            .or_insert_with(Vec::new)
            .push(route);
    }

    output.push_str("export const routes = {\n");

    for (domain, mut domain_routes) in domains {
        // sort routes by name within each domain
        domain_routes.sort_by_key(|r| r.name);

        output.push_str(&format!("  {}: {{\n", domain));

        for route in domain_routes {
            let req_schema = schema_ref(route.request_type);
            let resp_schema = schema_ref(route.response_type);
            let auth_ts = auth_to_ts(&route.auth);

            output.push_str(&format!(
                "    {}: {{ method: '{}', path: '{}', req: {}, resp: {}, auth: {} as const }},\n",
                route.name,
                route.method.as_str(),
                route.path,
                req_schema,
                resp_schema,
                auth_ts
            ));
        }

        output.push_str("  },\n");
    }

    output.push_str("} as const;\n");
    output
}

fn schema_ref(rust_type: &str) -> String {
    if rust_type == "String" {
        return "null".to_string();
    }

    // handle primitives and json types
    match rust_type {
        "bool" => return "z.boolean()".to_string(),
        "i32" | "i64" | "u32" | "u64" | "f32" | "f64" => return "z.number()".to_string(),
        "serde_json::Value" => return "z.any()".to_string(),
        _ => {}
    }

    let clean = rust_type.split("::").last().unwrap_or(rust_type);

    if let Some(inner) = clean.strip_prefix("Vec<").and_then(|s| s.strip_suffix('>')) {
        // special case: Vec<String> should be z.string().array()
        if inner == "String" {
            return "z.string().array()".to_string();
        }
        return format!("s.{}Schema.array()", inner);
    }

    format!("s.{}Schema", clean)
}

pub fn generate_all() -> Result<(), Box<dyn std::error::Error>> {
    let routes = offal::all_routes();
    std::fs::create_dir_all("freqhole-api-client/src/codegen")?;

    let schema = generate_schema_file(&routes)?;
    std::fs::write("freqhole-api-client/src/codegen/schema.ts", schema)?;

    let routes_config = generate_routes_file(&routes);
    std::fs::write("freqhole-api-client/src/codegen/routes.ts", routes_config)?;

    println!("generated codegen/schema.ts and codegen/routes.ts");
    Ok(())
}
