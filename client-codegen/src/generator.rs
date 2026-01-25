//! typescript client generator - outputs route config + schemas

use grimoire::api_registry::{self, RouteInfo};
use std::collections::HashSet;
use zod_gen::ZodGenerator;

fn generate_schema_file(routes: &[RouteInfo]) -> Result<String, Box<dyn std::error::Error>> {
    let mut generator = ZodGenerator::new();
    let mut registered = HashSet::new();

    grimoire::api_registry::type_registry::register_all_types(&mut generator, &mut registered);

    // validate all route types are registered
    for route in routes {
        if let Some(t) = extract_type(route.request_type) {
            if !registered.contains(&t) {
                panic!("Type '{}' used in '{}' not registered!", t, route.name);
            }
        }
        if let Some(t) = extract_type(route.response_type) {
            if !registered.contains(&t) {
                panic!("Type '{}' used in '{}' not registered!", t, route.name);
            }
        }
    }

    Ok(generator.generate())
}

fn extract_type(rust_type: &str) -> Option<String> {
    // primitives and json types don't need registration
    if rust_type == "String"
        || rust_type == "bool"
        || rust_type == "i32"
        || rust_type == "i64"
        || rust_type == "u32"
        || rust_type == "u64"
        || rust_type == "f32"
        || rust_type == "f64"
        || rust_type == "serde_json::Value"
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

fn generate_routes_file(routes: &[RouteInfo]) -> String {
    use std::collections::HashMap;

    let mut output = String::from(
        "// generated route config\nimport * as s from './schema';\nimport { z } from 'zod';\n\n",
    );

    // group routes by domain
    let mut domains: HashMap<&str, Vec<&RouteInfo>> = HashMap::new();
    for route in routes {
        domains
            .entry(route.domain.as_str())
            .or_insert_with(Vec::new)
            .push(route);
    }

    output.push_str("export const routes = {\n");

    for (domain, domain_routes) in domains.iter() {
        output.push_str(&format!("  {}: {{\n", domain));

        for route in domain_routes {
            let req_schema = schema_ref(route.request_type);
            let resp_schema = schema_ref(route.response_type);

            output.push_str(&format!(
                "    {}: {{ method: '{}', path: '{}', req: {}, resp: {} }},\n",
                route.name,
                route.method.as_str(),
                route.path,
                req_schema,
                resp_schema
            ));
        }

        output.push_str("  },\n");
    }

    output.push_str("};\n");
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
    let routes = api_registry::all_routes();
    std::fs::create_dir_all("freqhole-api-client/src/codegen")?;

    let schema = generate_schema_file(&routes)?;
    std::fs::write("freqhole-api-client/src/codegen/schema.ts", schema)?;

    let routes_config = generate_routes_file(&routes);
    std::fs::write("freqhole-api-client/src/codegen/routes.ts", routes_config)?;

    println!("generated codegen/schema.ts and codegen/routes.ts");
    Ok(())
}
